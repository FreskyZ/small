import base64, json, sys, zlib

# factorio blueprint tool
# encode or decode import/export text format

# this is a simple feasibility analysis of possible future projects
# (include my own blueprint archive project, minimal gui blueprint editor)
# this script reads blueprint text and writes the json format or vice versa
# no command line options,
#   if input file name is .txt, output overwrite same name .json
#   if input file name is .json, output overwrite same name .txt

# requirement log from bluprint.html
# - move signal when configuration icon for blueprint/book
# - quality variant of a blueprint

if len(sys.argv) != 2:
    print('USAGE: python blueprint.py blueprint.txt or python blueprint.py blueprint.json')
    exit(1)

input_file_name = sys.argv[1]
if input_file_name.endswith('.txt'):
    print(f'reading {input_file_name}')
    with open(input_file_name, 'r') as f:
        text = f.read()
    j = json.loads(zlib.decompress(base64.b64decode(text[1:])))
    output_file_name = input_file_name[:-4] + '.json'
    print(f'writing {output_file_name}')
    with open(output_file_name, 'w') as f:
        json.dump(j, f, indent=2, ensure_ascii=False)

elif input_file_name.endswith('.json'):
    print(f'reading {input_file_name}')
    with open(input_file_name, 'r') as f:
        j = f.read()
    # TODO does the game need minify?
    json_obj = json.loads(j)
    minified = json.dumps(json_obj, separators=(',', ':'))
    compressed = zlib.compress(minified.encode('utf-8'))
    b64encoded = base64.b64encode(compressed)
    # TODO does the game require the 0 prefix? does the prefix need be 0?
    text = '0' + b64encoded.decode()
    output_file_name = input_file_name[:-5] + '.txt'
    print(f'writing {output_file_name}')
    with open(output_file_name, 'w') as f:
        f.write(text)

else:
    print('invalid file ext, expecting .txt or .json')
    print('USAGE: python blueprint.py blueprint.txt or python blueprint.py blueprint.json')
    exit(1)
