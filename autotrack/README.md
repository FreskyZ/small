autotrack: AUTOnomous sensory meridian response audio TRACK local storage management tool

meridian first mean the vertical lines in grid system on a sphere, like 120N line on earth is a meridian,
and later extended to represent 经络 in traditional chinese medicine, and later is use to refer sexual climate in internet slang?

### Storage File Structure

- metadata.json: main metadata use by client
- cover.jpg: cover image
- track{index}.{audioformat}: audio tracks, e.g. track1.mp3
- track{index}.{audioformat}.{subtitleformat}: subtitle files, e.g. track1.mp3.vtt
- raw-metadata.json: archive
- raw-tracks.json: archive
- raw-metadata-{editionid}.json: language edition works archive
- raw-tracks-{editionid}.json: language edition works archive

### Subtitle Formats

vtt is a more popular subtitle format in my provider's data, others use lrc, no other format seen for now

vtt is designed for html5 caption feature (the difference between subtitle and caption seems to be subtitle being
translated text other than original media's language, caption being accessiblity feature to support users without
sound functionality), vtt has a specification at w3c https://w3c.github.io/webvtt/, it is inspired by srt format,
or SubRip Text format provided by the subrip software https://en.wikipedia.org/wiki/SubRip, this is an early 2000s
*free* software, you may have learned the difference betwee free softwares and open source softwares and know free
software community is created at 1980s, and become great with gnu project and linux kernel, and read the classical
list of free software examples for many times, which does not include this, which may be refreshing to you

lrc file format https://en.wikipedia.org/wiki/LRC_(file_format) comes with another 2000s free software "Kuo lyrics
displayer" by a developer from taiwan province, which is an winamp plugin and according to ai is the first software
piece to provide the user experience to display lyrics real time along with music playing and provide a listbox to
display recent lyrics, I guess it is then welcomed by free software community, and later years the good development
of "Chinese music" (you can have like millions of articles discussing about this topic comparing to nowadays music
music industry, but not here), the trend of "internet shared free music" (pirate music), and the good sell of cheap
mp3 players (山寨) and development of karaoke (shops?) adopted this technology to support real time lyrics, making
this format the defacto standard in cjk music community, without a formal standard or specification, this make some
spec-favor developers like me a bit confusing, but there is still some "official" things to reference, is that the
software source code is still available via wayback machine https://web.archive.org/web/19990129022949/http://www.fortunecity.com/tinpan/tricky/483/vislyric.html,
downloading and extracting this you see some vc++ project files, some c source code files and an evil gpl license
file, which according to ai I cannot put any part of the source code in this repository because this repository is
licensed under apache, it's not a big problem because the original logic is simple and I can easily describe it in
my implementation

UPDATE what do you mean by the original implementation does support sub-second part?

### Server

this project itself don't include a server to serving the files, because any static content server will work

but you may need to specifically allow subtitle files if your static content middleware check file extensions,
vtt has web standard and may be supported, if you need explicit config, it has mime type text/vtt, lrc is not
that common in this area, and don't have a dedicated mime type, use text/plain, vss is currently my choice to
my personal standard for very simple subtitles, it is same default supported by asp.net core because is same as
micorosft office visio old file format, *by coincidence*, this may not be true for your static content server,
and it also don't have an mime type and should use text/plain

by the way, asp.net core static file middleware default supported extensions
see https://github.com/dotnet/aspnetcore/blob/main/src/Middleware/StaticFiles/src/StaticFileMiddleware.cs#L41
and https://github.com/dotnet/aspnetcore/blob/main/src/Middleware/StaticFiles/src/FileExtensionContentTypeProvider.cs,
I use url with main branch because I assume this code will not change in future, if it is not true you may have to
use your intelligence to find them again?

### Auto Transcription

by the way, if you think the universe begins when attention is noticed, speech recognition is already using neural
networks and other pre-transformer ai technologies before transformers, or even 1980s ai technologies at 1980s, or
even is investigated before internet era with computer systems without internet, so "attention based model" may be
a better name for "llm based models", plus the reason that attention based asr models have low count of parameters
compare to other text or multimodal models, see also wiki https://en.wikipedia.org/wiki/Speech_recognition

for japanese speech recognition required in this project, you may want a japanese people researched or created model
for it's level of related natural language understanding, but there is none, so fallback to other cjk people created
model, use qwen asr https://huggingface.co/Qwen/Qwen3-ASR-1.7B, to add timestamps to generated text, you also need a
forced aligner https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B, and a generic translation model also by qwen

to make gpu available in wsl, you seems need some setup, like https://docs.nvidia.com/cuda/wsl-user-guide/index.html
and https://docs.docker.com/desktop/features/gpu/, note that docker desktop for windows is a very different software
than normal docker linux installation in wsl if you forget, oh, wsl released wsl container at the time of writing,
https://devblogs.microsoft.com/commandline/wsl-container-is-now-available-for-public-preview/, with more performance
include more gpu performance than normal wsl and docker programs, run `wslc run --gpus all debian nvidia-smi` after
installation to see gpu available in container environment, no need to install driver inside containers because it's
kernel level programs and are shared between host and container programs

you may want to confirm any model actually works before follow instructions for optional additional functionalities
and optimizations, this is very simple with nowadays ai infrastructure, just `uv add transformers` and use a github
similar syntax `{orgname}/{reponame}` to reference a model from huggingface hub in the pipelines api, official docs
https://huggingface.co/docs/transformers/pipeline_tutorial, and everything works!...or should work after installing
of the python libraries complete and downloading of the model files complete, if your inference site don't have a
suitable network setup to download several very large files (like 4 or 5gb containing the actual parameter values),
you may download the model files from other site by `huggingface_hub.snapshot_download(repo_id=repo_id)`, and take
the file or share the files to use, if you don't have such a site like, you can manually download the files from hf
web page, using browser or related download tools, similar to download files from github web page, and change the
simple repo name syntax to a local directory path and thins should work, by the way, huggingface web page does not
provide a zip download like github web page, I guess compressing and decompressing such large file is waste of cpu
time and human time comparing to download other small files manually or automatically as the total amount of files
in a huggingface repo seems to be normally low

the default cache directory for huggingface libraries is at ~/.cache/huggingface or specificed by HF_HUB_CACHE, see
https://huggingface.co/docs/transformers/v5.13.0/en/installation#cache-directory, you may want to map it in docker
run or docker build, by the way, uv default cache directory is at ~/.cache/uv or specificed by UV_CACHE_DIR, if you
see torch and it's dependent python cuda libraries is large and take long time to download

qwen-asr document recommends using its dedeicated python library qwen-asr to use its models, the source code is at
https://github.com/QwenLM/Qwen3-ASR/tree/main/qwen_asr, huggingface document has a dedicated document page for this
model at https://huggingface.co/docs/transformers/v5.13.0/en/model_doc/qwen3_asr without this library, you can see
the library don't have many python files and may be simple to understand, but currently I don't want to dive in it
and will use the qwen-asr library for now,

simplest code snippet:

```py
import torch
from qwen_asr import Qwen3ASRModel
model = Qwen3ASRModel.from_pretrained('/work/models/Qwen3-ASR-1.7B', dtype=torch.bfloat16, device_map='cuda:0')
results = model.transcribe(audio="track1.mp3", language='Japanese')
print(results[0].text)
```

with forced aligner

```py
import torch
from qwen_asr import Qwen3ASRModel
model = Qwen3ASRModel.from_pretrained(
    '/work/models/Qwen3-ASR-1.7B',
    dtype=torch.bfloat16,
    device_map='cuda:0',
    forced_aligner='/work/models/Qwen3-ForcedAligner-0.6B',
    forced_aligner_kwargs=dict(dtype=torch.bfloat16, device_map='cuda:0'),
)
results = model.transcribe(audio="track1.mp3", language='Japanese', return_time_stamps=True)
print(results[0].text)
for item in results[0].time_stamps: print(item.start_time, item.end_time, item.text)
```

qwen-asr document recommends using flash attention https://github.com/Dao-AILab/flash-attention to improve speed of
inference and memory usage, and run `uv add flash-attn` you may see some compilation errors, and you spend many time
to download cuda devel image, and you may see some compilation errors, and you follow uv instruction to add an extra
build dependencies section in project file to depend on troch at build time? and you may see some compilation errors
and you follow previous solution to add more libraries to extra build dependencies, and you may see some compilation
errors and you see it's guessing a non exist wheel path with a githu release asset download url and you open github
and download an exist wheel with matching cuda version and rollback pytorch version and python version and it works!
note that cuda version displayed in nvidia-smi is the highest supported version of your driver and graphics card,
you may want to choose a <= and *popular* version to make setup easier, while I don't know how to find a version is
popular, but ai said version or generated example code version may be an older popular version

by the way, why is nvidia/cuda:devel image display 4.33g on wsl docker but 7.8g on wslc?

with flash attention

```py
import torch
from qwen_asr import Qwen3ASRModel
model = Qwen3ASRModel.from_pretrained(
    '/work/models/Qwen3-ASR-1.7B',
    dtype=torch.bfloat16,
    device_map='cuda:0',
    attn_implementation='flash_attention_2',
    forced_aligner='/work/models/Qwen3-ForcedAligner-0.6B',
    forced_aligner_kwargs=dict(
        dtype=torch.bfloat16,
        device_map='cuda:0',
        attn_implementation='flash_attention_2',
    ),
)
results = model.transcribe(audio="track1.mp3", language='Japanese', return_time_stamps=True)
print(results[0].text)
for item in results[0].time_stamps: print(item.start_time, item.end_time, item.text)
```

flash attention v2 is an old version and it's indicated by the prebuild asset does not support current torch version
and current python version, and it's readme is mainly talking about v3 and v4, by the way qwen-asr is also a not new
library (it's over half years not updated in ai area) and don't work with latest transformers library version at the
time of writing, you may want to read their project dependencies to avoid version conflict issues, good news is that
nowadays container based environments don't fight with each other or break system package

beside a gpu perf article https://huggingface.co/docs/transformers/main/en/perf_infer_gpu_one#flashattention talking
about flash attention, it can also be found at https://huggingface.co/docs/transformers/en/model_doc/wav2vec2, which
I know this by ai recommending something called wav2vec2ctc when I'm complaining about timestamp quality, at current
time I don't understand both of the articles and not sure whether they work with my currently models and whether they
work with my workflow or requirements, and not sure whether in future I will understand?

