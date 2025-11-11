# ?syntax=docker/dockerfile:1

# docker build --target base --tag mydevc/base:2 .
FROM alpine:3.22.2 AS base

# $ git clone git@github.com:ohmyzsh/ohmyzsh --depth 1
# $ tar -czvf omz.tar.gz -C /tmp/ohmyzsh .
# if git clone have network issue, download the ohmyzsh-master.zip file from webpage
# while ADD does not extract zip file, so
# $ unzip ohmyzsh-master.zip -d /tmp/omhyzsh
# $ tar -czvf omz.tar.gz -C /tmp/ohmyzsh/ohmyzsh-master .
# $ rm -rf /tmp/ohmyzsh
ADD --chown=0 omz.tar.gz /root/.omz

RUN <<RUNEOF
set -ex
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

# docker build --target node --tag mydevc/node:2 .
FROM mydevc/base:2 AS node

# this is learned from node official image source code,
# see https://github.com/nodejs/docker-node/blob/main/24/alpine3.22/Dockerfile
# currently it is simply an extraction of prebuilt archive
# but the archive's download link is currently very slow on all my environments,
# so it is manually downloaded from my fastest channel and put here
# https://unofficial-builds.nodejs.org/download/release/v24.11.0/node-v24.11.0-linux-x64-musl.tar.xz
ADD node-v24.11.0-linux-x64-musl.tar.xz /build

RUN <<RUNEOF
set -ex
# libstdc++: nodejs runtime dependency
apk add --no-cache libstdc++
# currently in alpine /usr/local is empty so can directly overwrite
rm -rf /usr/local
mv /build/node-v24.11.0-linux-x64-musl /usr/local
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

# basic check
# $ node --version
# $ npm --version

# workdir will inherit
ENTRYPOINT ["/bin/zsh"]

# docker build --target rust --tag mydevc/rust:2 .
FROM mydevc/base:2 AS rust

# rust download is slow,
# according to https://forge.rust-lang.org/infra/other-installation-methods.html
# there is prebuilt package, but this does not contain rustup and rust-analyzer,
# and seems no related document for that, so still use normal rustup installer approach
# see https://github.com/rust-lang/docker-rust/blob/master/stable/alpine3.22/Dockerfile

# # by the way, the prebuilt package uncompress size is 2.15gb
# # for comparison, a basic apk add gcc + rustup-init execution result in 1.02gb
# ADD rust-1.89.0-x86_64-unknown-linux-musl.tar.xz /
# https://static.rust-lang.org/rustup/archive/1.28.2/x86_64-unknown-linux-musl/rustup-init
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

ENTRYPOINT ["/bin/zsh"]

# an ubuntu image with apt source configured
# docker build --target ubuntu --tag mydevc/ubuntu:24 .
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

# extract zip, 7z and rar
# docker build --target unzip --tag mydevc/unzip:1 .
# usage:
# mkdir ~/unzip-work
# docker run --rm --name unzipper1 -it -v ~/unzip-work:/work mydevc/unzip:1
# `7z x filename.7z` or `unrar x filename.rar`
FROM mydevc/ubuntu:24 AS unzip
RUN apt-get install -y --no-install-recommends unrar p7zip-full
WORKDIR /work

# docker build --target cpp-stage1 --tag mydevc/cpp:stage1 .
FROM mydevc/base:2 AS cpp-stage1

# in the same directory that calls git clone (outside of repository)
# tar cJf llvm-project.tar.xz -C ./llvm-project .
# for reference
#   github webpage downloaded zip file is about 300m
#   uncompress size is 2GB WITHOUT the .git folder
#   git cloned repository archived tar.xz file is about 426m
#   uncompress size is estimated 2.6GB with .git folder
ADD --chown=0 llvm-project.tar.xz /llvm-src

# build-base: include gcc, g++, ar, ld, gnu make
# python3: this is python3.12 for now
# linux-headers: docs does not mention this, I think this naturally exists in normal distro
# zlib: missing zlib will make you completely compile llvm again if you need zlib later
RUN apk add --no-cache build-base cmake ninja python3 linux-headers git zlib-dev

# build llvm and clang first
# LLVM_ENABLE_PROJECTS: include clang and linker
# LLVM_ENABLE_RUNTIMES: include compiler-rt and libc++
# CMAKE_INSTALL_PREFIX: install in other location to make later COPY simpler
# LLVM_DEFAULT_TARGET_TRIPLE: seems need explicitly specify musl
# COMPILE_RT_BUILD_GWP_ASAN: this include a glibc dependency and cannot opt out that alone, so disable this for now
# LIBCXX_HAS_MUSL_LIBC: or else this depend on glibc
# CMAKE_BUILD_TYPE: Release
# LLVM_PARALLEL_COMPILE_JOBS, LLVM_PARALLEL_LINK_JOBS: j8
RUN <<RUNEOF
set -ex
cmake -G Ninja -S /llvm-src/llvm -B /llvm-build -DLLVM_ENABLE_PROJECTS="clang;lld" -DLLVM_ENABLE_RUNTIMES="compiler-rt;libcxx;libcxxabi;libunwind" -DCMAKE_INSTALL_PREFIX=/llvm-install -DLLVM_TARGETS_TO_BUILD=X86 -DLLVM_DEFAULT_TARGET_TRIPLE=x86_64-alpine-linux-musl -DCOMPILER_RT_BUILD_GWP_ASAN=OFF -DLIBCXX_HAS_MUSL_LIBC=ON -DCMAKE_BUILD_TYPE=Release -DLLVM_PARALLEL_COMPILE_JOBS=8 -DLLVM_PARALLEL_LINK_JOBS=8
cd /llvm-build
ninja install
RUNEOF

# basic check
RUN <<RUNEOF
set -ex
mkdir /work
cd /work
cat <<'CATEOF' > main.c
#include <stdio.h>
int main(void) {
    printf("hello world c!\n");
}
CATEOF
cat <<'CATEOF' > main.cpp
#include <print>
auto main() -> int {
    std::println("hello {}!", "world cpp");
}
CATEOF
/llvm-install/bin/clang -c main.c -o main.c.o
/llvm-install/bin/clang main.c.o -o main.1 -fuse-ld=/llvm-install/bin/ld.lld
./main.1
/llvm-install/bin/clang++ -c main.cpp -o main.cpp.o -I/llvm-install/include/c++/v1 -stdlib=libc++ -std=c++23
/llvm-install/bin/clang++ main.cpp.o -o main.2 -fuse-ld=/llvm-install/bin/ld.lld -L/llvm-install/lib/x86_64-alpine-linux-musl -lc++ -Wl,-rpath=/llvm-install/lib/x86_64-alpine-linux-musl
./main.2
RUNEOF

WORKDIR /

# docker build --target cpp-stage2 --tag mydevc/cpp:stage2
FROM mydevc/base:2 AS cpp-stage2

COPY --from=cpp-stage1 /llvm-src /llvm-src
COPY --from=cpp-stage1 /llvm-install /llvm-install


