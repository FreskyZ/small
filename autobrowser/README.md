# Browser Automation

Current workflow:

- copy weapon.json into autobrowser folder if not exist is not same as endfield/sanity/weapon.json
- start browser: docker run -d -p8002:8002 -p8004:8004 --rm --name browser1 my/browser:1
- start node shell: docker run -it -v.:/work --rm --name browsernode1 -h BROWSER-NODE -w /work --network host my/node:1
- uncomment createSession in index.ts, run node index.ts, copy session id into index.ts, comment createSession
- get page id by curl localhost:8002/json/list, copy page id into index.ts, open devtools frontend url in windows browser
  http://localhost:8002/devtools/inspector.html?ws=localhost:8002/devtools/page/{pageid}
- navigate to https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=2
- run index.ts

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
  - official document site https://learn.microsoft.com/en-us/microsoft-edge/webdriver/
    missing the end slash will redirect you to a legacy site?
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

WebDriver BiDi protocol (bidi), https://github.com/w3c/webdriver-bidi or https://w3c.github.io/webdriver-bidi

- there is no official document about how to directly connect to webdriver, both edge document and chrome document
  https://developer.chrome.com/docs/chromedriver/get-started is using selenium, so try wdio's wrapper package that
  directly called webdriver https://npmjs.com/package/webdriver...
- successfully connect to webdriver, query nodes, evaluate js and click an element, but wdio and selenium is too
  unit test oriented, and wdio lacks document, the webdriver package lacks even more document that it only have a
  readme page in repository, no dedicated page in document at all, so change to manually connect websocket again
- by the way, webdriver also only opens port to localhost, so socat x2
- currently bidi session's initial session is created in the same way as classic session,
  see https://w3c.github.io/webdriver/#new-session, currently there is no way to list pages use bidi command, need to
  use classic api https://w3c.github.io/webdriver/#get-window-handles

- POST localhost:{driverport}/session with body like this
  { capabilities: { alwaysMatch: { webSocketUrl: true, 'ms:edgeOptions': { args: ["headless", "no-sandbox"] } } } },
  get response json, session id is response.value.sessionId, websocket url is response.value.capabilities.webSocketUrl,
  this url comes from request url so is the docker public port after socat, not the driver command line port
- bidi currently don't support list available tabs, use https://w3c.github.io/webdriver/#get-window-handles
  `curl localhost:8004/session/{sessionId}/window/handles`, response.value is a string array of page ids,
  this page id is same as bidi created browsing context id, and is same as `curl localhost:8002/json/list` page id
- websocket connection to the websocket url and then close does *not* close the session,
  so you can first create the session by a small script and then use the session id and page id in later operations
- need a lot of types to call call javascript functions api, so spend some time to code generate all types in the
  specification, it looks very cool that I kind of want to publish it in a standalone repo
- complete basic data crawling for endfield/essence.py use, this library looks very cool and does not use any external
  library that I kind of want to publish it in a standalone repo

- by the way, the https://npmjs.com/package/webdriver package readme claims that "There are tons of Selenium and
  WebDriver binding implementations in the Node.js world", and link to a section in the awesome repository
  https://github.com/christian-bromann/awesome-selenium#javascript, with the background knowledge that selenium is a
  very old library, click into the links in the section results in...
  - selenium-webdriver, but this link lead to a wiki page that talking about async related issues and talking about
    "the next version of javascript, ES2017", its source code is using js, jsdoc and let/const
  - https://github.com/admc/wd, is last updated 5 years ago, its source code is using js, var? and prototype?
  - webdriverio
  - https://zombie.js.org/, repository is archived in 2023, last updated 6 years ago
  - https://slimerjs.org/, last updated 5 years ago, its source code is using var? and .jsm file extension?
  - http://nightwatchjs.org/, official site looks modern and repository last updated only last month
  - https://github.com/karma-runner/karma/ is last updated 2 years ago and declared deprecated in readme
  - https://angular.github.io/protractor/ is declared end of life in 2023, repository is archived in 2024
  - https://codecept.io/ is declaring First AI-powered testing framework 🪄 on its website, looks most up to date
  so this judgement in the package readme is also deprecated
- only selenium and webdriver io supports bidi, selenium is js and does not have type definitions, wdio have type
  definitions but is
  - merging the module part into type name, result in confusing type names like BrowsingContextBrowsingContext,
    while mine is using the exactly same browsingContext.BrowsingContext
  - use JsInt and JsUint, which is very confusing for javascript users that why a type need to start with js,
    mine is using more natural int and uint
  - float and text is directly replaced with number and string
  - concrete command type is extending the Command type, which is very confusing because the Command type is the
    outmost type to be sent in websocket connection, which is more confusing that their code generation logic is
    correctly handling normal spread members but special handle the Command type in this way, my Command type is
    extending all concrete command types, which is a lot more reasonable
  - support multiple protocols so some of the hinted properties and member functions of the main client/browser object
    is actually not there in runtime, which is very confusing, mine is the thinest wrapper over the protocol, which
    will not lie in the type hints
  they declared "This binding is the most non-opinionated", now I would like to declare mine is the most unopinionated
- all of the libraries are unit test oriented, by the way, playwright is not included in the list, it is also a unit
  test library
- ask ai about no unit test library but data crawling library, beside scrapy there is nodejs
  crawlee https://crawlee.dev and find that scrapy is an html-era data crawling tool and not suitable for single page
  applications, and I assume use plugins still does not suit because scrapy is designed to work with static html,
  investigate that later if needed

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
