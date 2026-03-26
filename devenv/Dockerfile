# ?syntax=docker/dockerfile:1

# =================================================
# basic shell experience
# docker build --target shell --tag my/shell:1 .
FROM alpine:3.23.3 AS shell

# $ git clone git@github.com:ohmyzsh/ohmyzsh --depth 1
# $ tar -cJf ohmyzsh.tar.xz -C /tmp/ohmyzsh .
# if git clone have network issue, download the ohmyzsh-master.zip file from webpage
# while ADD does not extract zip file, so
# $ unzip ohmyzsh-master.zip -d /tmp/omhyzsh
# $ tar -cJf ohmyzsh.tar.xz -C /tmp/ohmyzsh/ohmyzsh-master .
# $ rm -rf /tmp/ohmyzsh
ADD --chown=0 ohmyzsh.tar.xz /root/.omz

# # a simple 2-liner for other environments by the way
# echo https://mirrors.aliyun.com/alpine/v3.23/main > /etc/apk/repositories
# echo https://mirrors.aliyun.com/alpine/v3.23/community >> /etc/apk/repositories

RUN <<RUNEOF
set -ex
cat <<'CATEOF' > /etc/apk/repositories
https://mirrors.aliyun.com/alpine/v3.23/main
https://mirrors.aliyun.com/alpine/v3.23/community
CATEOF
apk update
apk add zsh --no-cache
# chsh not available in alpine, have to edit /etc/passwd directly
sed -i 's#^\(root:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:\).*#\1/bin/zsh#' /etc/passwd
# note this cd does not affect following layers
cd /root/.omz
# my theme
cat <<'CATEOF' > custom/themes/mytheme.zsh-theme
PROMPT="[%{$fg_bold[black]%}%n@%m%{$reset_color%}:%{$fg_bold[blue]%}%~%{$reset_color%}]%{$fg[green]%}
%(?,🐋,🐋💔) %# %{$reset_color%}"
RPROMPT='%(?,,%{$fg[red]%}%?!%{$reset_color%}) %{$fg[green]%}%* %D%{$reset_color%}'
CATEOF
# note this cd does not affect following layers
cd /root
# create .zshrc
# the default template of .zshrc is long, but only contains 4 non comment lines
# see minimized version https://github.com/ohmyzsh/ohmyzsh/blob/master/templates/minimal.zshrc
cat <<'CATEOF' > .zshrc
export ZSH="$HOME/.omz"
ZSH_THEME="mytheme"
# disable auto update
zstyle :omz:update mode disabled
plugins=(z)
source $ZSH/oh-my-zsh.sh
alias cls="clear"
alias sl="ls -hlLF --group-directories-first"
CATEOF
# clear remaining files
rm -rf /build
RUNEOF

WORKDIR /root
ENTRYPOINT ["/bin/zsh"]

# ==================================================
# an ubuntu image with apt source configured
# docker build --target ubuntu --tag my/ubuntu:24.04 .
# occassionally rerun apt update: docker build --no-cache --target ubuntu --tag my/ubuntu:24.04 .
FROM ubuntu:24.04 AS ubuntu

RUN <<RUNEOF
set -ex
# you need update-ca-certificates to use https mirror, you need apt update to update-ca-certificates?
apt-get update
apt-get install -y ca-certificates --no-install-recommends
update-ca-certificates
sed -i 's|http://archive.ubuntu.com/ubuntu/|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources
apt-get update
RUNEOF

# ==================================================
# a debian image with apt source configured
# docker build --target debian --tag my/debian:13.4 .
FROM debian:13.4-slim AS debian

RUN <<RUNEOF
set -ex
apt-get update
apt-get install -y ca-certificates --no-install-recommends
update-ca-certificates
sed -i 's|http://deb.debian.org/debian|https://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources
apt-get update
RUNEOF

# ===============================================
# dev environment node was using stable, but it seems no need to use stable
# for not-that-require-stable projects, if really need stable in future, add another node:stable for stable
# docker build --target node --tag my/node:1 .
FROM my/shell:1 AS node

# this is learned from node official image source code,
# see https://github.com/nodejs/docker-node/blob/main/24/alpine3.22/Dockerfile
# currently it is simply an extraction of prebuilt archive
# but the archive's download link is currently very slow on all my environments,
# so it is manually downloaded from my fastest channel and put here
# https://unofficial-builds.nodejs.org/download/release/v24.11.0/node-v24.11.0-linux-x64-musl.tar.xz
ADD node-v25.8.2-linux-x64-musl.tar.xz /build

RUN <<RUNEOF
set -ex
# libstdc++: nodejs runtime dependency
apk add --no-cache libstdc++
# currently in alpine /usr/local is empty so can directly overwrite
rm -rf /usr/local
mv /build/node-v25.8.2-linux-x64-musl /usr/local
# according to the official implementation,
# delete folders in /usr/local/include/node/openssl/archs other than linux-x86_64
# # by the way, the /usr/local/bin/node is 125m ???, the archs folder is 68m, the total uncompress size is 212m
mv /usr/local/include/node/openssl/archs/linux-x86_64 /tmp/linux-x86_64
rm -rf /usr/local/include/node/openssl/archs
mkdir /usr/local/include/node/openssl/archs
mv /tmp/linux-x86_64 /usr/local/include/node/openssl/archs/linux-x86_64
# remove the outside text files by the way
rm /usr/local/README.md /usr/local/LICENSE /usr/local/CHANGELOG.md
rm -rf /build
# update npm self version if need
npm install -g npm@latest
# smoke test
node --version
npm --version
RUNEOF

# NOTE backup a node setup for ubuntu by the way

# https://nodejs.org/dist/latest/node-v25.7.0-linux-x64.tar.xz
# RUN <<RUNEOF
# set -ex
# apt-get install -y --no-install-recommends curl libatomic1
# cp -rvpf /build/node-v25.7.0-linux-x64/. /usr/local
# # remove the outside text files by the way
# rm /usr/local/README.md /usr/local/LICENSE /usr/local/CHANGELOG.md
# rm -rf /build
# # update npm self version if need
# npm install -g npm@latest
# # smoke test
# node --version
# npm --version
# RUNEOF

# ==============================================
# docker build --target python --tag my/python:1 .
FROM my/shell:1 AS python

RUN <<RUNEOF
set -ex
apk add python3
RUNEOF

# https://docs.astral.sh/uv/guides/integration/docker/#available-images
# for this copy usage, :0.11.1 is enough, others will come with distro and python
COPY --from=ghcr.io/astral-sh/uv:0.11.1 /uv /uvx /bin/

# ==========================================
# docker build --target rust --tag my/rust:1 .
FROM my/shell:1 AS rust

# rust download is slow,
# according to https://forge.rust-lang.org/infra/other-installation-methods.html
# there is prebuilt package, but this does not contain rustup and rust-analyzer,
# and seems no related document for that, so still use normal rustup installer approach
# see https://github.com/rust-lang/docker-rust/blob/master/stable/alpine3.22/Dockerfile
# # by the way, the prebuilt package uncompress size is 2.15gb
# # for comparison, a basic apk add gcc + rustup-init execution result in 1.02gb
# ADD rust-1.89.0-x86_64-unknown-linux-musl.tar.xz /

# https://rust-lang.github.io/rustup/installation/other.html#manual-installation
# https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-musl/rustup-init
ADD rustup-init /

# these environment variables will be read by rustup to determine install location
# https://rust-lang.github.io/rustup/environment-variables.html
# https://doc.rust-lang.org/cargo/reference/environment-variables.html
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH

RUN <<RUNEOF
set -ex
# gcc: similar to you need msvc toolchain on windows
apk add --no-cache gcc
chmod +x /rustup-init
/rustup-init -y --no-modify-path --profile minimal
rm /rustup-init
rustup --version
rustc --version
cargo --version
RUNEOF

# basic check
# $ rustup --version
# $ rustc --version
# $ cargo --version
# $ cargo new hello && cd hello
# $ cargo run

# ==============================================
# extract zip, 7z and rar
# docker build --target zip --tag my/zip:1 .
# usage:
# mkdir ~/zipwork
# docker run -it --rm --name zip1 -v ~/zipwork:/work my/zip:1
# run `7z x filename.7z` or `unrar x filename.rar`
FROM my/ubuntu:24.04 AS zip
RUN apt-get install -y --no-install-recommends unrar p7zip-full
WORKDIR /work
