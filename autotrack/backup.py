import pathlib, json, io, tarfile, math, base64, datetime
from PIL import Image # uv add Pillow

# formatted encoded text line width
LINE_WIDTH = 128

# backup metadata files into base64 (similar) encoded tar archive
# and then format them into text file and save into... ?! github !?
def make_backup(detailstat=False):
    # (work id, raw metadata backup text file size)[]
    raw_metadata_file_sizes = []
    metadata_tar_fileobj = io.BytesIO()
    metadata_tar = tarfile.open(f'metadata.tar.xz', 'w:xz', fileobj=metadata_tar_fileobj)
    for directory_path in pathlib.Path('/activework').iterdir():
        if not directory_path.name.startswith('RJ'):
            continue
        work_path = directory_path
        with open(work_path / 'metadata.json') as f:
            metadata = json.load(f)
        work_id = metadata['id']

        # 1. cover image encoded text
        # convert jpg image to avif image if not exist
        # this part is here because it is easier to use in python
        cover_image_path = work_path / 'cover.avif'
        if not cover_image_path.exists():
            raw_cover_image_path = work_path / 'cover.jpg'
            if not raw_cover_image_path.exists():
                print(f'{work_id}: cover.jpg missing, skip this work')
                continue
            print(f'{work_id}: convert cover.jpg to cover.avif')
            with Image.open(work_path / 'cover.jpg') as image:
                image.save(cover_image_path, 'AVIF')
        with open(cover_image_path, 'rb') as f:
            cover_image_encoded_text = base64.b85encode(f.read())

        # collect raw metadata files
        raw_metadata_files = [] # paths
        raw_metadata_files.append(work_path / f'{work_id}-workinfo.json')
        raw_metadata_files.append(work_path / f'{work_id}-trackinfo.json')
        for edition_id in metadata['languageEditions']:
            raw_metadata_files.append(work_path / f'{edition_id}-workinfo.json')
            raw_metadata_files.append(work_path / f'{edition_id}-trackinfo.json')
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
                    info = tarfile.TarInfo(name=path.name).replace(mode=0o644, mtime=mtime)
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
        print(f'write {raw_metadata_backup_path} size {len(b) / 1000:.2f}kb')
        with open(raw_metadata_backup_path, 'wb') as raw_metadata_backup_file:
            raw_metadata_backup_file.write(b)

        # 4. metadata entry in metadata bundle
        # cleanup redundent properties that can be retrieved from other source or calculated
        # # if you ask why are these properties here, they are making manage script easier and client side not loading raw metadata
        metadata.pop('providerLink')
        metadata.pop('providerProviderLink')
        metadata.pop('actors')
        metadata.pop('providerTags')
        metadata.pop('languageEditions')
        metadata.pop('audioFormat')
        metadata.pop('subtitleFormat', 0)
        metadata.pop('autoGeneratedSubtitle', 0)

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

    if detailstat:
        for work_id, size in sorted(raw_metadata_file_sizes, key=lambda s: s[1]):
            print(f'{work_id:>10} {f'{size / 1000:.3f}':>7}kb {'-' * math.floor(size / max_size * 100)}')
    raw_metadata_total_size = sum(map(lambda s: s[1], raw_metadata_file_sizes))
    print(f'raw metadata total {raw_metadata_total_size / 1000:.3f}kb avg {raw_metadata_total_size / len(raw_metadata_file_sizes) / 1000:.3f}kb')

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
                if 'comment' in original_metadata:
                    assert_eq(extract_metadata['comment'], original_metadata['comment'], member.name)
                    pair_count += 1
                assert_eq(extract_metadata['managementComment'], original_metadata['managementComment'], member.name)
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
                    if 'comment' in original_track:
                        assert_eq(extract_track['comment'], original_track['comment'], f'{member.name} track {original_track['index']}')
                        pair_count += 1
                    assert_eq(extract_track['providerPath'], original_track['providerPath'], f'{member.name} track {original_track['index']}')
                    if 'subtitleProviderPath' in original_track:
                        assert_eq(extract_track['subtitleProviderPath'], original_track['subtitleProviderPath'], f'{member.name} track {original_track['index']}')
                        pair_count += 1
                    pair_count += 3
                pair_count += 8
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
                    current_file_path = output_directory / member.name
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

# make_backup()
check_restore()

# docker run -it --rm --name asmr3 -v .:/work -v $ACTIVE_WORK_DIR:/activework -v ../archive/asmr:/archivework -h ASMR -w /work my/python
