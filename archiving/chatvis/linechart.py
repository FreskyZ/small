import pandas as pd
import numpy as np
from datetime import datetime
import matplotlib.pyplot as plt
import matplotlib.font_manager as font_manager

df = pd.read_csv('chat-92613-210606-193708.csv')

df['minute'] = df['time'].map(lambda t: datetime.strptime(t, '%y%m%d-%H%M%S').replace(second=0).timestamp())
df['cao'] = df['content'].map(lambda s: len([c for c in s if c == '草']))
df['ha'] = df['content'].map(lambda s: len([c for c in s if c == '哈' or c == 'h']))
df['wenhao'] = df['content'].map(lambda s: len([c for c in s if c == '?' or c == '？']))
df = df.drop(['member', 'price', 'user', 'time', 'content'], axis='columns')

gf = df.groupby('minute').sum()

fontprop = font_manager.FontProperties(fname="C:\\Windows\\Fonts\\SimHei.ttf")
plt.clf()

fig, ax = plt.subplots(sharex=True, sharey=True, num=3, figsize=(40, 10), dpi=100)

ax.set_ylabel('数量', fontproperties=fontprop)
ax.set_xlabel('时间', fontproperties=fontprop)
ax.set_xticks(np.arange(df['minute'].min(), df['minute'].max(), 900))
ax.get_xaxis().set_major_formatter(lambda s,p: datetime.fromtimestamp(s).strftime('%H:%M'))

ax.plot(gf.index, gf['cao'], label='草')
ax.plot(gf.index, gf['ha'], label='哈')
ax.plot(gf.index, gf['wenhao'], label='？')

plt.legend(prop=fontprop)
plt.savefig('chatlc.png')