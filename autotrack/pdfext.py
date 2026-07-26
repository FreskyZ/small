import pathlib, sys
from pypdf import PdfReader # uv add pypdf

# for now the only one work extract result contain a lot of non text content,
# although all visible text content do exist in result, it is not usable, leave this here for future investigation,
# the only one work is manually copied visible content in pdf reader to fix

# TODO usage
work_id = sys.argv[1]
for path in pathlib.Path(f'/activework/{work_id}').iterdir():
    if path.name.startswith('track') and path.name.endswith('.pdf'):
        print(f'read {path}')
        reader = PdfReader(path)
        text = ''
        for page in reader.pages:
            text += page.extract_text()
        with open(path.with_suffix('.txt'), 'w') as f:
            print(f'write {path.with_suffix('.txt')} text length {len(text)}')
            f.write(text)
