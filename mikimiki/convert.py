import os, pathlib, subprocess, math

THATREPO = os.environ['THATREPO'] if 'THATREPO' in os.environ else '/thatrepo'
THATREPO = pathlib.Path(THATREPO)

count = 0
mp3_count = 0
split4_count = 0
total_size = 0
total_duration = 0
except_long_total_duration = 0
# floor(duration) as index, last element is >= 10
duration_spread = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
above10_names = [] # (name, duration)[]
# 320, 256, 192, 128, 64, other
bitrate_spread = [0, 0, 0, 0, 0, 0]
abnormal_bitrate_names = [] # (name, bitrate)[]

for filepath in (THATREPO / 'public' / 'voices').iterdir():
    if filepath.suffix != '.mp3':
        continue
    if filepath.stem == '小天才':
        count += 1
        mp3_count += 1
        duration_spread[1] += 1
        bitrate_spread[3] += 1
        # print('mp3 1.836562 128')
        continue
    # ffprobe -v error -i input.mp3 -show_entries stream=codec_name,bit_rate,duration -output_format csv=print_section=0
    parameters = ['ffprobe', '-loglevel', 'error', '-i', str(filepath), '-show_entries',
        'stream=codec_name,bit_rate,duration', '-output_format', 'csv=print_section=0']
    print(f'ffprobe {filepath}')
    child = subprocess.run(parameters, capture_output=True)
    if child.stdout:
        pass
        # print('\n'.join([f'  ffprobe: {r}' for r in child.stdout.decode().strip().split('\n')]))
    if child.stderr:
        print('\n'.join([f'  ffprobe(e): {r}' for r in child.stderr.decode().strip().split('\n')]))
    if child.returncode:
        print(f'{filepath}: ffprobe return code {child.returncode}, skip')
        continue
    output = child.stdout.decode().strip()
    # some file has mp3 side data for replay gain?
    splitted = output.split(',')
    if len(splitted) == 4:
        split4_count += 1
    elif len(splitted) < 3 or len(splitted) > 4:
        print(f'{filepath}: very abnormal output {output}, skip')
        continue
    # why is this not same as input property list
    codec, duration, bitrate = splitted[0], splitted[1], splitted[2]
    duration = float(duration)
    bitrate = math.floor(int(bitrate) / 1000)
    stat = filepath.stat()
    count += 1
    total_size += stat.st_size
    if codec == 'mp3':
        mp3_count += 1
    total_duration += duration
    duration_spread[min(int(math.floor(duration)), 10)] += 1
    if duration < 10:
        except_long_total_duration += duration
    elif duration > 10:
        above10_names.append((filepath.name, duration))
    if bitrate == 320:
        bitrate_spread[0] += 1
    elif bitrate == 256:
        bitrate_spread[1] += 1
    elif bitrate == 192:
        bitrate_spread[2] += 1
    elif bitrate == 128:
        bitrate_spread[3] += 1
    elif bitrate == 64:
        bitrate_spread[4] += 1
    else:
        bitrate_spread[5] += 1
        abnormal_bitrate_names.append((filepath.name, bitrate))

# RESULT: 557 items, 557 mp3
print(f'count {count} mp3 {mp3_count}')
# RESULT: 78m total, 143kb avg
print(f'total size {total_size / 1048576:.2f}mb avg size {total_size / count / 1024:.2f}kb')
# RESULT: 3
print(f'split 4 count {split4_count}')
# RESULT: 5.308s per item, 2.574s per item except 38, that means 38 long item's avg duration is 40s
print(f'total duration {total_duration} avg duration {total_duration / count:.3f} avg duration except >10 {except_long_total_duration / count:.3f}')
# RESULT: [76, 166, 105, 66, 28, 29, 20, 13, 11, 5, 38]
print(f'duration spread {duration_spread}')
print(f'long duration {above10_names}')
# RESULT: 320kbps x346, 256kbps x2, 192kbps x5+6, 128kbps x165, 64kbps x21
print(f'bitrate spread {bitrate_spread}')
# RESULT: remaining 12 items is mainly around 170-200kbps, except one 96kbps? 
print(f'abnormal names {abnormal_bitrate_names}')
