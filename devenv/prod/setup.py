import os, pathlib, random, string, tarfile, datetime, io

# create script to setup cloud server, this is not development env but closer
# to production env, but some operations and concepts are similar so put here

# if you forget: ssh-keygen -t ed25519 -N 123456 -f id_server -C comment <<<y
if 'PUBLIC_KEY' not in os.environ:
    print('missing PUBLIC_KEY environment variable')
    exit(1)
if 'OMZ_REPO' not in os.environ:
    print('missing OMZ_REPO environment variable')
    exit(1)

b = tarfile.open('setup.tar.xz', 'w:xz')
file_time = datetime.datetime.now(datetime.UTC).timestamp()

def add_dir(arcname, mode=0o744):
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
# why lambda info.replace does not work for b.add(filter=reset_owner)
def reset_owner(info):
    info.uid = 0
    info.gid = 0
    info.uname = 'root'
    info.gname = 'root'
    return info

# ssh setting: authorized keys and sshd config
print('setup sshd')
# TODO authorized keys seems not needed if you bind ssh key on cloud server management website
add_dir('.ssh', 0o700)
with open(os.environ['PUBLIC_KEY']) as f:
    add_text('.ssh/authorized_keys', f.read(), 0o600)
# see https://wiki.debian.org/SSH#Configuration_files, sshd_config.d should be supported
add_text('sshd.conf', '''
PasswordAuthentication no
ClientAliveInterval 3600
ClientAliveCountMax 12
''', 0o600)

# omz program: pick real program files
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
RPROMPT='%(?,,%{$fg[red]%}%?!%{$reset_color%}) $(git_prompt_info) %{$fg[green]%}%* %D%{$reset_color%}'
ZSH_THEME_GIT_PROMPT_PREFIX="%{$fg_bold[blue]%}git:"
ZSH_THEME_GIT_PROMPT_SUFFIX="%{$reset_color%}"
ZSH_THEME_GIT_PROMPT_CLEAN=""
ZSH_THEME_GIT_PROMPT_DIRTY="%{$fg[red]%}+%{$fg_bold[blue]%}"
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
add_text('.zshrc', '''
export ZSH="$HOME/.omz"
ZSH_THEME="mytheme"
zstyle :omz:update mode disabled
plugins=(z myalias mydirenv)
source $ZSH/oh-my-zsh.sh
''')

# .vimrc by the way, I definitely will not use vim for actual coding, but add a few very basic settings
add_text('.vimrc', "set number\nset tabstop=4\nset expandtab\n")

def generate_a_password():
    chars = []
    # reject length < 16, reject quote marks to make shell script easier
    while len(chars) < 16 or '"' in chars or "'" in chars:
        lowercases = random.choices(string.ascii_lowercase, k=random.randint(1, 10))
        uppercases = random.choices(string.ascii_uppercase, k=random.randint(1, 10))
        digits = random.choices(string.digits, k=random.randint(1, 10))
        punctuations = random.choices(string.punctuation, k=3)
        chars = lowercases + uppercases + digits + punctuations
    random.shuffle(chars)
    return ''.join(chars[:16])
# setup.sh script
print('generate setup.sh')
add_text('setup.sh', f'''#!/bin/bash
set -ex
apt-get update
apt-get upgrade -y
apt-get install -y zsh
chsh -s /bin/zsh
echo "{generate_a_password()}" | passwd --stdin
mkdir -p /etc/ssh/sshd_config.d
mv sshd.conf /etc/ssh/sshd_config.d/sshd.conf
systemctl restart sshd
''', 0o700)

b.close()
print('create setup.tar.xz')

# docker run -it --rm --name setup1 -h DUMMY -v.:/setup debian
# by the way debian slim image does not have xz: apt update && apt install xz-utils
# tar xJf /setup/setup.tar.xz -C .
