import urllib.request, pathlib, shutil, subprocess, sys, tarfile

# see docker-setup.md

url_base = 'https://download.docker.com/linux/debian/dists/trixie/pool/stable/amd64/'
# according to semantic versioning, the hyphen after major.minor.patch is prerelease, plus is build
# but this really looks like build not prerelease, by the way, semantic version does not allow tilde ~
build = '-1~debian.13~trixie_amd64'
# docker-ce-rootless-extras is not used
# buildx plugin is not used on server, used in dev environment, use a switch for that
buildx_plugin = False

packages = [p for p in [
    ('containerd.io', '2.2.5'),
    ('docker-ce', '29.6.1'),
    ('docker-ce-cli', '29.6.1'),
    ('docker-buildx-plugin', '0.35.0') if buildx_plugin else False,
    ('docker-compose-plugin', '5.2.0'),
] if p]

# download and extract
packages_path = pathlib.Path('docker-setup')
packages_path.mkdir(parents=True, exist_ok=True)
for package_name, version in packages:
    file_name = f'{package_name}_{version}{build}.deb'
    file_path = packages_path / file_name
    if not file_path.exists():
        print(f'docker-setup: download {package_name} {version}')
        with open(file_path, 'wb') as f:
            with urllib.request.urlopen(f'{url_base}{file_name}') as response:
                f.write(response.read())
        print(f'docker-setup: download {package_name} {version} complete')
    else:
        print(f'docker-setup: download {package_name} {version} skipped')
    # continue # use this to skip dpkg invocation in testing environment
    extract_path = packages_path / package_name # use bare package name as extract path
    if extract_path.exists():
        shutil.rmtree(extract_path)
    print(f'docker-setup: dpkg-deb -x {file_name}')
    # this automatically create directory if not exist
    child = subprocess.run(['dpkg-deb', '-x', str(file_path), str(extract_path)], stdout=sys.stdout, stderr=subprocess.PIPE)
    # no logic difference here
    print(f'docker-setup: dpkg-deb return code {child.returncode}')

# assert file content, in case important files added in new version
major_files = [p for p in [
    packages_path / 'containerd.io' / 'etc' / 'containerd' / 'config.toml',
    packages_path / 'containerd.io' / 'lib' / 'systemd' / 'system' / 'containerd.service',
    packages_path / 'containerd.io' / 'usr' / 'bin' / 'containerd',
    packages_path / 'containerd.io' / 'usr' / 'bin' / 'containerd-shim-runc-v2',
    packages_path / 'containerd.io' / 'usr' / 'bin' / 'ctr',
    packages_path / 'containerd.io' / 'usr' / 'bin' / 'runc',
    packages_path / 'docker-ce' / 'usr' / 'bin' / 'dockerd',
    packages_path / 'docker-ce' / 'usr' / 'bin' / 'docker-proxy',
    packages_path / 'docker-ce' / 'usr' / 'lib' / 'systemd' / 'system' / 'docker.service',
    packages_path / 'docker-ce' / 'usr' / 'lib' / 'systemd' / 'system' / 'docker.socket',
    packages_path / 'docker-ce' / 'usr' / 'libexec' / 'docker' / 'docker-init',
    packages_path / 'docker-ce-cli' / 'usr' / 'bin' / 'docker',
    packages_path / 'docker-buildx-plugin' / 'usr' / 'libexec' / 'docker' / 'cli-plugins' / 'docker-buildx' if buildx_plugin else False,
    packages_path / 'docker-compose-plugin' / 'usr' / 'libexec' / 'docker' / 'cli-plugins' / 'docker-compose',
] if p]
other_files = list(map(pathlib.Path, [
    # not important man page
    'docker-setup/containerd.io/usr/share/man/man8/containerd-config.8.gz',
    'docker-setup/containerd.io/usr/share/man/man8/ctr.8.gz',
    'docker-setup/containerd.io/usr/share/man/man8/containerd.8.gz',
    'docker-setup/containerd.io/usr/share/man/man5/containerd-config.toml.5.gz',
    'docker-setup/containerd.io/usr/share/doc/containerd.io/changelog.Debian.gz',
    'docker-setup/containerd.io/usr/share/doc/containerd.io/copyright',
    'docker-setup/docker-buildx-plugin/usr/share/doc/docker-buildx-plugin/README.md.gz',
    'docker-setup/docker-buildx-plugin/usr/share/doc/docker-buildx-plugin/changelog.Debian.gz',
    'docker-setup/docker-compose-plugin/usr/share/doc/docker-compose-plugin/README.md',
    'docker-setup/docker-compose-plugin/usr/share/doc/docker-compose-plugin/changelog.Debian.gz',
    'docker-setup/docker-ce/usr/share/man/man8/dockerd.8.gz',
    'docker-setup/docker-ce/usr/share/doc/docker-ce/README.md',
    'docker-setup/docker-ce/usr/share/doc/docker-ce/changelog.Debian.gz',
    # not important traditional service
    'docker-setup/docker-ce/etc/default/docker',
    'docker-setup/docker-ce/etc/init.d/docker',
    'docker-setup/docker-ce-cli/usr/share/man/man5/Dockerfile.5.gz',
    'docker-setup/docker-ce-cli/usr/share/man/man5/docker-config-json.5.gz',
    # not important shell completions
    'docker-setup/docker-ce-cli/usr/share/fish/vendor_completions.d/docker.fish',
    'docker-setup/docker-ce-cli/usr/share/zsh/vendor-completions/_docker',
    'docker-setup/docker-ce-cli/usr/share/bash-completion/completions/docker',
    'docker-setup/docker-ce-cli/usr/share/doc/docker-ce-cli/changelog.Debian.gz',
]))

has_error = False
actual_file_paths = []
for directory_path, directory_names, file_names in packages_path.walk():
    if directory_path != packages_path:
        for file_name in file_names:
            file_path = directory_path / file_name
            file_stat = file_path.stat()
            if file_stat.st_mode not in (0o100644, 0o100755):
                print(f'docker-setup: {file_path}: mode not 644/755: {file_stat.st_mode:o}')
            actual_file_paths.append(file_path)
            if file_path not in major_files and file_path not in other_files:
                # too many man pages for cli
                if not str(file_path).startswith('docker-setup/docker-ce-cli/usr/share/man/man1/'):
                    has_error = True
                    print(f'docker-setup: unknown file {file_path}')
for file_path in major_files:
    if file_path not in actual_file_paths:
        has_error = True
        print(f'docker-setup: file {file_path} missing')
if not has_error:
    print(f'docker-setup: file content expected')

if input('deploy files? ') != 'y': exit(0)
for file_path in major_files:
    target_path = pathlib.Path('/') / pathlib.Path(*file_path.parts[2:])
    target_path.parent.mkdir(parents=True, exist_ok=True)
    print(f'docker-setup: copy to {target_path}')
    # amazingly path.copy is 3.14 while debian 13.5 is using python 3.13, use shutil.copy2 instead
    # file_path.copy(target_path, preserve_metadata=True)
    shutil.copy2(file_path, target_path)

if input('first time deploy? ') != 'y': exit(0)

# server is using root user and don't have a docker group, dev env is not using root user
if not buildx_plugin:
    print(f'docker-setup: fix docker.socket')
    with open('/usr/lib/systemd/system/docker.socket') as f:
        docker_socket_unit = f.read()
    docker_socket_unit = '\n'.join([(f'# {r}' if r.strip().startswith('SocketGroup') else r) for r in docker_socket_unit.splitlines()])
    with open('/usr/lib/systemd/system/docker.socket', 'w') as f:
        f.write(docker_socket_unit)

print(f'docker-setup: write /etc/docker/daemon.json')
pathlib.Path('/etc/docker').mkdir(exist_ok=True)
with open('/etc/docker/daemon.json', 'w') as f:
    items = [i for i in [
        ('userland-proxy', 'false'),
        ('ipv6', 'true'),
        ('firewall-backend', '"nftables"'),
        ('iptables', 'false') if buildx_plugin else False,
        ('ip6tables', 'false') if buildx_plugin else False,
    ] if i]
    f.write('{\n  ' + ',\n  '.join([f'"{k}": {v}' for k, v in items]) + '\n}\n')

print(f'docker-setup: write /etc/sysctl.d/90-ip-forwarding.conf')
pathlib.Path('/etc/sysctl.d').mkdir(exist_ok=True)
with open('/etc/sysctl.d/90-ip-forwarding.conf', 'w') as f:
    f.write('''
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
net.ipv6.conf.default.forwarding = 1
''')

print(f'docker-setup: note: run sysctl -p /etc/sysctl.d/90-ip-forwarding.conf')
print(f'docker-setup: note: run systemctl deamon-reload')
print(f'docker-setup: note: run systemctl enable containerd.service docker.service docker.socket')
print(f'docker-setup: note: run systemctl start containerd.service docker.socket')

# test run: docker run -it --rm --name docker-setup1 -v .:/work -w /work --entrypoint bash python
# should use python:trixie, there is no dpkg command in alpine, also libc is dynamic so commands cannot run in alpine
