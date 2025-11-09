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
# FROM base AS node
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
# FROM base AS rust
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
