autotrack: AUTOnomous sensory meridian response audio TRACK local storage management tool

meridian first mean the vertical lines in grid system on a sphere, like 120N line on earth is a meridian,
and later extended to represent 经络 in traditional chinese medicine, and later is use to refer sexual climate in internet slang?

### Storage File Structure

- metadata.json: main metadata use by client
- cover.avif: cover image
- track{index}.{audioformat}: audio tracks, e.g. track1.opus
- track{index}.{subtitleformat}: subtitle files, e.g. track1.vss
- cover.jpg: raw cover image archive
- {workid}-workinfo.json: raw metadata archive
- {workid}-fileinfo.json: raw metadata archive
- {workid}-file{fileindex}.{samesuffix}: raw file archive

design principle

- the name of workinfo follow it's provider api path
- the name of fileinfo should be more aligned with workinfo comparing to its api path "tracks"
- use same naming convention for main work raw metadata and edition work raw metadata should make it easier to process
- although raw archive file names have a work id integrated and can be put in same directory, group them by main work seems better
- for actual files use same naming convention as raw metadata to indicate it's a raw file,
  this also unifies track audio and subtitle raw file and extra interesting raw file's naming convention

current workflow

- docker, $WORKDIR is main directory for works
  manage.ts: docker run -it --rm --name asmr1 -v .:/work -v $WORKDIR:/result -h ASMR -w /work my/node
  backup.py: docker run -it --rm --name asmr3 -v .:/work -v $WORKDIR:/activework -v ./asmr:/archivework -h ASMR -w /work my/python
  transcribe.py: wslc run -it --rm --name asr1 --gpus all -v .:/data -h ASR -w /work my/asr
- manage.ts WORKID: add a new work, this will download raw metadata and create initial metadata
- manage.ts WORKID add 1:10 (sub RJ12345678/2:20:2): add tracks and optionally subtitles,
  this will NOT actually download files
- manage.ts WORKID dry: check files to download
  manage.ts WORKID commit: actually download files
  manage.ts WORKID extra 1: download extra files
- manage.py WORKID avif: convert cover image to avif
  manage.py WORKID opus: convert audio files to opus
  manage.ts WORKID audio: mark audio file conversion complete
- manage.ts WORKID subtitle: for most works, convert vtt/lrc subtitles to vss format,
  - manage.py WORKID pdfsub: convert pdf subtitles to txt format
  - manage.ts WORKID subtitle: mark subtitle file conversion complete
- transcribe.py WORKID: auto transcribe tracks
  - manage.ts WORKID mark-asr: mark tracks to use asr, and mark subtitle file conversion complete
- manage.py raw-metadata: backup raw metadata
- manage.py metadata: backup metadata
- backup.py local-backup: create a local backup

### Subtitle Formats

vtt is a more popular subtitle format in my provider's data, others use lrc, no other format seen for now

vtt is designed for html5 caption feature (the difference between subtitle and caption seems to be subtitle being
translated text other than original media's language, caption being accessibility feature to support users without
sound functionality), vtt has a specification at w3c https://w3c.github.io/webvtt/, it is inspired by srt format,
or SubRip Text format provided by the subrip software https://en.wikipedia.org/wiki/SubRip, this is an early 2000s
*free* software, you may have learned the difference betwee free softwares and open source softwares and know free
software community is created at 1980s, and become great with gnu project and linux kernel, and read the classical
list of free software examples for many times, which does not include this, which is refreshing

lrc file format https://en.wikipedia.org/wiki/LRC_(file_format) comes with another 2000s free software "Kuo lyrics
displayer" by a developer from taiwan province, which is an winamp plugin, ai says it's the first software piece to
provide the user experience to display lyrics at real time along with music playing and recent lyrics in a sibling
listbox, and later years the development of Chinese music industry (you can have millions of articles talking about
this topic comparing to current music industry, but not here), the trending of "internet shared free music" (pirate
music), and the good selling of cheap mp3 players (山寨) and development of karaoke (shops?) adopted this technology
to support real time lyrics, making this format the defacto standard in cjk (cj?) music community, without a formal
standard or specification, this make some spec-favor developers like me a bit confusing, but some kind of "official"
reference still exists, that the software source code is still available via wayback machine
https://web.archive.org/web/19990129022949/http://www.fortunecity.com/tinpan/tricky/483/vislyric.html, downloading
and extracting this you see some vc++ project files (they are binary files if you come from sln+vcxproj era or even
slnx era), some c source code files and an evil gplv2 license file, which according to ai I cannot put any part of
the source code in this repository because this repository is licensed under apache, it's not a big problem because
the original logic is simple and I can easily describe it in my implementation

UPDATE what do you mean by the original implementation does support sub-second part?

### Server

this project itself don't include a server to serving the files, because any static content server will work

but you may need to specifically allow subtitle files if your static content middleware check file extensions, vtt
has web standard and may be supported, if you need explicit config, it has mime type text/vtt, lrc is not common in
this area, and don't have a dedicated mime type, use text/plain, vss is currently my choice to my personal standard
for very simple subtitles, it is unexpectedly default supported by asp.net core because it is same as visio's old
file format, *by coincidence*, this may not be true for your static content server, and it also don't have an mime
type and should use text/plain

by the way, asp.net core static file middleware default supported extensions
see https://github.com/dotnet/aspnetcore/blob/main/src/Middleware/StaticFiles/src/StaticFileMiddleware.cs#L41
and https://github.com/dotnet/aspnetcore/blob/main/src/Middleware/StaticFiles/src/FileExtensionContentTypeProvider.cs,
I use url with main branch because I assume this code will not change in future, if it is not true you may have to
use your intelligence to find them again?

UPDATE what do you mean by .flac is not default included?
UPDATE .ogg is default included, .opus is not default included

### Auto Transcription

by the way, if you think the universe begins when attention is noticed, speech recognition is already using neural
networks and other pre-transformer ai technologies before transformers, or even 1980s ai technologies at 1980s, or
even is investigated before internet era with computer systems without internet, so "attention based model" may be
a better name for "llm based models", plus the reason that attention based asr models have less parameters compare
to other text or multimodal models, see also wiki https://en.wikipedia.org/wiki/Speech_recognition

for japanese speech recognition required in this project, you may want a japanese people or organization researched
model for it's level of understanding, but there is none, so fallback to cjk organization researched asr model, use
qwen asr https://huggingface.co/Qwen/Qwen3-ASR-1.7B, to add timestamp to generated text, also need a forced aligner
https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B, and maybe a translation model later

to make gpu available in wsl, you seems need some setup, see https://docs.nvidia.com/cuda/wsl-user-guide/index.html
and https://docs.docker.com/desktop/features/gpu/, note the docker desktop for windows and docker engine on wsl are
completely different softwares, you may find docker desktop include something like docker engine, but they are very
different programs, e.g. the docker model example is not available in docker engine, oh, wsl released wsl container
see https://devblogs.microsoft.com/commandline/wsl-container-is-now-available-for-public-preview/, which have more
performance and more gpu performance than normal wsl docker environment, run `wslc run --gpus all debian nvidia-smi`
after upgrade to see gpu is available in this environment, no need to install graphics card driver inside container
because it's a kernel level program and are shared between host and container programs

you may want to confirm any model actually works before follow instructions for optional additional functionalities
and optimizations, this is very simple with nowadays ai infrastructure, just `uv add transformers` and use a github
similar syntax `{orgname}/{reponame}` to reference a model from huggingface hub in the pipelines api, official docs
https://huggingface.co/docs/transformers/pipeline_tutorial, and everything works!...or should work after completion
of downloading of python libraries and model files, if your inference site don't have a suitable network setup to
download this amount and size of files (one or several files that reach 4 or 5gb, normally safetensor files contain
actual parameter values of the model), you can download the model files from other location using `huggingface_hub`
library by `huggingface_hub.snapshot_download(repo_id=repo_id)`, and take the files or share the files to use, if
you still don't have such network setup like me, you can manually download the files from huggingface hub web page,
similar to downloading files from github web page, and change the repo name in source code to the local folder path
and it should work, by the way, huggingface web page does not provide a zip download like github web page, I guess
compressing and decompressing such large file is waste of cpu time and human time comparing to download other small
files manually or automatically as the amount of files in a huggingface repo seems to be normally low

the default cache directory for huggingface libraries is at ~/.cache/huggingface or specificed by HF_HUB_CACHE, see
https://huggingface.co/docs/transformers/v5.13.0/en/installation#cache-directory, you may want to map it in docker
run or docker build, by the way, uv default cache directory is at ~/.cache/uv or specificed by UV_CACHE_DIR, if you
see torch and it's dependent python cuda libraries is large and take long time to download you may need to map this

qwen-asr document recommends using its dedeicated python library qwen-asr to use its models, the source code is at
https://github.com/QwenLM/Qwen3-ASR/tree/main/qwen_asr, huggingface document has a dedicated document page for this
model at https://huggingface.co/docs/transformers/v5.13.0/en/model_doc/qwen3_asr without the same library, you can
see the library don't have many python files and may be simple to understand, but currently I don't want to dive in
it and will use the qwen-asr library for now UPDATE hf document on this model does not work current versions

basic code snippet:

```py
import torch
from qwen_asr import Qwen3ASRModel
model = Qwen3ASRModel.from_pretrained('/work/models/Qwen3-ASR-1.7B', dtype=torch.bfloat16, device_map='cuda:0')
results = model.transcribe(audio="track1.mp3", language='Japanese')
print(results[0].text)
```

with forced aligner:

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

qwen-asr recommends flash attention https://github.com/Dao-AILab/flash-attention to improve
performance, run `uv add flash-attn --no-build-isolation` and add parameters to both models:

```py
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
```

beside qwen-asr document and a gpu perf article on huggingface documents
https://huggingface.co/docs/transformers/main/en/perf_infer_gpu_one#flashattention you can also find flash attn
at https://huggingface.co/docs/transformers/en/model_doc/wav2vec2, I find this by ai recommends something called
wav2vec2ctc when I'm complaining about low quality of timestamps, currently I don't understand what's this doing,
how does this affect the result quality, whether it will be affective to other workflows of this project and not
sure whether I will understand these questions in future

you may see some compilation errors and uv indicates to disable build isolation or add extra build dependencies,
the build isolation mechanism looks like a good modern isolation scheme, but this library is very academic and will
not follow modern software engineering practice and disable build isolation is the correct answer, do not use extra
build dependencies here

you may see some compilation errors indicating cuda related directories environment variables, this means the cuda
compiler is missing, there is cuda compiler and cuda runtime difference similar to to gcc vs libc, jdk vs jre, sdk
vs runtime, etc. before you start downloading the huge cuda development environment, you should check the graphics
card and driver for supported cuda version, note that nvidia-smi displayed cuda version is the *maximum* supported
version, this is one of the constraints, do not make the final decision here. after installation you can check cuda
compiler version with `nvcc --version`

by the way why is nvidia/cuda:devel image display 4.33g on wsl docker but 7.8g on wslc?

then you need a pytorch version with appropriote associate cuda version, to fix cuda version of pytorch version, do
not follow pytorch document https://pytorch.org/get-started/locally/ to run pip with a temporary index url, but see
uv document https://docs.astral.sh/uv/guides/integration/pytorch/ to write down index url persistently, like

```ini, why vscode default not color toml in builtin markdown language server?
# an index
[[tool.uv.index]]
name = "pytorch-cu130"
url = "https://download.pytorch.org/whl/cu130"
explicit = true

# a source
[tool.uv.sources]
torch = [{ index = "pytorch-cu130" }]

# and finally specify torch version in dependencies
dependencies = [
    ...
    "torch==2.13.0"
    ...
]
```

this index url will overwrite your uv system level index url and may be very slow, you may need to skip to manually
download wheel files and install with uv pip, or if you are lucky your mirror provides torch with your desired cuda
version, this may cause similar tragedies like temporary index url if you forget this and come back in future.
after the final solution check torch associated cuda version by `torch.version.cuda`

you may see a github release asset download url in your flash attention compilation error, and find the referenced
asset does not exist because the url does not open, that's because flash attention only have limited configuration
combinations of prebuilt wheel files, and v2 is an old version as you see the project readme is mainly about v3 and
v4, and the releases page only contains v4 versions, you need to click the tags button to find v2 assets associated
with old python version, old pytorch version, old cuda version and different c++ abi conditions, this is one of the
constraints, do not make the final decision here

by the way `uv add flash-attn-very-long-complex-version-spec.whl` will cause `uv run main.py` to run uninstall and
reinstall of the package every time (without really spending time) and I don't understand the uv design and the ai
explanation currently, instead of this using `uv pip install flash-attn.whl` will not trigger this issue, this does
not update pyproject.toml so should not be good for publishing but ok for this requirement

another approach is building flash attention from source, for a bare pyproject with only torch installed, you need
to install psutil, what's the matter with psutil here? currently my advanced can-run-inference machine is not good
enough to build with flash attention and cuda compiler's default parallel setting, and to make things worse, wslc
does not respect docker run's --memory parameter and is fixed at 16gb for now (not sure whether it is 16gb or half
of the physical memory), you need to restrict parallelism by one or some of env var `MAX_JOBS`, `NVCC_THREADS` and
`UV_CONCURRENT_BUILDS`, not sure how they related to each other and whether the uv variable really related to this
process, according to my attempt NVCC_THREADS=2 works good to keep memory consumption within about 5 hours building
time, I guess the result .so file is the major building result and you can take it to avoid another build time, the
build time and resource usage is one of the constraints, do not make the final decision here

by the way, flash attention build output also indicates using ninja to improve performance, you can install that by
downloading a single executable from github? but I do not have a comparson result

qwen-asr itself is also an old library, with more than half year not updated at the time of writing, it depends on
an old transformers version, while I cannot find transformers' torch dependency version in its project? if you are
going to use the advanced qwen3.5 model for translating, it does not work with such old version, and to make things
worse, v5 migration guide is very long https://github.com/huggingface/transformers/blob/main/MIGRATION_GUIDE_V5.md,
this is one of the constraints, do not make the final decision here

qwen-asr recommends vllm https://vllm.ai to improve performance, it depends on an very old version of vllm library,
while vllm itself also contains cuda source code and is tightly coupled with cuda version and torch version and has
limited prebuilt configuration combinations like flash attn, to make things worse, it also depends on trasnformers
for some common functionalities, to make things even worse, the torch version in the vllm version of the latest asr
library version is lower than the latest torch version in flash attn's prebuilt assets that match other constraints,
this is one of the constraints, do not make the final decision here

oh, constraint list complete, now you can solve the dependency graph, uv can help you solve part of it, but not for
cuda compiler and runtime version, so you need to solve the complete graph on your own, ai says conda sometimes can
help solving with cuda version, but not for now, good news is that nowadays container based environment don't fight
with each other or break system packages, bad news is that beside uv dependency errors and native dependency errors
raised at load time, there are also runtime python api compatibility errors and dynamic loading dependencies api and
abi compatibility errors

the complexity of constraint resolving decrease the relative cost to try to understand qwen-asr library source code,
good findings are it's cutting audio files on its own and chunk size for forced aligner model is very small and my 3
min attempt will be cut again, possibly contributing to the the timestamp result quality issue, bad news is that the
forced aligner does not go through vllm, so vllm cannot improve it's quality

current conclusion

- openai whisper transcription result moderate, timestamp result bad
- basic qwen-asr trasncription result moderate, timestamp result bad
- qwen-asr + flash-attn transcrption result good, timestamp result bad
- qwen-asr + flash-attn + vllm failed to setup
- by the way, qwen3.5-2b translation result bad
- qwen-asr recommends torch.compile to improve performance, appearantly skip
- you can finetune an audio model for output quality, this should consume similar
  resource as training while my current machine cannot quite handle cuda compiling, so skip

I assume my dataset is too difficult for the generic forced aligner model?

the current implementation run transcrption only and even distribute the sentences into time range
by character length, which is amazingly the highest quality I can get in the investigation process

current workflow:

- manage.ts migrate prepare WORKID: copy track files to Input directory
- uv run transcribe.py: auto transcribe
- manage.ts migrate take WORKID: copy result files into track directory
- manage.ts migrate use WORKID VSSVER: use vss version and mark work as has subtitle

### Base85 Versions

according to python document, there are multiple base85 versions,
see https://docs.python.org/3/library/base64.html#base85-encodings, see wiki https://en.wikipedia.org/wiki/Ascii85

first there is a unix utility btoa to encode binary printable ascii, but

- cannot find it in unix or bsd (original bsd) source code?
- cannot find it in freebsd https://github.com/freebsd/freebsd-src or openbsd https://github.com/openbsd/src source code?
- can find it in freebsd ports https://github.com/freebsd/freebsd-ports/tree/main/converters/btoa
  and openbsd ports https://github.com/openbsd/ports/tree/master/converters/btoa as a 3rd party package port?
- the ports repositories don't have original source code before patch,
  - openbsd port makefile have a url but the domain is expired?
  - freebsd port have a MASTER_SITES
    in makefile https://github.com/freebsd/freebsd-ports/blob/2f8a34d30d6bc2dbb0bcef6bca3900f7dab02dfc/converters/btoa/Makefile,
    according to https://github.com/freebsd/freebsd-ports/blob/2f8a34d30d6bc2dbb0bcef6bca3900f7dab02dfc/Mk/bsd.sites.mk
    it is something like http://distcache.FreeBSD.org/local-distfiles but the domain is now an alias to https://pkg.freebsd.org?
  - cannot understand how these port repositories work
- wiki has a mail session archive talking about character set change, which is a google groups archive
  https://groups.google.com/g/comp.compression/c/Ve7k8XF-F5k/m/gBWfpyL-gfgJ which is confusing because
  the dates are 1991 but google is not created at that time?
- have to believe wiki that they use characters from whitespace (0x20) to t (0x74) inclusive at first
  and later change to ! (0x21) to u (0x75) inclusive to avoid whitespace handling (like trim) in some mail programs
- this version is also used in pdf 2.0 (ISO 32000-2) but this is not last century's news?
  this is an ISO standard so I'm not trying to obtain it and look for this not important things
- but you can always see python source code, base64.a85encode is at
  https://github.com/python/cpython/blob/abdd7aea18bde039fe35983b5c0d8036bc16f1a7/Modules/binascii.c#L236,
  it is from ! to u, and will do z for 4 zeros and y for 4 whitespaces

as base64 function is called b64encode you may expect b85encode as the formal function for base85, but this comes from
an april fool's joke? in rfc https://datatracker.ietf.org/doc/html/rfc1924.html? and why do python docs and wiki section
https://en.wikipedia.org/wiki/Ascii85#RFC_1924_version talks about an april fool's joke so calmly?

- rfc1924 character set:   0-9, A-Z, a-z, !#$%&()*+-;<=>?@^_`{|}~
- git base85 character set 0-9, A-Z, a-z, !#$%&()*+-;<=>?@^_`{|}~
  see https://github.com/git/git/blob/44de1520f08d1dfebc3ab2d9f644208eaa5ac925/base85.c
- python source code                      !#$%&()*+-;<=>?@^_`{|}~
  see https://github.com/python/cpython/blob/abdd7aea18bde039fe35983b5c0d8036bc16f1a7/Modules/binascii.c#L232

and a zeromq version, use char set 0-9, a-z, A-Z, .-:+=^!/*?&<>()[]{}@%$#
see https://github.com/python/cpython/blob/abdd7aea18bde039fe35983b5c0d8036bc16f1a7/Modules/binascii.c#L2747 

- avoids quote mark and escape mark so to easily write in source code
- added in version 3.13, so ai may not know this, and not available in distro with python3.12,
  bpo created in aug 2017 https://github.com/python/cpython/issues/75299, but finally added in 2024?
- the issue links a zeromq rfc https://rfc.zeromq.org/spec/32/ but how is the rfc used in zeromq?
  the source code is easily at https://github.com/zeromq/pyzmq/blob/8aef37e428bc0bb012c7dc29382f1a5d7a46c080/zmq/utils/z85.py#L20
- search zeromq docs shows they use it genericly for multiple locations that need binary

for this project, use b85encode to avoid the question: why is this a85/z85 not b85 similar to b64encode

### Backup

although github actions is very unreliable in recent years, github is still a relative reliable location for backup purpose

to avoid direct sexsual content in github, although I think this level of such content is very ok for github and for a no one
care repository, also considering raw track files are very large and contain a lot of redundent information, that have a full
work title in all records, and have multiple duplicate url encoded titles in all records, and most works include less than 10
tracks while most works have tens of records and some works have hundreds, and the solution is to bundle and compress the files,
no password needed because they are already public information from provider and provider provider

binary files do not work well with git, base64 them into text and split into normal width lines may be good, and makes them
somewhat looks like a git tracked minified js library, not good enough but will work UPDATE use base85 to reduce more file size

collect stat:

- tar.xz raw metadata, raw tracks and cover image result in min 11kb max 72kb avg 32kb,
  after base85 get max 90kb, avg 40kb, that is about 700 lines of 128 characters per line
- oh, forget to minify json, that is -0.2kb avg size
  - UPDATE oh, forget python json library default to avoid non ascii characters in output, disable that get -0.18kb avg size
  - UPDATE what do you mean by json.dump default use whitespace for comma and colon? disable that get -25b (not kb) avg size
- oh, convert jpg to avif result in avg 17kb, indicating jpeg format is not very efficient comparing to avif, and image files
  are taking large portion of the archive file size and is not suitable to compress image and json files together
- exclude image files, put jpeg beside tar.xz file result in -0.1kb,
  or uncompressed jpeg + compressed json - compressed jpeg and json = -0.1kb
  and uncompressed avif + compressed json - compressed avif and json = -0.15kb
- so exclude cover image and json file only use avg 5kb, indicating the raw track files have too much duplicate information
  and result in a good compression rate
- by the way, use a85encode instead of b85encode reduce 50b (not kb) avg size, indicating that avif format and xz format is
  already using space efficiently and a85's extension does not improve compression rate effectively
- by the way, rename entries will not cause complete change in result because tar and b85 are not hash, but xz is kind of hash,
  it will become completely different in the middle if change one of the entry name
- max 40kb binary which is 50kb text, which is similar to 30kb build-script.md, container.md, and is smaller than 90kb ipv6.md

additional stat that appears later

- direct bundle result in 100kb binary, json minify get 98kb (this is all work total, not avg)
- remove redundent top level properties and change provider path and subtitle provider path to index get 60kb
- UPDATE after data structure updates after backup strategy stabilize, the text file is about 90kb, which is acceptable

file structure considerations

- metadata is mutable, raw metadata files (include raw track records) are immutable, should not put one work's
  raw metadata and metadata in one file to avoid frequently update a file that most of the part is not changed
- as concluted that cover image and json files should not be in one compressed file, base85 encode their content
  separately and split into lines separately and put them in one text file separated by additional one empty line
- it's not convenient to distinguish main work and edition work's raw metadata files with different
  naming conventions, make them same
- name archive file A12345678.txt, A for archive, avoid RJ to reduce discoverability by plain search?
  distinguish \d{6} work id and \d{8} work id is inconvenient, unify them to \d{8}
- avoid properties in metadata that is directly available in raw metadata, like provider link and provider tags
- about main metadata backup format
  - use a custom format similar to yml to reduce size UPDATE not good
  - use a custom format similar to yml without meaningful property name to reduce size UPDATE not good
  - use a custom format similar to csv to reduce size UPDATE not good
  - use something like hash file structure?
    e.g. put file names 12xxxx in folder 12, 34xxxx in folder 34
    e.g. put id 12345678 in file M8.txt, put id 23456789 in M9.txt UPDATE not good, complex to implement
- all of the above approaches are hard to understand and may cause error in the conversion process
  and the result is bundle all metadata files in one compressed file, the result is about 100kb which is ok

### Audio Codec

ai tells me the new audio codec that has similar position as webp in image codec area (like 10+ years old widely
supported new, not avif's less than 10 years old new) is opus

and tells me to use `-ar 48000 -q:a 5 -c:a libvorbis` as ffmpeg parameter, which is very incorrect, while ar means
audio sample rate, it is normally always 48khz in normal audio files, while q:a quality parameter 5 seems a middle
value, it is higher than default value 3, and 1 is still very good for my files and kind of large, 80kbps I guess,
the c:a encoder parameter may be a matching magic value if you are not familiar with this area, but it is literally
incorrect, vorbis is old format and opus supersedes vorbis format, you need to explicitly know the name of libopus
to make ai compare them to find the relationship, to work with libopus, change the q parameter to a more explicit b
parameter for bitrate value, and 32kbps is still good for my files (16kbps is bad if you try)

- vorbis home page https://xiph.org/vorbis/
- vorbis wiki https://en.wikipedia.org/wiki/Vorbis
- vorbis spec https://xiph.org/vorbis/doc/Vorbis_I_spec.html
- opus home page https://www.opus-codec.org/,
  vorbis and opus are both developed by xiph.org, opus has a button at vorbis/xiph web page header
- opus wiki https://en.wikipedia.org/wiki/Opus_(audio_format)
- opus spec https://datatracker.ietf.org/doc/html/rfc6716
- also see ogg+opus spec https://datatracker.ietf.org/doc/html/rfc7845
  section 9 say recommended mime type is audio/ogg, recommended filename extension is .opus

the deprecation statement can be found at
https://wiki.xiph.org/index.php?title=OpusFAQ&oldid=13856#Does_Opus_make_all_those_other_lossy_codecs_obsolete?
technically deprecation should be enough for saying vorbis is superseded by opus

### AI Writing

why do you put this section here? this document is completely written by human not ai, but as this document
is very topic unlimited, you can talk about ai writing as ai is already generating a lot of techincal documents

the traits that make document looks like ai generated:

- inconsistent naming: the same concept or same entity have different name in one paragraph
- redundent helper words: e.g. it is important to note that this may potentially help to improve
- verb replace with noun version: e.g. "perform an anlysis of" vs analyze
- marketing adjectives (I call thisadvertisement wording): seamless, cutting-edge, powerful, etc.
- very long sentence: although I personally don't use period, the actual sentence length is not long
- soft phrasal verbs: e.g. spin up, reach out, dive into

see also simpified English: https://www.asd-ste100.org/

### ffmpeg Commands

that use in this project

- TODO

document

- -v parameter: https://ffmpeg.org/ffmpeg.html#Generic-options
- -of parameter: https://ffmpeg.org/ffprobe.html#toc-Writers

TODO ffprobe -v error -i input.opus -select_streams a:0 -of json -show_entries stream does not include bitrate, you need format=bit_rate, why