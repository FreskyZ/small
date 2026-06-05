import io, os, pathlib, tarfile, datetime

# make the script to setup shell in docker's host environment, namely cloud machines

# this was designed to be an all-in-one script to setup cloud machine working environment,
# but later docker installation splitted out according to my requirement and investigations,
# and user setup removed after I defeated some of the non root security hallucinations, and
# this script is left with shell setup and ssh setup, which is abbreviation of secure shell,
# which effectively categorizes this script as shell setup making script

b = tarfile.open('shell-setup.tar.xz', 'w:xz')
file_time = datetime.datetime.now(datetime.UTC).timestamp()

def add_dir(arcname, mode=0o755):
    # why is mode and mtime not in constructor
    info = tarfile.TarInfo(name=arcname).replace(mode=mode, mtime=file_time)
    # why is type not in replace
    info.type = tarfile.DIRTYPE
    b.addfile(info)

def add_text(arcname, content, mode=0o644):
    info = tarfile.TarInfo(name=arcname).replace(mode=mode, mtime=file_time)
    content = content.encode('utf-8')
    info.size = len(content)
    b.addfile(info, fileobj=io.BytesIO(content))

# why lambda info.replace(...) not work?
def reset_owner(info):
    info.uid = 0
    info.gid = 0
    info.uname = 'root'
    info.gname = 'root'
    return info

if 'OMZ_REPO' not in os.environ:
    print('missing OMZ_REPO environment variable')
    exit(1)
print('setup omz program')
omz_repo = pathlib.Path(os.environ['OMZ_REPO'])
# all other files at repository root is not needed
b.add(omz_repo / 'oh-my-zsh.sh', arcname='.omz/oh-my-zsh.sh', filter=reset_owner)
# this is .gitkeep in source code, so keep this directory
add_dir('.omz/cache')
# examples in custom directory no need
add_dir('.omz/custom')
add_dir('.omz/custom/plugins')
# my alias plugin
add_dir('.omz/custom/plugins/myalias')
add_text('.omz/custom/plugins/myalias/myalias.plugin.zsh', '''
alias cls=clear
alias sl="ls -ghlLop --time-style=iso --group-directories-first"
''')
# my direnv plugin
# this simple direnv does not clear, but is good enough
add_dir('.omz/custom/plugins/mydirenv')
add_text('.omz/custom/plugins/mydirenv/mydirenv.plugin.zsh', '''
load_envrc() {
    if [[ -f "./.envrc" ]]; then
        source ./.envrc
    fi
}
autoload -U add-zsh-hook
add-zsh-hook chpwd load_envrc
''')
add_dir('.omz/custom/themes')
# my theme
# by the way $(git_prompt_info) is a omz builtin function,
# not zsh builtin, not zsh git plugin function # this is found by `whence -v git_prompt_info`
# note need extra space after %# (the # or $ before command) to counter for the advanced? emoji that make cursor position a little bit incorrect
add_text('.omz/custom/themes/mytheme.zsh-theme', '''
PROMPT="[%{$fg_bold[black]%}%n@%m%{$reset_color%}:%{$fg_bold[blue]%}%~%{$reset_color%}]%{$fg[green]%}
%(?,✈️😘,✈️💔) %#  %{$reset_color%}"
RPROMPT='%(?,,%{$fg[red]%}%?!%{$reset_color%}) %{$fg[green]%}%* %D%{$reset_color%}'
''')
b.add(omz_repo / 'lib', arcname='.omz/lib', filter=reset_owner)
# this is .gitkeep in source code, so keep this directory
add_dir('.omz/log')
# no other prepacked plugins needed
add_dir('.omz/plugins')
# this contains a 1.3m gif file while the full init.tar.xz is 1.2m at this time?
# update: become 63kb
# update: the complete ohmyzsh-master.zip is 3.5m, this gif is 1.3m, the plugins/zsh-interactive-cd is 1.4m
add_dir('.omz/plugins/z')
b.add(omz_repo / 'plugins' / 'z' / '_z', arcname='.omz/plugins/z/_z', filter=reset_owner)
b.add(omz_repo / 'plugins' / 'z' / 'z.plugin.zsh', arcname='.omz/plugins/z/z.plugin.zsh', filter=reset_owner)
# no prepacked themes needed
add_dir('.omz/themes')
# no need to include templates
# this seems needed
b.add(omz_repo / 'tools', arcname='.omz/tools', filter=reset_owner)

# no need to keep omz defualt zshrc according to current zshrc template,
# https://github.com/ohmyzsh/ohmyzsh/blob/master/templates/zshrc.zsh-template
print('setup .zshrc')
add_text('.zshrc', '''
export ZSH="$HOME/.omz"
ZSH_THEME="mytheme"
zstyle :omz:update mode disabled
plugins=(z myalias mydirenv)
source $ZSH/oh-my-zsh.sh
''')
# .vimrc by the way, I definitely will not use vim for actual coding, but add a few very basic settings
add_text('.vimrc', "set number\nset tabstop=4\nset expandtab\n")

print('setup ssh')
# this is not needed here because you need to upload public key on cloud server management
# site to access cloud server, when you successfully connected this configuration is completed
# add_dir('.ssh', 0o700)
# with open(os.environ['PUBLIC_KEY']) as f:
#     add_text('.ssh/authorized_keys', f.read(), 0o600)
# modify client alive settings to make the session not easily die when I'm investigating something and no interaction
# see https://wiki.debian.org/SSH#Configuration_files, sshd_config.d should be supported
add_text('sshd.conf', '''
PasswordAuthentication no
ClientAliveInterval 3600
ClientAliveCountMax 12
''', 0o600)

print('generate shell-setup.sh')
add_text('shell-setup.sh', f'''#!/bin/bash
set -ex
apt-get install -y zsh
chsh -s /bin/zsh
mkdir -p /etc/ssh/sshd_config.d
mv sshd.conf /etc/ssh/sshd_config.d/sshd.conf
systemctl restart sshd
''', 0o700)

b.close()
print('create shell-setup.tar.xz')

# docker run -it --rm --name setup1 -h DUMMY -v.:/setup debian
# by the way debian slim image does not have xz: apt update && apt install xz-utils
# by the way comment out systemctl when testing in local container
# cd ~ if not ~
# tar xJf /setup/shell-setup.tar.xz -C . && ./shell-setup.sh
