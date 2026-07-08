autotrack: AUTOnomous sensory meridian response audio TRACK local storage management tool

meridian first mean the vertical lines in grid system on a sphere, like 120N line on earth is a meridian,
and later extended to represent 经络 in traditional chinese medicine, and later is use to refer sexual climate in internet slang?

### Subtitle Formats

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

### Auto Transcription

by the way, if you think the universe history begins when human has attention, speech recognition is already using
neural networks before that, so name current era asr models "attention based models" seems better than "llm based"
as they are very small comparing to major language models, see wiki https://en.wikipedia.org/wiki/Speech_recognition

for japanese speech recognition used in this project, you'd better want a japaness people researched/created model,
but there is none, so fallback to other cjk people created model, use qwen https://huggingface.co/Qwen/Qwen3-ASR-1.7B,
by the way, to add timestamps to generated text, need an aligner https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B

to make gpu available in wsl, you need some setup, see https://docs.nvidia.com/cuda/wsl-user-guide/index.html and
https://docs.docker.com/desktop/features/gpu/, note that wsl docker with normal linux installation approach is *very*
different from docker desktop for windows, I'd assume you have known this if you choose to do the not recommended way,
while at the time of writing, wsl containers gets beta with gpu access as one of the examples and performance as one
of selling points, https://devblogs.microsoft.com/commandline/wsl-container-is-now-available-for-public-preview/, try
use this, run `wslc run -it --gpus all debian nvidia-smi` to see your gpu available in container environment, as it's
displaying my windows graphics card driver version, I think no need of separate driver installation inside containers

qwen-asr recommends vllm and flash attention, etc. optimization approaches in readme, but you may want to avoid
optional operations and confirm it works first, to use a huggingface model you simply write `{repoowner}/{reponame}`
similar to github repository reference, if you have network issues in inference site, you can download it from other
place by `from huggingface_hub import snapshot_download; snapshot_download(repo_id=f'{repoowner}/{reponame}')`, and
pack the cache directory or share the cache directory to use it, if you have more network issues, you can download
it manually from huggingface web page, similar to download a zip file from github web page, difference is that model
reporistory normally have one or several very large tensor files, while total file count is normally low, and bundle
them inside a zip file will not help reduce network traffic but will need very long time and cpu cost to decompress
the file, after you download all the files (README, LICENSE, etc. files not really needed of course), change the repo
name reference in source code to the local path containing these files seems good

before you stablize the operations and scriptify them into a dockerfile, you may want to temporary persist the cache
files to avoid duplicate download between container instances, currently I'm using a generic uv image as base image,
uv cache see docs https://docs.astral.sh/uv/concepts/cache/#cache-directory, UV_CACHE_DIR or default to ~/.cache/uv,
huggingface cache see docs https://huggingface.co/docs/transformers/v5.13.0/en/installation#cache-directory, which is
HF_HUB_CACHE or default to ~/.cache/huggingface

to use the qwen asr models, its own readme recommends the dedicated qwen-asr python package, while huggingface also
has dedicated page for qwen asr https://huggingface.co/docs/transformers/v5.13.0/en/model_doc/qwen3_asr, reading its
source code https://github.com/QwenLM/Qwen3-ASR/tree/main/qwen_asr you can see it's not large library but still doing
a lot of works so I'd like to investigate the detail later and use qwen-asr package for now
