# Browser Automation

### Motivation

First, I need to develop tools for Arknights: Endfield, see ../endfield

- Then, I need game data, the official wiki site https://wiki.skland.com is hard to use, does not contain much
  information than in game data, and its api data structure is not suitable for human and AI to understand, other
  non-official wiki sites are even harder to use and resolve api data, also, no game data extraction repository found
  on github, yet.
- So I decide to extract data from official wiki site via browser automation

### WebDriver

First, webdriver executable according to my browser automation experience

- There is a edge webdriver official download site https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver
  has download link https://msedgedriver.microsoft.com/145.0.3800.82/edgedriver_linux64.zip, or if you'd like this
  longer link https://msedgewebdriverstorage.blob.core.windows.net/edgewebdriver/145.0.3800.82/edgedriver_linux64.zip
  the version number is exactly same as version displayed in desktop edge setting page edge://settings/help
- by the way
  - official document site https://learn.microsoft.com/en-us/microsoft-edge/webdriver
  - official repository https://github.com/MicrosoftEdge/EdgeWebDriver does not contain source code but
    is only for feedbacks or bug reporting, that's because its source code is in chrome source code, not here
  - there is a "full directory" button which goes to https://msedgewebdriverstorage.z22.web.core.windows.net/
    while the ui seems very primitive and mobile style, and the listed versions are very incomplete and old, manually
    input the required version https://msedgewebdriverstorage.z22.web.core.windows.net/?prefix=145.0.3800.82/
    successfully opens the directory for the download links for each platform
  - wdio (introduced later) have some utility packages that download and installs the webdriver binaries for
    each browser and platform like https://github.com/webdriverio-community/node-edgedriver, if you have difficulties
    using previous approaches in the future, you may check this
  - AI sometimes suggeste download url https://msedgedriver.azureedge.net does not work and seems to be the
    old download url in ancient days
  - why is there so many by-the-ways? because I have difficulties downloading linux platform edge webdriver for some
    time, and after some other time I surprisingly find nearly all previous approaches magically works, so record here

### Automation Library/Framework

First, I'd like to avoid selenium because it's java, and I'd like to avoid setup and use java even with the help of
containerization, while the edge webdriver repository happens to recommend a new automation library other than
selenium, webdriverio (wdio), at https://webdriver.io/ or https://github.com/webdriverio/webdriverio, which is written
in nodejs and currently only available in nodejs, which exactly meets my requirement

### Automation Protocol

In old days, there is only webdriver automation protocol, and wdio's introduction document
https://webdriver.io/docs/why-webdriverio immediately shows 2 new (not actually) protocols, Chrome Devtools Protocol
and WebDriver BiDi protocol, while the classic webdriver protocol becomes the "webdriver (classic)" protocol

Chrome Devtools Protocol (CDP), https://github.com/ChromeDevTools/devtools-protocol, according to AI, is more powerful,
allow low level control, avoid webdriver executable, but chrome specific, which is ok because I'm using chromium based
edge, trying CDP protocol...

- official document related page https://learn.microsoft.com/en-us/microsoft-edge/devtools/protocol/
- run msedge.exe --remote-debugging-port= on windows powershell, nothing happens, AI tells me I need to close all
  browser instances to make this work, was openinng very many tabs to investigate this topic, and not sure whether
  they can recover with the special command line argument, stop here
- try setup browser in docker, should be good to start a brand new browser without my daily profile, edge official
  download site https://www.microsoft.com/en-us/edge/business/download provides .deb file, apt install this.deb works
  ok, run `microsoft-edge --headless --disable-gpu --no-sandbox --window-size=1920,1080 --disable-dev-shm-usage
  --user-data-dir=/userdata1 --remote-debugging-port=10001` and then run `curl localhost:10001/json/verison` works ok
- read tutorial https://github.com/aslushnikov/getting-started-with-cdp/blob/master/README.md and api index
  https://chromedevtools.github.io/devtools-protocol and write a basic index-cdp.ts script to connect to the
  websocket debugging url, Browser.getVersion, Target.getTargets works ok, Target.attachToTarget, DOM.getDocument,
  DOM.querySelectorAll works ok, get innerText for each query result element is very complex, pause here
- try to use CDP in wdio and find that there is very few document content about CDP, open the related package page
  https://www.npmjs.com/package/devtools says that they are pushing towards WebDriver BiDi protocol and deprecating
  CDP, change to the dedicated library for CDP, puppeteer https://pptr.dev/ or https://github.com/puppeteer/puppeteer,
  read official document related page https://learn.microsoft.com/en-us/microsoft-edge/puppeteer/ and write a basic
  index-pptr.ts script and run on my node image (this will be important later), bypass a strange check (will be
  important later) by setting request header "Host: localhost" and successfully load websocket debugging url
  by the /json/version http endpoint but failed to establish websocket connection? pause here

WebDriver BiDi protocol (bidi), https://github.com/w3c/webdriver-bidi or https://w3c.github.io/webdriver-bidi,
TODO
TODO bidi still need webdriver.exe

### Visualization

- The browser need to run headless in container, it will be good if the work process can be visualized in gui
- start msedge.exe with remote debugging port parameter in a windows hyperv machine, successfully access /json/version
  endpoint in the opened browser itself, cannot access the endpoint in host windows machine?, enable network discovery
  and file sharing switch and successfully ping to the virtual machine but cannot access the endpoint in host machine?
  start a basic asp.net core http server on virtual machine and successfully access it in host machine? stop here
- close all browser instance on windows and start with remote debugging port parameter, successfully access the
  endpoint in the opened browser itself, successfully access it in wsl host, cannot access it in a docker container?
  and cannot access it by replacing localhost with host's ip address? and cannot access it by replacing localhost with
  http://host.docker.internal special domain? and cannot access it with docker run --network host parameter? stop here
- start msedge in container and let it run, successfully access the endpoint inside the container, cannot access it in
  another container? *can* access it in another container by adding --network host to both containers, cannot access it
  in wsl host with --network host parameter? cannot access it by adding -p port mapping parameter in docker run? cannot
  access it by replacing host to container's ip address? cannot access it by adding --remote-debugging-address
  parameter that AI confidently tells me? cannot access by adding --remote-allow-origin parameter? cannot access it by
  change port to more normal value? cannot access it by replacing microsoft-edge to google-chrome? start a simple http
  server by nodejs express and *can* access?
- collect the experiments and AI tells me --remote-debugging-address is not send to the actual executable file
  google-chrome-stable? and other parameters successfully send to the actual executable? and this can be confirmed by
  netstat command or browser command line debug output that the port is only listening to localhost, not any address,
  this is true, and run a socat to redirect 0.0.0.0 based port to this port makes the wsl host **CAN** access the
  endpoint, and makes the windows host **CAN** access the endpoint, and makes another container **CAN** access the
  endpoint without --network host parameter
- searching for --remote-debugging-address indicates the parameter is removed? because of security reasons, which makes
  it looks like https://github.com/FreskyZ/fine/blob/b85b6e27a7/docs/authentication.md#design-principle cookie based
  cross subdomain single sign-on part, searching for --remote-debugging-port in chromium source code
  https://github.com/chromium/chromium shows normal results in command line argument parsing source code, remote
  debugging server setup source code, test cases and documents, searching for --remote-debugging-address in source code
  shows this functionality is removed from chromium while AI never pay attention to this issue when they confidently
  write down this parameter and make up the guess that this parameter is not send to the actual executable. To make
  things WORSE, chrome NEVER throws error on this invalid command line parameter, also include the previous chrome
  NEVER throws error when I try remote debugging port on windows with other tabs open. To make things worse, there is
  no standard or specification of how chrome responds to its command line parameters that you can blame on. To make
  things more annoying, the cannot access the endpoint in hyperv machine, the cannot access it from container to
  windows host, the cannot access in another container, and the cannot access from host to container ALL come from this

  *rest for some time to calm down*

- the "devtoolsFrontendUrl" in /json/list response is the url to connect on gui browser to display current page content
  and operate that page's devtool, this url is unexpectedly prefixed https://aka.ms/docs-landing-page/serve_rev/ in
  edge, actually it is unexpectedly prefixed https://chrome-devtools-frontend.appspot.com/serve_rev in chromium if not
  correctly configured, if that happens, fill in port and pageid in
  http://localhost:{port}/devtools/inspector.html?ws=localhost:{port}/devtools/page/{pageid}, this port is the port
  mapped by socat and exposed by docker, cross machine access to this websocket endpoint need --remote-allow-origins=*
  in command line options
- by the way, the docker run -p parameter usage -p 127.0.0.1:9222:9222 specifies listen address on host, which is not
  related to this issue
- by the way, remove --remote-debugging-address,
  discussion https://issues.chromium.org/issues/327558594
  commit https://github.com/chromium/chromium/commit/6fee475feb9bc9aaded8f9b6443d18edb22de86b

### Current Setup

TODO

timeline
start edgedriver,
start nodejs to connect edgedriver
send capibilities-like object to edgedriver
edgedriver start edge
host edge connect to devtoolsfrontendurl

cannot control edge startup in edgedriver
so, edge and edge driver use same container
and the long edge startup command line options is specified in node source code
so seems no need docker compose
