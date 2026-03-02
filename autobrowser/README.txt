
- First, I need to develop tools for Arknights: Endfield,
  see endfield folder in this repository
- Then, the official wiki site is hard to use,
  its api data structure is not suitable for human and AI to understand,
  other non-official wiki site is even harder to use,
  their api interfaces and data structures are even harder to understand,
- On the other side, no reliable game data extraction repository exist for now
- So I decide to extract data from official wiki site via browser automation

- First, Edge browser webdriver,
  I do not have develop environment on Windows, so I search for linux version
  and AI tells me it's ok to run webdriver on WSL to automate browser on Windows,
- Then, the official edge webdriver download site,
  https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver
  does not have linux version, the "full directory" button shows a very primitive
  and mobile style site that lists a few very old versions, seems not updated for years,
  AI tells me to download from some site like
  https://msedgedriver.azureedge.net/120.0.2210.61/edgedriver_linux64.zip,
  this is consistent with urls provided in https://github.com/MicrosoftEdge/EdgeWebDriver/issues/156,
  but this site does not support list available files, and manually input version numbers
  or copy version numbers from the prvious site does not work, the official repository
  https://github.com/MicrosoftEdge/EdgeWebDriver does not contain source code and release binaries,
  the official document site https://learn.microsoft.com/en-us/microsoft-edge/webdriver/ does not
  provide useful information, either. Based on this investigation result,
  I'd like to say edge webdriver *has stopped* support linux.
- However, this repository README recommends a new automation framework https://webdriver.io/,
  or https://github.com/webdriverio/webdriverio, this use nodejs ecosystem, which I currently prefer
  over selenium's java and python ecosystem, this also recommends other protocols Chrome Devtools
  Protocol https://github.com/ChromeDevTools/devtools-protocol and Webdriver BiDi protocol
  https://github.com/w3c/webdriver-bidi, which seems does not need to setup webdriver.exe file
- The edge official document also have a page for this feature
  https://learn.microsoft.com/en-us/microsoft-edge/devtools/protocol/
  but try this commandline on Windows does not work? AI tells me need to close all browser tabs,
  but I opened really many browser tabs for this investigation? Try this commandline on Windows VM
  seems work, but cannot access from host machine, stop here.

- Try to setup browser and wdio in wsl docker, edge official download site have .rpm or .deb file
  https://www.microsoft.com/en-us/edge/business/download, and apt install edge.deb, and the
  executable file name is "microsoft-edge"? run
  microsoft-edge --headless --disable-gpu --no-sandbox --window-size=1920,1080 --disable-dev-shm-usage --user-data-dir=/userdata1 --remote-debugging-port=10001
  this does not return to shell, run docker exec -it autobrowser1 /bin/bash for another shell
  and run curl localhost:10001/json/list works fine
- Then read https://github.com/aslushnikov/getting-started-with-cdp/blob/master/README.md
  and write a basic websocket communication script to prove it works

- Try to use wdio, and wdio official site is lacking document about Chrome Devtools Protocol setup,
  open the related package https://www.npmjs.com/package/devtools says wdio is deprecating CDP in favor
  of Webdriver BiDi, so try to use the dedicated library for CDP https://pptr.dev/, edge official
  document have a page for this https://learn.microsoft.com/en-us/microsoft-edge/puppeteer/,
  see following progress in index.ts
