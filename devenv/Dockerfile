# ?syntax=docker/dockerfile:1

# build minimal omz, why does omz repository contains so many not used files?
# - this stage build a /build directory without unnecessary files and with necessary files
# - does not contain the zsh program, need package manager and install
FROM alpine:3.24.1 AS ohmyzsh-build

# git clone git@github.com:ohmyzsh/ohmyzsh
# tar cJf ohmyzsh.tar.xz -C ./ohmyzsh .
ADD --chown=0 ohmyzsh.tar.xz /build

RUN <<EORUN
set -ex
cd /build
# clear
rm -rf .git
rm -rf .github
rm -rf .devcontainer
rm -rf templates
rm -rf themes
# recreate themes folder in case some code relies on it exist
mkdir themes
rm CODE_OF_CONDUCT.md
rm CONTRIBUTING.md
rm LICENSE.txt
rm README.md
rm SECURITY.md
rm .editorconfig
rm .gitignore
rm .prettierrc
rm custom/example.zsh
rm -rf custom/plugins/example
rm custom/themes/example.zsh-theme
# select builtin plugins to use
mkdir selected-plugins
mv plugins/z selected-plugins/z
rm -rf plugins
mv selected-plugins plugins
# why do z have this large image file?
rm -rf plugins/z/img
rm plugins/z/LICENSE
rm plugins/z/MANUAL.md
rm plugins/z/README.md
# my theme
cat <<'EOCAT' > custom/themes/mytheme.zsh-theme
PROMPT="[%{$fg_bold[black]%}%n@%m%{$reset_color%}:%{$fg_bold[blue]%}%~%{$reset_color%}]%{$fg[green]%}
%(?,🐋😘,🐋💔) %# %{$reset_color%}"
RPROMPT='%(?,,%{$fg[red]%}%?!%{$reset_color%}) %{$fg[green]%}%* %D%{$reset_color%}'
EOCAT
# my direnv plugin
mkdir custom/plugins/mydirenv
cat <<'EOCAT' > custom/plugins/mydirenv/mydirenv.plugin.zsh
load_envrc() {
    if [[ -f "./.envrc" ]]; then
        source ./.envrc
    fi
}
autoload -U add-zsh-hook
add-zsh-hook chpwd load_envrc
EOCAT
# create .zshrc
# the default template of .zshrc is long, but only contains 4 important lines
# see minimized version https://github.com/ohmyzsh/ohmyzsh/blob/master/templates/minimal.zshrc
cat <<'EOCAT' > .zshrc
# why do you need this
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export ZSH="$HOME/.omz"
ZSH_THEME="mytheme"
# disable auto update
zstyle :omz:update mode disabled
plugins=(z mydirenv)
source $ZSH/oh-my-zsh.sh
alias cls="clear"
alias sl="ls -hlLF --group-directories-first"
EOCAT
EORUN

# ============================================
# basic shell experience
# docker build --target shell --tag my/shell .
# occassionally update packages: docker build --no-cache --target shell --tag my/shell .
FROM debian:13.5-slim AS shell
# base image https://hub.docker.com/_/debian
# source code https://github.com/debuerreotype/docker-debian-artifacts/blob/dist-amd64/trixie/Dockerfile
# if you can't notice difference for slim image, it shrinks many docs and mans, their bin and packages are same

COPY --from=ohmyzsh-build /build /root/.omz

RUN <<EORUN
set -ex
# you need apt update to install ca-certificates package
apt-get update
apt-get install -y --no-install-recommends ca-certificates
# you need update-ca-certificates to use https mirror
update-ca-certificates
# you need mirror to smoothly run apt update and apt install commands
sed -i 's|http://deb.debian.org/debian|https://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources
apt-get update
# install zsh
apt-get install -y --no-install-recommends zsh
chsh -s /bin/zsh
# deploy .zshrc
mv /root/.omz/.zshrc /root
EORUN

WORKDIR /root
ENTRYPOINT ["/bin/zsh"]
# alternative operations
# - in case you need ubuntu, when do you need ubuntu?
#   sed -i 's|http://archive.ubuntu.com/ubuntu/|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources
# - apk mirror in case you need
#   cat <<'EOCAT' > /etc/apk/repositories
#   https://mirrors.aliyun.com/alpine/v3.23/main
#   https://mirrors.aliyun.com/alpine/v3.23/community
#   EOCAT
# - apk mirror in convenient 2 one liners in case you need
#   echo https://mirrors.aliyun.com/alpine/v3.23/main > /etc/apk/repositories
#   echo https://mirrors.aliyun.com/alpine/v3.23/community >> /etc/apk/repositories
# - edit passwd file in case you don't have chsh
#   sed -i 's#^\(root:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:\).*#\1/bin/zsh#' /etc/passwd

# ==========================================
# docker build --target node --tag my/node .
FROM my/shell AS node
# according to node official image https://hub.docker.com/_/node
# source code https://github.com/nodejs/docker-node/blob/main/26/trixie-slim/Dockerfile
# the build process simply download and decompress and remove some unnecessary large files

ARG NODE_VERSION=26.4.0
RUN <<EORUN
set -ex
# wget seems to be about 4mb, xz-utils seems to be about 1.5mb,
# they are too small comparing to the single executable file /usr/local/bin/node 144m size at the
# time of writing, libatomic is runtime dependency, takes no space compare to 144m
apt-get install -y wget xz-utils libatomic1
wget https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz
tar xJf node-v${NODE_VERSION}-linux-x64.tar.xz -C /tmp
cp -r /tmp/node-v${NODE_VERSION}-linux-x64/bin/. /usr/local/bin
cp -r /tmp/node-v${NODE_VERSION}-linux-x64/lib/. /usr/local/lib
cp -r /tmp/node-v${NODE_VERSION}-linux-x64/include/. /usr/local/include
# remove not used different arch include files, reduce 10m image size, 70m disk size in container
for dir in /usr/local/include/node/openssl/archs/*/
do
  if [ $dir != '/usr/local/include/node/openssl/archs/linux-x86_64/' ]; then
    echo remove $dir
    rm -rf $dir
  fi
done
rm node-v${NODE_VERSION}-linux-x64.tar.xz
rm -rf /tmp/node-v${NODE_VERSION}-linux-x64
# update self to avoid duplicate npm self outdated warning message in every container
npm install -g npm@latest
EORUN

# ==============================================
# docker build --target python --tag my/python .
FROM my/shell AS python
# uv and install latest python by uv

# https://docs.astral.sh/uv/guides/integration/docker/#available-images
# for this copy usage, 0.11.26 is enough, others will come with distro and python
COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /uvx /bin/

RUN <<RUNEOF
set -ex
uv python install 3.14.6
echo 'export PATH="/root/.local/bin:$PATH"' >> /root/.zshrc
RUNEOF

# ==========================================
# docker build --target rust --tag my/rust .
FROM my/shell AS rust
# compare to vscode builtin support of typescript and my personal rejection
# of python language server equivalent service, rust need lsp related features

# the standalone installers are large and not include rustup and rust-analyzer
# https://forge.rust-lang.org/infra/other-installation-methods.html#standalone-installers
# TODO build from source will be very cool
# https://rustc-dev-guide.rust-lang.org/building/how-to-build-and-run.html

# these environment variables will be read by rustup to determine install location
# https://rust-lang.github.io/rustup/environment-variables.html
# https://doc.rust-lang.org/cargo/reference/environment-variables.html
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH

RUN <<RUNEOF
set -ex
# wget is too small compare to rust installed size
apt-get install -y wget
# https://rust-lang.github.io/rustup/installation/other.html#manual-installation
wget https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init
chmod +x rustup-init
./rustup-init -y --no-modify-path --profile minimal
rm rustup-init
rustup --version
rustc --version
cargo --version
RUNEOF

# ========================================
# extract zip, 7z and rar
# docker build --target zip --tag my/zip .
# usage:
# mkdir ~/zipwork
# docker run -it --rm --name zip1 -v ~/zipwork:/work my/zip
# run `7z x filename.7z` or `unrar x filename.rar`
FROM my/shell AS zip
RUN apt-get install -y --no-install-recommends unrar p7zip-full
WORKDIR /work
