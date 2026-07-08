autotrack: AUTOnomous sensory meridian response audio TRACK local storage management tool

meridian first mean the vertical lines in grid system on a sphere, like 120N line on earth is a meridian,
and later extended to represent 经络 in traditional chinese medicine, and later is use to refer sexual climate in internet slang?

vtt is a more popular subtitle format in my provider's data, others use lrc, no other subtitle format seen for now

vtt is designed for html5 caption feature (the difference between subtitle and caption seems to be subtitle being translated text
other than original media's language, caption being accessiblity feature to support users without sound functionality), vtt has a
specification at w3c https://w3c.github.io/webvtt/, vtt is inspired by the srt format, or subrip text format provided by the subrip
software https://en.wikipedia.org/wiki/SubRip, which is an early 2000s *free* software, you may have learned difference betwee free
software and open source software and know free software community is created at 1980s, and become great with gnu project and linux
kernel, and read the classic list of free software examples for many times, which does not include this, which may be refreshing to you

lrc format https://en.wikipedia.org/wiki/LRC_(file_format) comes with another 2000s free software called "Kuo lyrics displayer"
by a developer from taiwan province, which is an winamp plugin and according to ai is the first software piece to provide the user
experience to display lyrics at real time along with music playing and provide a listbox to display recent lyrics, I guess it is then
welcomed by free software community, and later years the good development of "Chinese music" (you can have like 100 books discussing
about this topic comparing to chinese music industry nowadays, but not here), the trend of "internet shared free music" (pirate music),
and the good selling of cheap mp3 players (山寨) and development of karaoke (shops?) adopted this technology to support real time
lyrics, making this format the defacto standard in Chinese and CJK music community, without a formal standard or specification, this
make some spec-favor developers like me a bit confusing, but there is still some "official" things to reference, that the software
source code is still available on wayback machine https://web.archive.org/web/19990129022949/http://www.fortunecity.com/tinpan/tricky/483/vislyric.html,
downloading and extracting this you see some vc++ project files, some c source code files and an evil gpl license text, which according
to ai I cannot put any part of the code in this repository because this repository is licensed under apl, it's not a big trouble because
the original logic is very simple thus the format specification will be very simple and I can easily describe it in my implementation 

```sh
wslc -it --gpus all python
uv init
uv add openai-whisper
# if you forget to -v, use cat largefile.bin | wslc exec -i <container_name> sh -c 'cat > /path/in/container/largefile.bin'
# while powershell don't have cat, you need get-content -asbytestream for pwsh and get-content -encoding byte for windows powershell
# UPDATE windows powershell cannot work and memory leak?
apt install ffmpeg
# model file will be in ~/.cache/whisper
.venv/bin/whisper 4.mp3 --language ja
# and have output! no need to install nvidia drivers and something like cuda library?
```
