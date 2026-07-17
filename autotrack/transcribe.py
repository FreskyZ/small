import os, re, sys, pathlib, subprocess, datetime
import torch
from rich import print as colorprint
from qwen_asr import Qwen3ASRModel

def loginfo(content):
    # too many stdout not controlled by this script, need add color and time
    colorprint(f'[[green]at.py[/green]][[green]{datetime.datetime.now().strftime('%H:%M:%S')}[/green]] {content}')

def get_audio_duration(path):
    # if long, need cut into chunks
    loginfo(f'run ffprobe -i {path}')
    # ffprobe -i /work/input/track1.mp3 -show_entries format=duration -v quiet -of csv="p=0"
    child = subprocess.run(['ffprobe', '-i', str(path), '-show_entries', 'format=duration', '-v', 'quiet', '-of', 'csv=p=0'], capture_output=True)
    if child.stdout:
        print('\n'.join([f'  ffprobe: {r}' for r in child.stdout.decode().strip().split('\n')]))
    if child.stderr:
        # by the way, the default verbose version, configuration, library, etc. content are all stderr
        print('\n'.join([f'  ffprobe: {r}' for r in child.stderr.decode().strip().split('\n')]))
    if child.returncode:
        loginfo(f'ffprobe return code {child.returncode}, abort')
        return 0
    # our advanced python will raise error on not a number, which is expected here
    return float(child.stdout.decode().strip())

# will have overlap between chunks, return list of path of split result files
def split_chunk(input_path, audio_duration, chunk_size):
    chunk_ranges = []
    for i in range(100):
        begin_time = 0 if i == 0 else i * chunk_size - 10
        end_time = (i + 1) * chunk_size + 10
        capped_end_time = min(end_time, audio_duration)
        chunk_ranges.append((begin_time, capped_end_time))
        if end_time >= audio_duration:
            break
    chunks = []
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
        # loginfo(f'create {chunk_path}')
        chunks.append((start_time, end_time, chunk_path))
    return chunks

def transcribe(input_path, chunks, model):
    loginfo('transcribing')
    results = model.transcribe(audio=[str(c[2]) for c in chunks], language=['Japanese'] * len(chunks)) # return_time_stamps=True
    timed_sentences = []
    for (start_time, end_time, _), result in zip(chunks, results):
        chunk_text = result.text
        time_per_char = (end_time - start_time) / len(chunk_text)
        current_time = start_time
        # add an explicit chunk start mark here and later merge manually, not meaningful to auto merge for now
        timed_sentences.append((current_time, current_time, '[chunk boundary]'))
        # append ? to .* to make it eager
        for sentence in re.findall(r'.*?(?:。|？|、)', chunk_text):
            sentence_time = len(sentence) * time_per_char
            timed_sentences.append((current_time, current_time + sentence_time, sentence))
            current_time += sentence_time
    loginfo(f'{len(timed_sentences)} sentences')
    vss_version = os.environ['AT_VSS_VERSION'] if 'AT_VSS_VERSION' in os.environ else '1'
    subtitle_path = pathlib.Path('/work/output') / input_path.with_suffix(f'.mp3.vss.{vss_version}').name
    loginfo(f'write {subtitle_path}')
    with open(subtitle_path, 'w') as f:
        for start_time, end_time, sentence in timed_sentences:
            f.write(f'{start_time:.3f},{end_time:.3f},{sentence}\n')

loginfo('load model')
model = Qwen3ASRModel.from_pretrained(
    '/work/models/Qwen3-ASR-1.7B',
    dtype=torch.bfloat16,
    device_map='cuda:0',
    max_new_tokens=512,
    max_inference_batch_size=8, # batch size 8 is max for my current machine
    attn_implementation="flash_attention_2",
)
loginfo('load model complete')
for file_path in pathlib.Path('/work/input').iterdir():
    if file_path.suffix == '.mp3':
        audio_duration = get_audio_duration(file_path)
        if audio_duration > 3600:
            loginfo('audio duration too long, skip')
            continue
        if audio_duration < 15:
            loginfo('audio duration too short, no need to transcribe')
            continue
        chunks = split_chunk(file_path, audio_duration, 60)
        transcribe(file_path, chunks, model)
