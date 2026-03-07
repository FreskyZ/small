
# docker build --tag my/browser:1 .
# # 8001: browser debugging port, 8002: public version, 8003: webdriver port, 8004: public version 
# docker run -d -p8002:8002 -p8004:8004 --rm --name browser1 my/browser:1
# docker run -it -v.:/work --rm --name node1 --network host my/node:1
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

# install browser and webdriver
ADD microsoft-edge-stable_145.0.3800.82-1_amd64.deb /build/
ADD msedgedriver /usr/bin/

RUN <<RUNEOF
set -ex
apt-get install -y --no-install-recommends /build/microsoft-edge-stable_145.0.3800.82-1_amd64.deb
apt-get install -y --no-install-recommends socat
rm -rf /build
RUNEOF

# setup services # this is actually not simpler and easier than systemd
# https://github.com/just-containers/s6-overlay?tab=readme-ov-file#writing-a-service-script
# NOTE the looks like comment content is real file content in result image, should not change
RUN <<RUNEOF
set -ex
touch /etc/s6-overlay/s6-rc.d/user/contents.d/webdriver1
mkdir /etc/s6-overlay/s6-rc.d/webdriver1
echo longrun > /etc/s6-overlay/s6-rc.d/webdriver1/type
cat <<'CATEOF' > /etc/s6-overlay/s6-rc.d/webdriver1/run
#!/command/execlineb -P
msedgedriver --port=8003 --allow-origins=* --disable-dev-shm-usage
CATEOF
chmod +x /etc/s6-overlay/s6-rc.d/webdriver1/run
touch /etc/s6-overlay/s6-rc.d/user/contents.d/socat1
mkdir /etc/s6-overlay/s6-rc.d/socat1
echo longrun > /etc/s6-overlay/s6-rc.d/socat1/type
cat <<'CATEOF' > /etc/s6-overlay/s6-rc.d/socat1/run
#!/command/execlineb -P
socat TCP-LISTEN:8002,fork,reuseaddr TCP:127.0.0.1:8001
CATEOF
chmod +x /etc/s6-overlay/s6-rc.d/socat1/run
touch /etc/s6-overlay/s6-rc.d/user/contents.d/socat2
mkdir /etc/s6-overlay/s6-rc.d/socat2
echo longrun > /etc/s6-overlay/s6-rc.d/socat2/type
cat <<'CATEOF' > /etc/s6-overlay/s6-rc.d/socat2/run
#!/command/execlineb -P
socat TCP-LISTEN:8004,fork,reuseaddr TCP:127.0.0.1:8003
CATEOF
chmod +x /etc/s6-overlay/s6-rc.d/socat2/run
RUNEOF

# check in browser container: ps -aux
# check in browser container: /command/s6-svstat /run/s6-rc/servicedirs/webdriver1
# check in browser container: /command/s6-svstat /run/s6-rc/servicedirs/socat1
# check in wsl host: curl localhost:8002/json/version
# check in wsl host: curl localhost:8004/status
# check in node container: curl localhost:8002/json/version
# check in node container: curl localhost:8004/status
# check in windows browser http://localhost:8002/devtools/inspector.html?ws=localhost:8002/devtools/page/<pageid>

ENTRYPOINT ["/init"]
