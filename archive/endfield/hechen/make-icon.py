import base64
from io import BytesIO
import json
from pathlib import Path
# from time import sleep
from PIL import Image
import requests

# open https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=6
# open devtools, find this request
# const response = await fetch('https://zonai.skland.com/web/v1/wiki/item/catalog?typeMainId=1&typeSubId=6');
# and then find this request have strict server side validation
# # why do you have strict server side validation for a wiki site?
# # manually copy response content in devtool and paste it in backup folder
# and then download, shrink images and convert to data uri

def download():
    rawWikiItems = json.load(open('backup/SklandTable.json'))
    wikiItems = rawWikiItems['data']['catalog'][0]['typeSub'][0]['items']
    items = [(value['name'], value['brief']['cover']) for value in wikiItems]

    for name, iconurl in items:
        print(f'downloading {name} from {iconurl}...', end='')
        response = requests.get(iconurl)
        response.raise_for_status()
        filename = f'icon/{Path(iconurl).name}'
        with open(filename, 'wb') as f:
            f.write(response.content)
        print(f'saved to {filename}')
        # sorry, forget to sleep, but cdn seems ok for this single threaded sequential access

    newItems = []
    for name, iconurl in items:
        filename = f'icon/{Path(iconurl).name}'
        with Image.open(filename) as image:
            if image.size != (396, 396):
                raise ValueError(f'{filename} unexpected size {image.size}')
            if image.mode == 'LA': # normalize image mode
                image.convert('RGBA')
            elif image.mode != 'RGBA':
                raise ValueError(f'{filename} unexpected mode {image.mode}')
            image = image.resize((64, 64), Image.Resampling.LANCZOS)
            buffer = BytesIO()
            # https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html#webp
            # method=6 for best quality in quality-speed trade off
            image.save(buffer, format='WEBP', quality=60, method=6)
            base64_data = base64.b64encode(buffer.getvalue()).decode('utf-8')
            print(f'{name} file {filename} data uri length {len(base64_data)}')
            newItems.append({ 'name': name, 'icon': f'data:image/webp;base64,{base64_data}' })
    with open('tmp/rawicontable.json', 'w') as f:
        json.dump(newItems, f)

def process():
    items = json.load(open('tmp/rawicontable.json'))
    bottleNames = ['紫晶质瓶', '高晶质瓶', '蓝铁瓶', '钢质瓶']
    liquidNames = ['清水', '锦草溶液', '芽针溶液', '液化息壤']

    liquidImages = {}
    for liquidName in liquidNames:
        datauri = next(item['icon'] for item in items if item['name'] == liquidName)
        encoded = datauri.split(',')[1]
        data = base64.b64decode(encoded)
        image = Image.open(BytesIO(data))
        image = image.resize((32, 32), Image.Resampling.LANCZOS)
        newImage = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
        newImage.paste(image, (16, 16))
        liquidImages[liquidName] = newImage

    for bottleName in bottleNames:
        datauri = next(item['icon'] for item in items if item['name'] == bottleName)
        encoded = datauri.split(',')[1]
        data = base64.b64decode(encoded)
        with Image.open(BytesIO(data)) as bottleImage:
            for liquidName in liquidImages:
                newImage = Image.alpha_composite(bottleImage, liquidImages[liquidName])
                newImageData = BytesIO()
                newImage.save(newImageData, format='WEBP', quality=60, method=6)
                encoded_data = base64.b64encode(newImageData.getvalue()).decode('utf-8')
                print(f'{bottleName} ({liquidName}) data uri length {len(encoded_data)}')
                items.append({ 'name': f'{bottleName} ({liquidName})', 'icon': f'data:image/webp;base64,{encoded_data}' })
    # use tmp not /tmp because python and nodejs is using different container and does not share same /tmp
    with open('tmp/icontable.json', 'w') as f:
        json.dump(items, f, ensure_ascii=False)

# download()
# process()
