import os, re, sys, pathlib, subprocess
import torch
from qwen_asr import Qwen3ASRModel

def loginfo(content):
    print(f'autotranscribe.py: {content}')

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
        chunk_path = pathlib.Path('/tmp') / (input_path.stem + f'-c{start_time}.mp3')
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
        chunk_paths.append((start_time, end_time, chunk_path))
        loginfo(f'create {chunk_path}')
    return chunk_paths

def transcribe(input_path, full_duration, chunk_paths, model):
    timed_sentences = []
    for chunk_start_time, chunk_end_time, chunk_path in chunk_paths:
        loginfo(f'transcribe {chunk_path}')
        transcribe_results = model.transcribe(audio=str(chunk_path), language='Japanese') # return_time_stamps=True
        full_text = transcribe_results[0].text
        time_per_char = (chunk_end_time - chunk_start_time - 10) / len(full_text) # add 5 seconds padding
        current_time = chunk_start_time + 5
        # add an explicit chunk start mark here and later merge manually, not meaningful to auto merge
        timed_sentences.append((chunk_start_time, chunk_start_time, '[chunk start]'))
        # append ? to .* to make it eager
        for sentence in re.findall(r'.*?(?:。|？|、)', full_text):
            sentence_time = len(sentence) * time_per_char
            timed_sentences.append((current_time, current_time + sentence_time, sentence))
            current_time += sentence_time

    vss_version = os.environ['AT_VSS_VERSION'] if 'AT_VSS_VERSION' in os.environ else '1'
    subtitle_path = pathlib.Path('/work/output') / input_path.with_suffix(f'.mp3.vss.{vss_version}').name
    loginfo(f'write {subtitle_path}')
    with open(subtitle_path, 'w') as f:
        for start_time, end_time, sentence in timed_sentences:
            f.write(f'{start_time:.3f}-{end_time:.3f}: {sentence}\n')

def pretend_transcribe(input_path, full_duration, chunk_paths, model):
    loginfo('pretend load models')
    for chunk_start_time, chunk_end_time, chunk_path in chunk_paths:
        loginfo(f'pretend transcribe {chunk_path}')
    vss_version = os.environ['AT_VSS_VERSION'] if 'AT_VSS_VERSION' in os.environ else '1'
    subtitle_path = input_path.with_suffix(f'.mp3.vss.{vss_version}')
    loginfo(f'pretend write {subtitle_path}')

loginfo('load model')
model = Qwen3ASRModel.from_pretrained(
    '/work/models/Qwen3-ASR-1.7B',
    dtype=torch.bfloat16,
    device_map='cuda:0',
    max_new_tokens=4096,
    attn_implementation="flash_attention_2",
)
loginfo('load model complete')
for file_path in pathlib.Path('/work/input').iterdir():
    if file_path.suffix == '.mp3':
        loginfo(f'processing {file_path}')
        audio_duration = get_audio_duration(file_path)
        if audio_duration > 3600:
            loginfo('audio duration too long, skip')
            continue
        if audio_duration < 15:
            loginfo('audio duration too short, no need to transcribe')
            continue
        chunk_paths = split_chunk(file_path, audio_duration, 300)
        transcribe(file_path, audio_duration, chunk_paths, model)
