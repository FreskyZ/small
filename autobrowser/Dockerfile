
# docker build --tag my/browser:1 .
# docker run -d --rm -p 9223:9223 --name browser1 my/browser:1
FROM my/debian:13.3

# install init
# https://github.com/just-containers/s6-overlay/releases/download/v3.2.2.0/s6-overlay-noarch.tar.xz
ADD --unpack=false s6-overlay-noarch.tar.xz /build/
# https://github.com/just-containers/s6-overlay/releases/download/v3.2.2.0/s6-overlay-x86_64.tar.xz
ADD --unpack=false s6-overlay-x86_64.tar.xz /build/

RUN <<RUNEOF
set -ex
apt-get update
apt-get install -y --no-install-recommends xz-utils
tar -C / -Jxpf /build/s6-overlay-noarch.tar.xz
tar -C / -Jxpf /build/s6-overlay-x86_64.tar.xz
rm -rf /build
RUNEOF

# install browser
ADD microsoft-edge-stable_145.0.3800.82-1_amd64.deb /build/
RUN apt-get install -y --no-install-recommends /build/microsoft-edge-stable_145.0.3800.82-1_amd64.deb
RUN rm -rf /build
# and install webdriver
ADD msedgedriver /usr/bin/
# and install socat
RUN apt-get install -y --no-install-recommends socat

# setup services # this is actually not simpler and easier than systemd
# https://github.com/just-containers/s6-overlay?tab=readme-ov-file#writing-a-service-script
# NOTE the looks like comment content is real file content in result image, should not change
RUN <<RUNEOF
set -ex
touch /etc/s6-overlay/s6-rc.d/user/contents.d/browser1
mkdir /etc/s6-overlay/s6-rc.d/browser1
echo longrun > /etc/s6-overlay/s6-rc.d/browser1/type
cat <<'CATEOF' > /etc/s6-overlay/s6-rc.d/browser1/run
#!/command/execlineb -P
microsoft-edge-stable --headless --disable-gpu --no-sandbox --window-size=1920,1080 --disable-dev-shm-usage --user-data-dir=/browser-profile --remote-debugging-port=9222 --remote-allow-origins=*
CATEOF
chmod +x /etc/s6-overlay/s6-rc.d/browser1/run
touch /etc/s6-overlay/s6-rc.d/user/contents.d/socat1
mkdir /etc/s6-overlay/s6-rc.d/socat1
echo longrun > /etc/s6-overlay/s6-rc.d/socat1/type
cat <<'CATEOF' > /etc/s6-overlay/s6-rc.d/socat1/run
#!/command/execlineb -P
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222
CATEOF
chmod +x /etc/s6-overlay/s6-rc.d/socat1/run
RUNEOF

# check in browser container /command/s6-svstat /run/s6-rc/servicedirs/browser1
# check in wsl host curl localhost:9223/json/version
# check in windows browser http://localhost:9223/devtools/inspector.html?ws=localhost:9223/devtools/page/<pageid>
# check in node container curl localhost:9223/json/version
# check in node container node index-cdp.ts
# check in browser container msedgedriver --help

ENTRYPOINT ["/init"]
