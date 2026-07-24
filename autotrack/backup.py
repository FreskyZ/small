import pathlib, json, io, tarfile, math, base64, datetime
from PIL import Image

# backup data directory archive files (workinfo.json and trackinfo.json) into... ?!github!?
def backup_raw_metadata(overwrite=False, stat=False, detailstat=False):
    sizes = []
    max_size = 0
    for directory_path in pathlib.Path('/result').iterdir():
        if not directory_path.name.startswith('RJ'):
            continue
        work_path = directory_path
        with open(work_path / 'metadata.json') as f:
            metadata = json.load(f)
        # TODO this fix should not be needed after that fix, but this variable is commonly used so keep
        work_id = f'RJ{int(metadata['id'][2:]):08}'
        output_path = pathlib.Path('/work/tempbackup') / f'A{work_id[2:]}.txt'
        if not overwrite and output_path.exists():
            continue

        # convert jpg image to avif image if not exist, this part is suitable in python so is here
        cover_image_path = work_path / 'cover.avif'
        if not cover_image_path.exists():
            cover_raw_image_path = work_path / 'cover.jpg'
            if not cover_raw_image_path.exists():
                print(f'{work_id}: cover.jpg missing, skip')
                continue
            print(f'{work_id}: convert cover.jpg to cover.avif')
            with Image.open(work_path / 'cover.jpg') as image:
                image.save(cover_image_path, 'AVIF')
        with open(cover_image_path, 'rb') as f:
            cover_image_content = f.read()
        cover_image_encoded_text = base64.b85encode(cover_image_content)

        # paths
        json_files = [
            work_path / f'raw-metadata.json', # TODO update after naming convention that this should include main work id
            work_path / f'raw-tracks.json', # TODO update after naming convention that this should include main work id
        ]
        for edition_id in metadata['languageEditions']:
            json_files.append(work_path / f'raw-metadata-{edition_id}.json')
            json_files.append(work_path / f'raw-tracks-{edition_id}.json')
        has_missing = False
        for path in json_files:
            if not path.exists():
                has_missing = True
                print(f'{work_id}: missing file {path}')
        if has_missing:
            print(f'{work_id}: has missing file, skip')
            continue
        # for all these files, mtime is metadata.addTime
        mtime = datetime.datetime.strptime(metadata['addTime'], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.UTC).timestamp()
        with io.BytesIO() as tar_stream:
            with tarfile.open(f'{work_id}.tar.xz', 'w:xz', fileobj=tar_stream) as tar:
                for path in json_files:
                    with open(path) as f:
                        # don't forget to minify json
                        # what do you mean by this default include whitespace for comma and colon?
                        minified_content = json.dumps(json.load(f), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                    arcname = path.name
                    # TODO update after naming convention that this should include main work id
                    if path.name == 'raw-metadata.json':
                        arcname = f'{work_id}-workinfo.json'
                    elif path.name == 'raw-tracks.json':
                        arcname = f'{work_id}-trackinfo.json'
                    elif path.name.startswith('raw-metadata-'):
                        if len(path.name) == 26:
                            # also need temporary fix for \d{6} language edition id
                            arcname = f'RJ00{path.name[15:21]}-workinfo.json'
                        else:
                            arcname = f'RJ{path.name[15:23]}-workinfo.json'
                    elif path.name.startswith('raw-tracks-'):
                        if len(path.name) == 24:
                            arcname = f'RJ00{path.name[13:19]}-trackinfo.json'
                        else:
                            arcname = f'RJ{path.name[13:21]}-trackinfo.json'
                    info = tarfile.TarInfo(name=arcname).replace(mode=0o644, mtime=mtime)
                    info.size = len(minified_content)
                    with io.BytesIO(minified_content) as file_content:
                        tar.addfile(info, fileobj=file_content)
            json_bundle_encoded_text = base64.b85encode(tar_stream.getvalue())

        LINE_WIDTH = 128
        b = b''
        for position in range(0, len(cover_image_encoded_text), LINE_WIDTH):
            b += cover_image_encoded_text[position:position + LINE_WIDTH] + b'\n'
        b += b'\n'
        for position in range(0, len(json_bundle_encoded_text), LINE_WIDTH):
            b += json_bundle_encoded_text[position:position + LINE_WIDTH] + b'\n'
        sizes.append((work_id, len(b)))
        max_size = max(max_size, len(b))
        print(f'{work_id}: write {output_path} size {len(b)/1000:.2f}kb')
        with open(output_path, 'wb') as f:
            f.write(b)
    if stat:
        if detailstat:
            for work_id, size in sorted(sizes, key=lambda s: s[1]):
                print(f'{work_id:>10} {f'{size / 1000:.3f}':>7}kb {'-' * math.floor(size / max_size * 100)}')
        total_size = sum(map(lambda s: s[1], sizes))
        print(f'total {total_size / 1000:.3f}kb avg {total_size / len(sizes) / 1000:.3f}kb')

def restore_raw_metadata():
    for file_path in pathlib.Path('/backup').iterdir():
        if not file_path.name.startswith('A') or file_path.suffix != '.txt':
            continue
        work_id = f'RJ{int(file_path.stem[1:]):08}' # validate int and format back to \d{8}
        output_directory = pathlib.Path('/work/temprestore') / work_id
        if output_directory.exists():
            continue
        output_directory.mkdir()
        with open(file_path) as f:
            original_content = f.read()
        part1, part2 = original_content.split('\n\n')
        cover_image_encoded_text = part1.replace('\n', '')
        json_bundle_encoded_text = part2.replace('\n', '')

        # cover image
        with open(output_directory / 'cover.avif', 'wb') as f:
            print(f'{work_id}: write cover.avif')
            f.write(base64.b85decode(cover_image_encoded_text))
        # json bundle
        with io.BytesIO(base64.b85decode(json_bundle_encoded_text)) as fileobj:
            with tarfile.open(mode='r:xz', fileobj=fileobj) as tar:
                for member in tar.getmembers():
                    if not member.name.endswith('-workinfo.json') and not member.name.endswith('-rawtrack.json'):
                        raise ValueError(f'{work_id}: unexpected arcname {arcname}')
                    extract_fileobj = tar.extractfile(member)
                    with open(output_directory / member.name, 'w') as output_fileobj:
                        # recover json indention by the way
                        print(f'{work_id}: write {member.name}')
                        json.dump(json.load(extract_fileobj), output_fileobj, ensure_ascii=False, indent=2)

# TODO this need many updates after update legacy file structure
# TODO determine whether this is a check step in restore or something
def check_restore_raw_metadata():
    total_ok_bytes = 0
    total_ok_lines = 0
    total_ok_characters = 0
    for actual_directory_path in pathlib.Path('/work/temprestore').iterdir():
        work_id = actual_directory_path.name # this is RJ\d{8}
        # TODO remove all things about legacy
        legacy_work_id = f'RJ{work_id[4:]}' if work_id.startswith('RJ00') else work_id
        expect_directory_path = pathlib.Path('/result') / legacy_work_id
        with open(expect_directory_path / 'metadata.json') as f:
            metadata = json.load(f)
        with open(actual_directory_path / 'cover.avif', 'rb') as f:
            actual_cover_image_bytes = f.read()
        with open(expect_directory_path / 'cover.avif', 'rb') as f:
            expect_cover_image_bytes = f.read()
        # print(f'{work_id}: compare {actual_directory_path / 'cover.avif'} and {expect_directory_path / 'cover.avif'}')
        if actual_cover_image_bytes == expect_cover_image_bytes:
            total_ok_bytes += len(actual_cover_image_bytes)
        else:
            print(f'{work_id}: cover image difference?')
        with open(actual_directory_path / f'{work_id}-workinfo.json') as f:
            actual_json_content = f.read()
        with open(expect_directory_path / f'raw-metadata.json') as f:
            expect_json_content = f.read()
        # print(f'{work_id}: compare {actual_directory_path / f'{work_id}-workinfo.json'} and {expect_directory_path / f'raw-metadata.json'}')
        if actual_json_content == expect_json_content:
            total_ok_characters += len(actual_json_content)
            total_ok_lines += len(actual_json_content.splitlines())
        else:
            print(f'{work_id}: raw metadata mismatch?')
        with open(actual_directory_path / f'{work_id}-rawtrack.json') as f:
            actual_json_content = f.read()
        with open(expect_directory_path / f'raw-tracks.json') as f:
            expect_json_content = f.read()
        # print(f'{work_id}: compare {actual_directory_path / f'{work_id}-rawtrack.json'} and {expect_directory_path / f'raw-tracks.json'}')
        if actual_json_content == expect_json_content:
            total_ok_characters += len(actual_json_content)
            total_ok_lines += len(actual_json_content.splitlines())
        else:
            print(f'{work_id}: raw tracks mismatch?')
        for legacy_edition_id in metadata['languageEditions']:
            edition_id = f'RJ00{legacy_edition_id[2:]}' if len(legacy_edition_id) == 8 else legacy_edition_id
            with open(actual_directory_path / f'{edition_id}-workinfo.json') as f:
                actual_json_content = f.read()
            with open(expect_directory_path / f'raw-metadata-{legacy_edition_id}.json') as f:
                expect_json_content = f.read()
            # print(f'{work_id}: compare {actual_directory_path / f'{edition_id}-workinfo.json'} and {expect_directory_path / f'raw-metadata-{legacy_edition_id}.json'}')
            if actual_json_content == expect_json_content:
                total_ok_characters += len(actual_json_content)
                total_ok_lines += len(actual_json_content.splitlines())
            else:
                print(f'{work_id}: edition {edition_id} raw metadata mismatch?')
            with open(actual_directory_path / f'{edition_id}-rawtrack.json') as f:
                actual_json_content = f.read()
            with open(expect_directory_path / f'raw-tracks-{legacy_edition_id}.json') as f:
                expect_json_content = f.read()
            # print(f'{work_id}: compare {actual_directory_path / f'{edition_id}-rawtrack.json'} and {expect_directory_path / f'raw-tracks-{legacy_edition_id}.json'}')
            if actual_json_content == expect_json_content:
                total_ok_characters += len(actual_json_content)
                total_ok_lines += len(actual_json_content.splitlines())
            else:
                print(f'{work_id}: edition {edition_id} raw tracks mismatch?')

    print(f'total match bytes {total_ok_bytes} characters {total_ok_characters} lines {total_ok_lines}')

def backup_metadata():
    records = []
    # 1. simply include all metadata.json
    with io.BytesIO() as memory_fileobj:
        with tarfile.open(f'metadata.tar.xz', 'w:xz', fileobj=memory_fileobj) as tar:
            for directory_path in pathlib.Path('/result').iterdir():
                if not directory_path.name.startswith('RJ'):
                    continue
                work_path = directory_path
                with open(work_path / 'metadata.json') as f:
                    metadata_text = f.read()
                metadata = json.loads(metadata_text)
                # clean up
                metadata.pop('providerLink')
                metadata.pop('providerProviderLink')
                metadata.pop('actors')
                metadata.pop('providerTags')
                metadata.pop('languageEditions')
                metadata.pop('audioFormat')
                metadata.pop('subtitleFormat', 0)
                metadata.pop('autoGeneratedSubtitle', 0)

                # now you need the flatten operation here, for stat inspection only you can put an arbitrary number
                # for track in metadata['tracks']:
                #     track['size'] = 12345678
                #     track['providerPath'] = 43
                #     if 'subtitleProviderPath' in track:
                #         track['subtitleProviderPath'] = 42

                work_id = f'RJ{int(metadata['id'][2:]):08}'
                info = tarfile.TarInfo(name=f'{work_id}.json')
                mtime = datetime.datetime.strptime(metadata['addTime'], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.UTC).timestamp()
                info = info.replace(mode=0o644, mtime=mtime)
                metadata_bytes = json.dumps(metadata, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                info.size = len(metadata_bytes)
                with io.BytesIO(metadata_bytes) as metadata_memory_fileobj:
                    tar.addfile(info, fileobj=metadata_memory_fileobj)
        result = memory_fileobj.getvalue()
        print(f'direct metadata.tar.xz size {len(result)}')
        encoded_text = base64.b85encode(result)
        LINE_WIDTH = 128
        b = b''
        for position in range(0, len(encoded_text), LINE_WIDTH):
            b += encoded_text[position:position + LINE_WIDTH] + b'\n'
        print('write metadata.txt')
        with open('metadata.txt', 'wb') as f:
            f.write(b)

def assert_eq(lhs, rhs, message_header, comp=None):
    # why do lambda without paren syntax error?
    comp = comp or (lambda l, r: l == r)
    assert comp(lhs, rhs), f'{message_header}: {lhs} != {rhs}'

def check_restore_metadata():
    with open('metadata.txt') as f:
        formatted_encoded_text = f.read()
    encoded_text = formatted_encoded_text.replace('\n', '')
    decoded_binary = base64.b85decode(encoded_text)
    with io.BytesIO(decoded_binary) as tar_fileobj:
        with tarfile.open(mode='r:xz', fileobj=tar_fileobj) as tar:
            pair_count = 0
            for member in tar.getmembers():
                extract_fileobj = tar.extractfile(member)
                extract_metadata = json.load(extract_fileobj)

                legacy_work_id = int(pathlib.Path(member.name).stem[2:])
                legacy_work_id = f'RJ{legacy_work_id:06}' if legacy_work_id < 100_0000 else f'RJ{legacy_work_id:08}'
                original_metadata_path = pathlib.Path('/result') / legacy_work_id / 'metadata.json'
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
                assert_eq(extract_metadata['audioWorkId'], original_metadata['audioWorkId'], member.name)
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
                pair_count += 9
                with open(pathlib.Path('/work/temprestore') / member.name, 'w') as f:
                    json.dump(extract_metadata, f, ensure_ascii=False, indent=2)
            print(f'compare pass {pair_count} pairs of values')

# make_archives(overwrite=True, stat=True)
# restore_archives()
# backup_metadata()
check_restore_metadata()
