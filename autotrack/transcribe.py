import re, sys, pathlib, subprocess

def loginfo(content):
    print(f'autotranscribe.py: {content}')

def get_input_path():
    if len(sys.argv) < 2:
        loginfo('USAGE: autotranscribe.py AUDIOFILE')
        exit(1)
    input_path = pathlib.Path(sys.argv[1])
    if not input_path.exists():
        loginfo(f'input file {input_path} not exist?')
        exit(1)
    loginfo(f'input file {input_path}')
    return input_path

def get_audio_duration(path):
    # if long, need cut into chunks
    loginfo(f'run ffprobe -i {path}')
    # ffprobe -i /work/data/track1.mp3 -show_entries format=duration -v quiet -of csv="p=0"
    child = subprocess.run(['ffprobe', '-i', str(path), '-show_entries', 'format=duration', '-v', 'quiet', '-of', 'csv=p=0'], capture_output=True)
    if child.stdout:
        print('\n'.join([f'  ffprobe: {r}' for r in child.stdout.decode().strip().split('\n')]))
    if child.stderr:
        # by the way, the default verbose version, configuration, library, etc. content are all stderr
        print('\n'.join([f'  ffprobe: {r}' for r in child.stderr.decode().strip().split('\n')]))
    if child.returncode:
        loginfo(f'ffprobe return code {child.returncode}, abort')
    # our advanced python will raise error on not a number, which is expected here
    duration = float(child.stdout.decode().strip())
    loginfo(f'duration {duration}')
    if duration > 1800:
        loginfo('audio duration too long, not decided whether to work with this long audio file for now')
        exit(1)
    return duration

# will have 15s+15s overlap between chunks, return list of path of split result files
def split_chunk(input_path, audio_duration, chunk_size):
    chunk_ranges = []
    for i in range(10):
        begin_time = 0 if i == 0 else i * chunk_size - 15
        end_time = (i + 1) * chunk_size + 15
        capped_end_time = min(end_time, audio_duration)
        chunk_ranges.append((begin_time, capped_end_time))
        if end_time >= audio_duration:
            break
    chunk_paths = []
    for chunk_index, (start_time, end_time) in enumerate(chunk_ranges):
        chunk_path = pathlib.Path('/work/data') / (input_path.stem + f'-c{start_time}.mp3')
        # ffmpeg -i /work/data/track2.mp3 -ss 165 -t 210 -acodec copy -v quiet /work/data/track2-c165.mp3
        parameters = ['ffmpeg', '-i', str(input_path), '-ss', str(start_time)]
        if chunk_index != len(chunk_ranges) - 1:
            parameters.extend(('-t', str(end_time - start_time)))
        parameters.extend(('-acodec', 'copy', '-v', 'quiet', '-y', str(chunk_path)))
        loginfo(f'run {' '.join(parameters)}')
        child = subprocess.run(parameters, capture_output=True)
        if child.stdout:
            print('\n'.join([f'  ffmpeg: {r}' for r in child.stdout.decode().strip().split('\n')]))
        if child.stderr:
            # by the way, the default verbose version, configuration, library, etc. content are all stderr
            print('\n'.join([f'  ffmpeg: {r}' for r in child.stderr.decode().strip().split('\n')]))
        if child.returncode:
            loginfo(f'ffmpeg return code {child.returncode}, abort, remember to clean {chunk_path}')
            exit(1)
        chunk_paths.append(chunk_path)
        loginfo(f'create {chunk_path}')
    return chunk_paths

# import them take very long time, put them after previous quick validations
import torch
try:
    from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner
except ImportError:
    pass # TODO check current workflow

def asr():
    input_path = get_input_path()
    audio_duration = get_audio_duration(input_path)
    chunk_paths = split_chunk(input_path, audio_duration, 300) # 5min

    loginfo('loading models')
    model = Qwen3ASRModel.from_pretrained(
        '/work/models/Qwen3-ASR-1.7B',
        dtype=torch.bfloat16,
        device_map='cuda:0',
        max_new_tokens=4096,
        attn_implementation="flash_attention_2",
        forced_aligner='/work/models/Qwen3-ForcedAligner-0.6B',
        forced_aligner_kwargs=dict(
            dtype=torch.bfloat16,
            device_map="cuda:0",
            attn_implementation="flash_attention_2",
        ),
    )
    # seperate use seems not good
    # align_model = Qwen3ForcedAligner.from_pretrained(
    #     '/work/models/Qwen3-ForcedAligner-0.6B',
    #     dtype=torch.bfloat16,
    #     device_map="cuda:0",
    #     attn_implementation="flash_attention_2",
    # )

    # try transcribe full audio file here
    # loginfo(f'transcribe {input_path}')
    # transcribe_results = model.transcribe(audio=str(input_path), language='Japanese', return_time_stamps=True)
    # full_text = transcribe_results[0].text
    # with open(input_path.with_suffix('.mp3.jp.txt'), 'w') as f:
    #     f.write(full_text)
    # all_sentences = [s for s in re.findall(r'.*?(?:。|？|、)', full_text)]

    # TODO try take several sentence and align it and get good result, and cut audio file at end position, and loop?

    for chunk_path in chunk_paths:
        transcribe_results = model.transcribe(audio=str(chunk_path), language='Japanese', return_time_stamps=True)
        # print raw result in case everything has error
        # print(transcribe_results[0].text)
        # for item in transcribe_results[0].time_stamps: print(f'{item.start_time}-{item.end_time}: {item.text}')

        # validation
        full_text = transcribe_results[0].text
        timed_tokens = transcribe_results[0].time_stamps
        processed_len = 0 # processed character count in full text
        for timed_token in timed_tokens:
            token_position = full_text.find(timed_token.text, processed_len)
            # normally expect a token to appear as first character in search range, except punctuations
            if token_position != processed_len:
                skipped = full_text[processed_len:token_position]
                if skipped not in ('、', '。', '？'):
                    loginfo(f'{timed_token.start_time}-{timed_token.end_time} token {timed_token.text} skipped {skipped}')
            processed_len = token_position + len(timed_token.text)
        # after validation, split sentence, take same text length of timed token's time range as this sentence's time range
        processed_len = 0 # processed character count in full text, use in print error message
        processed_count = 0 # processed token count in token list
        timed_sentences = [] # (start time, end time, text)[]
        # append ? to .* to make it eager
        for sentence in re.findall(r'.*?(?:。|？|、)', full_text):
            if processed_count >= len(timed_tokens):
                loginfo('sentence is not used but timed tokens are used up?')
                break
            start_time = timed_tokens[processed_count].start_time
            end_time = timed_tokens[processed_count].end_time
            subsentence = sentence
            break_out = False
            while True:
                if subsentence in ('、', '。', '？'):
                    timed_sentences.append((start_time, end_time, sentence))
                    break
                current_token = timed_tokens[processed_count].text
                # this should always happen after previous validation?
                if subsentence.startswith(current_token):
                    end_time = timed_tokens[processed_count].end_time
                    subsentence = subsentence[len(current_token):]
                    processed_len += len(current_token)
                    processed_count += 1
                else:
                    loginfo(f'sentence and token list mismatch, sentence char index {processed_len}, token list index {processed_count}, subsentence {subsentence}, current token {current_token}')
                    break_out = True
                    break
            if break_out:
                break
        subtitle_path = input_path.with_name(chunk_path.with_suffix('.mp3.vss').name)
        loginfo(f'write {subtitle_path}')
        with open(subtitle_path, 'w') as f:
            for start_time, end_time, sentence in timed_sentences:
                f.write(f'{start_time}-{end_time}: {sentence}\n')

# TODO translate here
# from transformers import pipeline
# prompt = f'''
# Fix errors this speech recognition result, ONLY OUTPUT fix result, DON'T ADD COMMENTARY AND EXPLAINATIONS.
# {''.join(full_text.split('\n')[:32])}
# '''
# pipeline = pipeline(task='text-generation', model='/work/models/manually-construct-generic')
# # restrict max new tokens or else it will start to think away
# translate_results = pipeline(prompt, generation_config=dict(max_new_tokens=2048, temperature=0.2))
# print(translate_results)
