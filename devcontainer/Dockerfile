# syntax=docker/dockerfile:1

# docker build --target ssh --tag my-devcontainers/ssh:1 --build-arg ... .
# docker run -it --rm --name ssh1 my-devcontainers/ssh:1
FROM alpine:3.22 AS ssh

# domain name
ARG SSH_HOST
ARG SSH_USER
# the identity file name at build time
ARG SSH_IDENTITY
# note the folder is created here, so later only need to chmod it
ADD $SSH_IDENTITY /root/.ssh/$SSH_IDENTITY

RUN <<RUNEOF
set -ex
test -n "${SSH_HOST}" || (echo "SSH_HOST not set" && false)
test -n "${SSH_USER}" || (echo "SSH_USER not set" && false)
test -n "${SSH_IDENTITY}" || (echo "SSH_IDENTITY not set" && false)
apk update
apk add --no-cache openssh-client
chmod 700 /root/.ssh
cat <<CATEOF > /root/.ssh/config
Host ${SSH_HOST}
    HostName ${SSH_HOST}
    IdentityFile ~/.ssh/${SSH_IDENTITY}
    ServerAliveInterval 60
    ServerAliveCountMax 60
CATEOF
chmod 600 /root/.ssh/config
ssh-keyscan -H ${SSH_HOST} > /root/.ssh/known_hosts
chmod 600 /root/.ssh/known_hosts
RUNEOF

ENV SSH_USER=$SSH_USER
ENV SSH_HOST=$SSH_HOST
# if you want to overwrite this
# docker run -it --rm --entrypoint sh my-devcontainers/ssh:1
ENTRYPOINT ssh $SSH_USER@$SSH_HOST

# docker build --target base --tag my-devcontainers/base:1 --build-arg ... .
FROM alpine:3.22 AS base

ARG SSH_HOST
ARG SSH_IDENTITY
ARG GIT_IDENTITY
ARG GIT_USERNAME
ARG GIT_USEREMAIL

# note the folder is created here, so later only need to chmod it
ADD $SSH_IDENTITY /root/.ssh/$SSH_IDENTITY
ADD $GIT_IDENTITY /root/.ssh/$GIT_IDENTITY
# raw githubusercontent sometimes cannot connect
# this should be manually or automatically downloaded from github webpage
# https://github.com/ohmyzsh/ohmyzsh
# but ADD command does not extract zip file, so
# $ unzip .devcontainer/ohmyzsh-master.zip -d /tmp/unzip-omz-master
# $ tar -czvf ohmyzsh-master.tar.gz -C /tmp/unzip-omz-master .
# $ rm -rf /tmp/unzip-omz-master
ADD ohmyzsh-master.tar.gz /build

RUN <<RUNEOF
set -ex
apk update
apk add --no-cache zsh git openssh-client
# chsh not available in alpine, have to edit /etc/passwd directly
sed -i 's#^\(root:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:\).*#\1/bin/zsh#' /etc/passwd
# the standard omz install method clones the repository, but only a few files actually needed at runtime,
# so copy the required files from the repository archive and discard others,
# although this will make the omz install directory incomplete will make omz cannot update,
# it is ok for me because I never see changes related to my commonly used features in omz update history
# it is more ok because rebuild this should be easy
mkdir /root/.oh-my-zsh
# attention this cd does not affect following layers
cd /root/.oh-my-zsh
# create directories
# cache,log: the source code say .gitkeep theme so keep theme
# plugins: nearly all folders in plugins is not used, so mkdir here and copy required plugin
# themes, custom/plugins: not used, but not sure whether they should exist so keep them
# custom/themes: custom themes
mkdir cache log plugins themes custom custom/plugins custom/themes
# my theme
cat <<'CATEOF' > custom/themes/mytheme.zsh-theme
PROMPT="[%{$fg_bold[black]%}%n@%m%{$reset_color%}:%{$fg_bold[blue]%}%~%{$reset_color%}]%{$fg[green]%}
%(?,🐋,🐋💔) %# %{$reset_color%}"
RPROMPT='%(?,,%{$fg[red]%}%?!%{$reset_color%}) $(git_prompt_info) %{$fg[green]%}%* %D%{$reset_color%}'
ZSH_THEME_GIT_PROMPT_PREFIX="%{$fg_bold[blue]%}git:"
ZSH_THEME_GIT_PROMPT_SUFFIX="%{$reset_color%}"
ZSH_THEME_GIT_PROMPT_CLEAN=""
ZSH_THEME_GIT_PROMPT_DIRTY="%{$fg[red]%}+%{$fg_bold[blue]%}"
CATEOF
# move actually needed files
mv /build/ohmyzsh-master/lib ./lib
mv /build/ohmyzsh-master/tools ./tools
mv /build/ohmyzsh-master/plugins/z ./plugins/z
mv /build/ohmyzsh-master/plugins/ssh-agent ./plugins/ssh-agent
mv /build/ohmyzsh-master/oh-my-zsh.sh .
# attention this cd does not affect following layers
cd /root
# create .zshrc
# the default template of .zshrc is long, but only contains 4 non comment lines
# see minimized version https://github.com/ohmyzsh/ohmyzsh/blob/master/templates/minimal.zshrc
cat <<'CATEOF' > .zshrc
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="mytheme"
# disable auto update
zstyle :omz:update mode disabled
zstyle :omz:plugins:ssh-agent lazy yes
zstyle :omz:plugins:ssh-agent quiet yes
plugins=(z ssh-agent)
source $ZSH/oh-my-zsh.sh
alias cls="clear"
alias sl="ls -hlLF --group-directories-first"
CATEOF
# clear remaining files
rm -rf /build
# setup ssh
chmod 700 .ssh
cat <<CATEOF > .ssh/config
Host github.com
    HostName github.com
    IdentityFile ~/.ssh/${GIT_IDENTITY}
    AddKeysToAgent yes
Host ${SSH_HOST}
    HostName ${SSH_HOST}
    IdentityFile ~/.ssh/${SSH_IDENTITY}
    AddKeysToAgent yes
    ServerAliveInterval 60
    ServerAliveCountMax 60
CATEOF
chmod 600 .ssh/config
chmod 400 .ssh/${SSH_IDENTITY}
chmod 400 .ssh/${GIT_IDENTITY}
ssh-keyscan -H github.com >> .ssh/known_hosts
ssh-keyscan -H ${SSH_HOST} >> .ssh/known_hosts
chmod 600 .ssh/known_hosts
# setup git
git config --global --add user.name ${GIT_USERNAME}
git config --global --add user.email ${GIT_USEREMAIL}
# this is needed if source code is mapped from native
git config --global --add safe.directory '*'
RUNEOF

# cannot smoke test because ssh identity files use passphrase, for now manual steps
# docker run to see zsh theme is enabled
# sl -a
# ssh user@my-cloud-machine exit successfully connect
# git --version
# ssh -T git@github.com successfully connect
# ssh -T git@github.com second run does not require input passphrase

WORKDIR /root
ENTRYPOINT ["/bin/zsh"]

# docker build --target node --tag my-devcontainers/node:1 --build-arg ... .
# FROM base AS node
FROM my-devcontainers/base:1 AS node

# this is learned from node official image source code,
# see https://github.com/nodejs/docker-node/blob/main/24/alpine3.22/Dockerfile
# currently it is simply an extraction of prebuilt archive
# but the archive's download link is currently very slow on all my environments,
# so it is manually downloaded from my fastest channel and put here
# https://unofficial-builds.nodejs.org/download/release/v24.6.0/node-v24.6.0-linux-x64-musl.tar.xz
ADD node-v24.6.0-linux-x64-musl.tar.xz /build

RUN <<RUNEOF
set -ex
# libstdc++: nodejs runtime dependency
apk add --no-cache libstdc++
# currently in alpine /usr/local is empty so can directly overwrite
rm -rf /usr/local
mv /build/node-v24.6.0-linux-x64-musl /usr/local
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

# workdir will inherit
ENTRYPOINT ["/bin/zsh"]

FROM my-devcontainers/node-with-fine-metadata:1 AS nodewith

# docker build --target rust --tag my-devcontainers/rust:1 --build-arg ... .
# FROM base AS rust
FROM my-devcontainers/base:1 AS rust

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

ENTRYPOINT ["/bin/zsh"]
