# this is for asr workflow, for autotrack.ts you just run it with any node image

# # what do you mean by vscode opening windows files default to crlf and *wslc* build not recognize that?
# # this base image is ubuntu if have not noticed
# wslc build --tag my/asr .
# wslc run -it --rm --name asr1 --gpus all -v ./Models:/work/models:ro -v ./Input:/work/input:ro -v ./Output:/work/output -h ASR -w /work my/asr
# prepare file in ./input and run uv run transcribe.py and use file in ./output
FROM nvidia/cuda:13.0.3-cudnn-devel-ubuntu24.04

# apt setup
RUN <<EORUN
set -ex
apt-get update
apt-get install -y --no-install-recommends ca-certificates
update-ca-certificates
sed -i 's|http://archive.ubuntu.com/ubuntu/|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources
apt-get update
apt-get install -y --no-install-recommends ffmpeg
EORUN

# uv and python setup, expect no change
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /uvx /bin/
RUN <<EORUN
set -ex
uv python install 3.12
mkdir /etc/uv
echo 'index-url = "https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple"' > /etc/uv/uv.toml
EORUN

# setup project
ADD torch-2.10.0+cu130-cp312-cp312-manylinux_2_28_x86_64.whl /work/
ADD flash_attn-2.8.3+cu13torch2.10cxx11abiTRUE-cp312-cp312-linux_x86_64.whl /work/
RUN <<EORUN
set -ex
cd /work
uv init --python ">=3.12,<3.13"
uv venv
uv pip install torch-2.10.0+cu130-cp312-cp312-manylinux_2_28_x86_64.whl
uv pip install flash_attn-2.8.3+cu13torch2.10cxx11abiTRUE-cp312-cp312-linux_x86_64.whl
uv pip install qwen-asr
EORUN

# # not feasible:
# RUN <<EORUN
# set -ex
# cd /work
# uv init --python ">=3.12,<3.13"
# cat <<'EOCAT' > /work/pyproject.toml
# [project]
# name = "work"
# version = "0.1.0"
# description = "description here"
# readme = "README.md"
# requires-python = ">=3.12, <3.13"
# dependencies = [
#     "torch==2.10.0",
#     "flash-attn==2.8.3",
#     "qwen-asr==0.0.6",
# ]
# [[tool.uv.index]]
# name = "pytorch-cu130"
# url = "https://download.pytorch.org/whl/cu130"
# explicit = true
# [tool.uv.sources]
# torch = [{ index = "pytorch-cu130" }]
# EOCAT
# uv sync
# EORUN

ADD transcribe.py /work/

WORKDIR /work
