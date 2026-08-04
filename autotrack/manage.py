import pathlib, json, io, tarfile, math, base64, datetime, sys, re, subprocess, random, time
import pypdf          # uv add pypdf
from PIL import Image # uv add Pillow
                      # apt install ffmpeg

# formatted encoded text line width
LINE_WIDTH = 128
# backup metadata files into base64 (similar) encoded tar archive
# and then format them into text file and save into... ?! github !?
def backup_raw_metadata(stat=False):
    # (work id, raw metadata backup text file size)[]
    raw_metadata_file_sizes = []
    for directory_path in pathlib.Path('/activework').iterdir():
        if not directory_path.name.startswith('RJ'):
            continue
        work_path = directory_path
        with open(work_path / 'metadata.json') as f:
            metadata = json.load(f)
        work_id = metadata['id']

        # 1. cover image encoded text
        cover_image_path = work_path / 'cover.avif'
        if not cover_image_path.exists():
            print(f'{work_id}: cover image missing, skip this work')
            continue
        with open(cover_image_path, 'rb') as f:
            cover_image_encoded_text = base64.b85encode(f.read())

        # collect raw metadata files
        raw_metadata_files = [] # paths
        raw_metadata_files.append(work_path / f'{work_id}-workinfo.json')
        raw_metadata_files.append(work_path / f'{work_id}-fileinfo.json')
        for edition_id in metadata['languageEditions']:
            raw_metadata_files.append(work_path / f'{edition_id}-workinfo.json')
            raw_metadata_files.append(work_path / f'{edition_id}-fileinfo.json')
        files_completed = True
        for path in raw_metadata_files:
            if not path.exists():
                files_completed = False
                print(f'{work_id}: missing raw metadata file {path}')
        if not files_completed:
            print(f'{work_id}: has missing raw metadata file, skip this work')
            continue

        # for all tar file entries, use metadata.addTime as mtime
        mtime = datetime.datetime.strptime(metadata['addTime'], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.UTC).timestamp()
        # 2. raw metadata bundled compressed encoded text
        with io.BytesIO() as raw_metadata_tar_fileobj:
            with tarfile.open(f'{work_id}.tar.xz', 'w:xz', fileobj=raw_metadata_tar_fileobj) as tar:
                for path in raw_metadata_files:
                    with open(path) as f:
                        raw_metadata = json.load(f)
                    # don't forget to minify json
                    # don't forget to allow non ascii
                    # what do you mean by this default add whitespace for comma and colon?
                    minified_content = json.dumps(raw_metadata, ensure_ascii=False, separators=(',', ':'))
                    encoded_content = minified_content.encode('utf-8')
                    # TODO temp
                    arcname = path.name.replace('fileinfo', 'trackinfo') if path.name.endswith('fileinfo.json') else path.name
                    info = tarfile.TarInfo(name=arcname).replace(mode=0o644, mtime=mtime)
                    info.size = len(encoded_content)
                    with io.BytesIO(encoded_content) as entry_fileobj:
                        tar.addfile(info, fileobj=entry_fileobj)
            json_bundle_encoded_text = base64.b85encode(raw_metadata_tar_fileobj.getvalue())

        # 3. write cover image and raw metadata bundle backup file
        b = b''
        for position in range(0, len(cover_image_encoded_text), LINE_WIDTH):
            b += cover_image_encoded_text[position:position + LINE_WIDTH] + b'\n'
        b += b'\n'
        for position in range(0, len(json_bundle_encoded_text), LINE_WIDTH):
            b += json_bundle_encoded_text[position:position + LINE_WIDTH] + b'\n'
        raw_metadata_file_sizes.append((work_id, len(b)))
        raw_metadata_backup_path = pathlib.Path('/archivework') / 'metadata' / f'A{work_id[2:]}.txt'
        if stat:
            print(f'write {raw_metadata_backup_path} size {len(b) / 1000:.2f}kb')
        with open(raw_metadata_backup_path, 'wb') as raw_metadata_backup_file:
            raw_metadata_backup_file.write(b)

    if stat:
        for work_id, size in sorted(raw_metadata_file_sizes, key=lambda s: s[1]):
            print(f'{work_id:>10} {f'{size / 1000:.3f}':>7}kb {'-' * math.floor(size / max_size * 100)}')
    raw_metadata_total_size = sum(map(lambda s: s[1], raw_metadata_file_sizes))
    print(f'raw metadata total {raw_metadata_total_size / 1000:.3f}kb avg {raw_metadata_total_size / len(raw_metadata_file_sizes) / 1000:.3f}kb')

def backup_metadata():
    metadata_tar_fileobj = io.BytesIO()
    metadata_tar = tarfile.open(f'metadata.tar.xz', 'w:xz', fileobj=metadata_tar_fileobj)
    for directory_path in pathlib.Path('/activework').iterdir():
        if not directory_path.name.startswith('RJ'):
            continue
        work_path = directory_path
        with open(work_path / 'metadata.json') as f:
            metadata = json.load(f)
        work_id = metadata['id']

        # 4. metadata entry in metadata bundle
        # cleanup redundent properties that can be retrieved from other source or calculated
        # # if you ask why are these properties here, they are making manage script easier and client side not loading raw metadata
        metadata.pop('providerLink')
        metadata.pop('providerProviderLink')
        metadata.pop('actors')
        metadata.pop('providerTags')
        metadata.pop('languageEditions')

        # for all tar file entries, use metadata.addTime as mtime
        mtime = datetime.datetime.strptime(metadata['addTime'], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.UTC).timestamp()
        metadata_entry = tarfile.TarInfo(name=f'{work_id}.json')
        metadata_entry = metadata_entry.replace(mode=0o644, mtime=mtime)
        minified_metadata_content = json.dumps(metadata, ensure_ascii=False, separators=(',', ':'))
        encoded_metadata_content = minified_metadata_content.encode('utf-8')
        metadata_entry.size = len(encoded_metadata_content)
        with io.BytesIO(encoded_metadata_content) as metadata_entry_fileobj:
            metadata_tar.addfile(metadata_entry, fileobj=metadata_entry_fileobj)

    # 5. write metadata backup file
    metadata_tar.close()
    metadata_bundle_encoded_text = base64.b85encode(metadata_tar_fileobj.getvalue())
    b = b''
    for position in range(0, len(metadata_bundle_encoded_text), LINE_WIDTH):
        b += metadata_bundle_encoded_text[position:position + LINE_WIDTH] + b'\n'
    print(f'write /archivework/metadata.txt size {len(b) / 1000:.2f}kb')
    with open('/archivework/metadata.txt', 'wb') as metadata_backup_file:
        metadata_backup_file.write(b)

def assert_eq(lhs, rhs, message_header, comp=None):
    # why do lambda without paren syntax error?
    comp = comp or (lambda l, r: l == r)
    assert comp(lhs, rhs), f'{message_header}: {lhs} != {rhs}'

def check_restore():
    # 1. check restore metadata
    with open('/archivework/metadata.txt') as f:
        metadata_bundle_formatted_encoded_text = f.read()
    metadata_bundle_encoded_text = metadata_bundle_formatted_encoded_text.replace('\n', '')
    metadata_bundle_content = base64.b85decode(metadata_bundle_encoded_text)
    with io.BytesIO(metadata_bundle_content) as metadata_fileobj:
        with tarfile.open(mode='r:xz', fileobj=metadata_fileobj) as metadata_tar:
            pair_count = 0
            for member in metadata_tar.getmembers():
                extract_fileobj = metadata_tar.extractfile(member)
                extract_metadata = json.load(extract_fileobj)

                work_id = pathlib.Path(member.name).stem
                print(f'work id {work_id}')
                original_metadata_path = pathlib.Path('/activework') / work_id / 'metadata.json'
                with open(original_metadata_path) as f:
                    original_metadata = json.load(f)

                assert_eq(extract_metadata['id'], original_metadata['id'], member.name)
                assert_eq(extract_metadata['title'], original_metadata['title'], member.name)
                assert_eq(extract_metadata['addTime'], original_metadata['addTime'], member.name)
                assert_eq(extract_metadata['lastAccessTime'], original_metadata['lastAccessTime'], member.name)
                assert_eq(extract_metadata['tags'], original_metadata['tags'], member.name,
                    comp=lambda t1, t2: len(t1) == len(t2) and all(v1 == v2 for (v1, v2) in zip(t1, t2)))
                if 'retired' in original_metadata:
                    assert_eq(extract_metadata['retired'], original_metadata['retired'], member.name)
                    pair_count += 1
                if 'comments' in original_metadata:
                    assert_eq(extract_metadata['comments'], original_metadata['comments'], member.name,
                        comp=lambda t1, t2: len(t1) == len(t2) and all(v1 == v2 for (v1, v2) in zip(t1, t2)))
                    pair_count += 1
                if 'managementComments' in original_metadata:
                    assert_eq(extract_metadata['managementComments'], original_metadata['managementComments'], member.name,
                        comp=lambda t1, t2: len(t1) == len(t2) and all(v1 == v2 for (v1, v2) in zip(t1, t2)))
                    pair_count += 1
                assert_eq(extract_metadata['score'], original_metadata['score'], member.name)
                if 'audioWorkId' in original_metadata:
                    assert_eq(extract_metadata['audioWorkId'], original_metadata['audioWorkId'], member.name)
                    pair_count += 1
                if 'subtitleWorkId' in original_metadata:
                    assert_eq(extract_metadata['subtitleWorkId'], original_metadata['subtitleWorkId'], member.name)
                    pair_count += 1
                assert_eq(len(extract_metadata['tracks']), len(original_metadata['tracks']), member.name)
                for extract_track, original_track in zip(extract_metadata['tracks'], original_metadata['tracks']):
                    assert_eq(extract_track['index'], original_track['index'], f'{member.name} track {original_track['index']}')
                    if 'name' in original_track:
                        assert_eq(extract_track['name'], original_track['name'], f'{member.name} track {original_track['index']}')
                        pair_count += 1
                    assert_eq(extract_track['duration'], original_track['duration'], f'{member.name} track {original_track['index']}')
                    if 'comments' in original_track:
                        assert_eq(extract_track['comments'], original_track['comments'], f'{member.name} track {original_track['index']}')
                        pair_count += 1
                    assert_eq(extract_track['audioFileIndex'], original_track['audioFileIndex'], f'{member.name} track {original_track['index']}')
                    if 'subtitleFileIndex' in original_track:
                        assert_eq(extract_track['subtitleFileIndex'], original_track['subtitleFileIndex'], f'{member.name} track {original_track['index']}')
                        pair_count += 1
                    pair_count += 3
                pair_count += 7
                # with open(pathlib.Path('/work/temprestore') / member.name, 'w') as f:
                #     json.dump(extract_metadata, f, ensure_ascii=False, indent=2)
            print(f'metadata: compare pass {pair_count} pairs of values')

    # 2. check restore raw metadata
    total_ok_bytes = 0
    total_ok_lines = 0
    total_ok_characters = 0
    for file_path in pathlib.Path('/archivework/metadata').iterdir():
        if not file_path.name.startswith('A') or file_path.suffix != '.txt':
            continue
        work_id = f'RJ{int(file_path.stem[1:]):08}' # validate int and format back
        with open(file_path) as f:
            raw_metadata_formatted_encoded_text = f.read()
        part1, part2 = raw_metadata_formatted_encoded_text.split('\n\n')
        cover_image_encoded_text = part1.replace('\n', '')
        json_bundle_encoded_text = part2.replace('\n', '')

        output_directory = pathlib.Path('/activework') / work_id
        # if output_directory.exists():
        #     continue
        # output_directory.mkdir()

        # cover image
        with open(output_directory / 'cover.avif', 'rb') as image_file:
            current_image_content = image_file.read()
        extract_image_content = base64.b85decode(cover_image_encoded_text)
        if extract_image_content == current_image_content:
            total_ok_bytes += len(current_image_content)
        else:
            print(f'{work_id}: cover image difference?')
        # with open(output_directory / 'cover.avif', 'wb') as f:
        #     print(f'{work_id}: write cover.avif')
        #     f.write(base64.b85decode(cover_image_encoded_text))
        
        # json bundle
        with io.BytesIO(base64.b85decode(json_bundle_encoded_text)) as json_bundle_tar_fileobj:
            with tarfile.open(mode='r:xz', fileobj=json_bundle_tar_fileobj) as json_bundle_tar:
                for member in json_bundle_tar.getmembers():
                    if not member.name.endswith('-workinfo.json') and not member.name.endswith('-trackinfo.json'):
                        raise ValueError(f'{work_id}: unexpected arcname {arcname}')
                    extract_fileobj = json_bundle_tar.extractfile(member)
                    extract_content = json.load(extract_fileobj)
                    # need json format to compare text content
                    extract_content = json.dumps(extract_content, ensure_ascii=False, indent=2)
                    # TODO temp
                    current_file_path = output_directory / (member.name.replace('trackinfo', 'fileinfo') if member.name.endswith('trackinfo.json') else member.name)
                    with open(current_file_path) as current_file:
                        current_content = current_file.read()
                    if extract_content == current_content:
                        total_ok_characters += len(current_content)
                        total_ok_lines += len(current_content.splitlines())
                    elif len(extract_content) != len(current_content):
                        print(f'{work_id}: {member.name} len mismatch? {len(extract_content)} != {len(current_content)}')
                    else:
                        print(f'{work_id}: {member.name} mismatch?')
                    # with open(output_directory / member.name, 'w') as output_fileobj:
                    #     print(f'{work_id}: write {member.name}')
                    #     # recover json indention by the way
                    #     json.dump(json.loads(extract_content), output_fileobj, ensure_ascii=False, indent=2)
    print(f'raw metadata: match bytes {total_ok_bytes} characters {total_ok_characters} lines {total_ok_lines}')

def convert_cover_image(work_path):
    work_id = work_path.name
    cover_image_path = work_path / 'cover.avif'
    if cover_image_path.exists():
        print(f'{work_id}: cover.avif exists, skip')
        return
    raw_cover_image_path = work_path / 'cover.jpg'
    if not raw_cover_image_path.exists():
        print(f'{work_id}: cover.jpg missing, skip')
        return
    print(f'{work_id}: convert cover.jpg to cover.avif')
    with Image.open(work_path / 'cover.jpg') as image:
        image.save(cover_image_path, 'AVIF')
    print(f'{work_id}: create cover.avif complete')

# for now only one work have pdf subtitle, and the extraction result contains lot of non text content,
# although all expected result is inside the result, it is not usable, leave it here for future investigation
# that work is fixed by manually copying content in a pdf reader
# if this will be used in the future, update to read metadata to find pdf files instead of iterating
def convert_pdf_subtitle(work_path):
    for path in work_path.iterdir():
        if path.name.startswith('track') and path.name.endswith('.pdf'):
            print(f'read {path}')
            reader = PdfReader(path)
            text = ''
            for page in reader.pages:
                text += page.extract_text()
            with open(path.with_suffix('.txt'), 'w') as f:
                print(f'{work_path.name}: write {path.with_suffix('.txt')} text length {len(text)}')
                f.write(text)

# for now returned array of objects only contain provider path
def flatten_fileinfo(root):
    results = []
    def collect(folder, basepath):
        # byte sequence compare is the only reliable string compare cross languages and libraries
        for subfolder in sorted((f for f in folder['children'] if f['type'] == 'folder'), key=lambda f: f['title'].encode('utf-8')):
            collect(subfolder, basepath + '/' + subfolder['title'])
        for item in sorted((f for f in folder['children'] if f['type'] != 'folder'), key=lambda f: f['title'].encode('utf-8')):
            results.append(basepath + '/' + item['title'])
    collect(root, '')
    return results

# the typical speed for this conversion is like 70x to 100x
# this makes current overall conversion time like 5 hours, which makes a lot of motivation to parallel them
# but after the major conversion every work takes only about 1 minute to run, which reduces a lot of motivation
# currently their battle result is lazy to implement parallel
def convert_audio_format(work_path):
    work_id = work_path.name
    with open(work_path / 'metadata.json') as f:
        metadata = json.load(f)
    files = {}
    for meid in [work_id] + metadata['languageEditions']:
        with open(work_path / f'{meid}-fileinfo.json') as f:
            fileinfo = json.load(f)
        files[meid] = flatten_fileinfo({ 'type': 'folder', 'title': '', 'children': fileinfo })
    audio_work_id = metadata['audioWorkId'] if 'audioWorkId' in metadata else work_id

    for track in metadata['tracks']:
        audio_file = files[audio_work_id][track['providerPath'] - 1]
        audio_suffix = pathlib.Path(audio_file).suffix
        provider_file_local_path = work_path / f'{audio_work_id}-file{track['providerPath']}{audio_suffix}'
        modern_file_path = work_path / f'track{track['index']}.opus'
        if not provider_file_local_path.exists():
            print(f'{work_id}: track {track['index']} provider file local path not exist, skip, {provider_file_local_path}')
            continue
        if modern_file_path.exists():
            print(f'{work_id}: track {track['index']} modern file path exist, {modern_file_path}, skip')
            continue

        # ffmpeg -v error -i /data/RJ12345678/RJ12345678-file10.wav -b:a 32000 -c:a libopus /data/RJ12345678/track5.opus
        parameters = ['ffmpeg', '-v', 'error', '-i', \
            str(provider_file_local_path), '-c:a', 'libopus', '-b:a', '32000', str(modern_file_path)]
        print(f'{work_id}: run {' '.join(parameters)}')
        start_time = time.time()
        child = subprocess.run(parameters, capture_output=True)
        end_time = time.time()
        if child.stdout:
            print('\n'.join([f'  ffmpeg: {r}' for r in child.stdout.decode().strip().split('\n')]))
        if child.stderr:
            print('\n'.join([f'  ffmpeg: {r}' for r in child.stderr.decode().strip().split('\n')]))
        if child.returncode:
            print(f'{work_id}: ffmpeg return code {child.returncode}, abort')
            continue
        operation_time = end_time - start_time
        multiplier = math.floor(track['duration'] / operation_time)
        print(f'{work_id}: create {modern_file_path} operation time {operation_time}s, speed {multiplier}x')

def get_audio_codec(path):
    # ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 track1.opus
    ffmpeg_parameters = ['ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name', '-of', 'csv=print_section=0', str(path)]
    print(f'{path}: run ffprobe codec_name')
    child = subprocess.run(ffmpeg_parameters, capture_output=True)
    if child.stdout:
        print('\n'.join([f'  ffprobe: {r}' for r in child.stdout.decode().strip().split('\n')]))
    if child.stderr:
        print('\n'.join([f'  ffprobe: {r}' for r in child.stderr.decode().strip().split('\n')]))
    if child.returncode:
        print(f'{path}: ffprobe return code {child.returncode}, skip')
        return
    return child.stdout.decode().strip()

def get_audio_duration(path, log=False):
    if log: print(f'{path}: run ffprobe -i {path}')
    # ffprobe -v error -i /work/input/track1.mp3 -show_entries format=duration -of csv="p=0"
    child = subprocess.run(['ffprobe', '-v', 'error', '-i', str(path), '-show_entries', 'format=duration', '-of', 'csv=p=0'], capture_output=True)
    if child.stdout:
        if log: print('\n'.join([f'  ffprobe: {r}' for r in child.stdout.decode().strip().split('\n')]))
    if child.stderr:
        # by the way, the default verbose version, configuration, library, etc. content are all stderr
        if log: print('\n'.join([f'  ffprobe: {r}' for r in child.stderr.decode().strip().split('\n')]))
    if child.returncode:
        print(f'{path}: ffprobe return code {child.returncode}, abort')
        return 0
    # our advanced python will raise error on not a number, which is expected here
    return float(child.stdout.decode().strip())

# this don't raise error or half cut files, they work smoothly as an audio file with less duration
# so need to check duration not use this
def NOT_OK_check_completeness(path):
    # ffmpeg -v error -i input.opus -f null -
    ffmpeg_parameters = ['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'null', '-']
    print(f'run {' '.join(ffmpeg_parameters)}')
    child = subprocess.run(ffmpeg_parameters, capture_output=True)
    if child.stdout:
        print('\n'.join([f'  ffmpeg: {r}' for r in child.stdout.decode().strip().split('\n')]))
    if child.stderr:
        print('\n'.join([f'  ffmpeg: {r}' for r in child.stderr.decode().strip().split('\n')]))
    if child.returncode:
        print(f'{path}: ffmpeg return code {child.returncode}')

def migrate(parameters):
    if len(parameters) > 0 and parameters[0] == 'opus':
        # convert audio for all works
        for directory_path in pathlib.Path('/activework').iterdir():
            if not directory_path.name.startswith('RJ'):
                continue
            convert_audio_format(directory_path)
    elif len(parameters) > 0 and parameters[0] == 'validate':
        # validate converted file duration
        for directory_path in pathlib.Path('/activework').iterdir():
            if not directory_path.name.startswith('RJ'):
                continue
            work_path = directory_path
            with open(work_path / 'metadata.json') as f:
                metadata = json.load(f)
            for track in metadata['tracks']:
                audio_path = work_path / f'track{track['index']}.opus'
                if audio_path.exists():
                    duration = get_audio_duration(audio_path)
                    if abs(round(duration) - round(track['duration'])) > 1:
                        print(f'{work_path.name}: track {track['index']}: duration mismatch, expect {track['duration']} actual {duration}')

def get_work_id(input_parameter):
    matches = [d for d in pathlib.Path('/activework').iterdir() if d.name.endswith(input_parameter)]
    if len(matches) == 0:
        print('manage.py: invalid work id')
        exit(1)
    elif len(matches) > 1:
        print('manage.py: ambiguous short id')
        exit(1)
    print(f'manage.py: work id {matches[0].name}')
    return matches[0]

if len(sys.argv) > 1 and sys.argv[1] == 'raw-metadata':
    backup_raw_metadata(stat=len(sys.argv) > 2 and sys.argv[2] == 'stat')
elif len(sys.argv) > 1 and sys.argv[1] == 'metadata':
    backup_metadata()
elif len(sys.argv) > 1 and sys.argv[1] == 'check-restore':
    check_restore()
elif len(sys.argv) > 2 and sys.argv[1] == 'avif':
    convert_cover_image(get_work_id(sys.argv[2]))
elif len(sys.argv) > 2 and sys.argv[1] == 'opus':
    convert_audio_format(get_work_id(sys.argv[2]))
elif len(sys.argv) > 1 and sys.argv[1] == 'migrate':
    migrate(sys.argv[2:])
else:
    print('USAGE:')
    print('    manage.py avif WORKID      convert provider image files to avif codec')
    print('    manage.py opus WORKID      convert provider audio files to opus codec')
    print('    manage.py pdfsub WORKID    convert provider pdf subtitle files to txt')
    print('    manage.py mod WORKID       TODO avif + opus')
    print('    manage.py raw-metadata     backup raw metadata')
    print('    manage.py metadata         backup metadata')
    print('    manage.py check-restore    check backup restore, does not actually restore')
    print('    manage.py local-backup     TODO local backup')
    print('    manage.py migrate          various migrate operations')
    exit(1)
