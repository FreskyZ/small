import WebDriver from 'webdriver';

// bidi-keeper: you need to keep the session and the websocket connection alive
// to keep the page devtoolsfrontendurl alive to avoid duplicate work of openning devtools frontend
// the webdriver.newsession automatically keeps the script running, no need to wait forever, etc.

// port + capabilities.webSocketUrl is enough for connecting to externally opened webdriver
const capabilities: Parameters<typeof WebDriver.newSession>[0]['capabilities'] = {
    webSocketUrl: true,
    'ms:edgeOptions': {
        // document page says this default to false, but you need to manually specify false to prevent browser from closing
        // detach: false
        // https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md
        args: [
            "headless",
            "disable-gpu",
            "no-sandbox",
            "window-size=1920,1080",
            "disable-dev-shm-usage",
            "user-data-dir=/browser-profile1",
            "disable-client-side-phishing-detection",
            "disable-component-extensions-with-background-pages",
            "disable-default-apps",
            "disable-extensions",
            "disable-features=InterestFeedContentSuggestions",
            "disable-features=Translate",
            "no-default-browser-check",
            "no-first-run",
            "ash-no-nudges",
            "disable-search-engine-choice-screen",
            "disable-background-networking",
            "disable-breakpad",
            "disable-sync",
            "remote-debugging-port=8001",
            "remote-allow-origins=*",
        ],
        // this seems to be connecting to already opened browser?
        // but I prefer put this long list args here not in container setup or service setup
        // debuggerAddress: '0.0.0.0:8005',
    },
}
const browser = await WebDriver.newSession({ port: 8004, capabilities });
// keeper need to close session when quit
process.addListener('SIGINT', async () => { await browser.sessionEnd({}); process.exit(0); });
