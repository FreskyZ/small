import functools
import logging
import jieba
import pandas as pd
import numpy as np
import re
import string
import zhon.hanzi as hanzi
from wordcloud import WordCloud
import matplotlib.pyplot as plt
import matplotlib.font_manager as font_manager
from PIL import Image

# postprocess bilibili live chat data, making a wordcloud
#
# input text and output image are git tracked,
# as they are public spoken and is available on many chat archive websites
#
# this script may not be suitable to run on no-GUI wsl, fix will come later,
# this script is imported from another repository, which was mainly developed in Jun 2021

mask_name = 'question' # 'cao', None

df = pd.read_csv('chat-92613-210530-200351.csv')
contents = df['content']

jieba.setLogLevel(logging.ERROR)
jieba.load_userdict('userdict.txt')
all_words = functools.reduce(lambda acc, c: acc + [w for w in jieba.cut(str(c))], contents, [])

def accept_word(word):
    return word not in string.punctuation \
        and word not in hanzi.punctuation \
        and (word.startswith('233') or not re.match(r'^[\d\.%]+$', word)) \
        and word not in [' ', '・', '`', 'ω', '´'] \
        and word not in ['的', '了', '吗', '是', '吧', '啊', '我', '你', '有', '没', '要', '一', '很', '呀', '啥', '嘛', '个', '么', '也', '这', '就']

words = [w.upper() for w in all_words if accept_word(w)]
worddict = { w: words.count(w) for w in set(words) }

worddict['？'] = len([w for w in all_words if w in ['?', '？']])
worddict['二次元'] += worddict['二刺螈'] + worddict['二刺猿'] + worddict['二起来']
del worddict['二刺螈']
del worddict['二刺猿']
del worddict['二起来']
worddict['草'] += worddict['艹']
del worddict['艹']
worddict['API'] += worddict['PI'] + worddict['屁癌']
del worddict['PI']
del worddict['屁癌']
worddict['哈哈哈'] += worddict['哈哈'] + worddict['哈哈哈哈']
del worddict['哈哈']
del worddict['哈哈哈哈']
for count3 in range(3, 20):
    key = '2' + count3 * '3'
    if key in worddict:
        worddict['233'] += worddict[key]
        del worddict[key]

# generator = WordCloud(font_path='C:\\Windows\\Fonts\\SimHei.ttf', background_color='white', width=1920, height=1080)
fontprop = font_manager.FontProperties(fname="C:\\Windows\\Fonts\\SimHei.ttf")

def random_color(word=None, font_size=None, position=None, orientation=None, font_path=None, random_state=None):
    return f'hsl({random_state.randint(75, 165)}, {random_state.randint(30, 80)}%, 40%)'

mask = np.array(Image.open('mask-cao.png' if mask_name == 'cao' else 'mask-question.png')) if mask_name is not None else None
generator = WordCloud(font_path='C:\\Windows\\Fonts\\STXihei.ttf', background_color='white', mask=mask, max_words=150, color_func=random_color)

filename = 'chat-cao.png' if mask_name == 'cao' else 'chat-question.png' if mask_name == 'question' else 'chat.png';
def save_wordcloud(wc):
    plt.clf()
    plt.imshow(wc, interpolation='bilinear')
    plt.axis('off')
    plt.tight_layout(pad=0)
    plt.title('安全驾驶直播间 - 少年Pi - 2021年5月30日 20:03:51', fontproperties=fontprop)
    plt.savefig(filename)

generator.generate_from_frequencies(worddict).to_file(filename)
