# this is for asr workflow, for autotrack.ts you just run it with any node image

# # what do you mean by vscode opening windows files default to crlf and *wslc* build not recognize that?
# # this base image is ubuntu if have not noticed
# wslc build --tag my/at .
# wslc run -it --rm --name at1 --gpus all -v ./Data:/work/data -v ./Models:/work/models -h AT -w /work my/at
FROM nvidia/cuda:13.0.3-cudnn-devel-ubuntu24.04

# apt setup, expect no change
RUN <<EORUN
set -ex
# apt setup
apt-get update
apt-get install -y --no-install-recommends ca-certificates
update-ca-certificates
sed -i 's|http://archive.ubuntu.com/ubuntu/|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources
apt-get update
EORUN

# uv and python setup, expect no change
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /uvx /bin/
RUN <<EORUN
set -ex
uv python install 3.12.13
uv python install 3.14.6
mkdir /etc/uv
echo 'index-url = "https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple"' > /etc/uv/uv.toml
EORUN

# install packages, expect change
RUN <<EORUN
set -ex
# install ffmpeg
# some operation in qwen-asr or its dependencies need c compiler?
apt-get install -y --no-install-recommends ffmpeg gcc
# install asr libraries
mkdir -p /work/asr
cd /work/asr
uv python pin 3.12.13
uv init
uv add torch==2.10
uv add qwen-asr
# install translate libraries
mkdir -p /work/atr
cd /work/atr
uv python pin 3.14.6
uv init
uv add transformers
EORUN

WORKDIR ["/work"]
