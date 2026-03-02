
FROM mydevc/ubuntu:24

ADD microsoft-edge-stable_145.0.3800.82-1_amd64.deb /build/

RUN <<RUNEOF
set -ex
apt-get install -y --no-install-recommends /build/microsoft-edge-stable_145.0.3800.82-1_amd64.deb
RUNEOF

# NOTE normal glibc nodejs prebuild binary is official build, not like musl build is unofficial
# https://nodejs.org/dist/latest/node-v25.7.0-linux-x64.tar.xz
ADD node-v25.7.0-linux-x64.tar.xz /build/

RUN <<RUNEOF
set -ex
apt-get install -y --no-install-recommends curl libatomic1
cp -rvpf /build/node-v25.7.0-linux-x64/. /usr/local
# remove the outside text files by the way
rm /usr/local/README.md /usr/local/LICENSE /usr/local/CHANGELOG.md
rm -rf /build
# update npm self version if need
npm install -g npm@latest
# smoke test
node --version
npm --version
RUNEOF
