import WebDriver, { BidiHandler } from 'webdriver';

// cannot manually connect to webdriver websocket interface, there is no document for that
// bidi-repl: although this file is not directly interactive, it works as a repl

const browser = WebDriver.attachToSession({
    sessionId: '1ab9760eafdd2da6650aaa22df8189ba',
    // ??? you need to change this boolean to string to let it regard as bidi?
    capabilities: { webSocketUrl: 'ws://127.0.0.1:8004/session/1ab9760eafdd2da6650aaa22df8189ba' as any },
});
// ??? attachToSession forget to wait?
await (browser as any)._bidiHandler.waitForConnected();
// repl should not close session when quit
process.addListener('SIGINT', () => process.exit(0));

// console.log(browser.sessionId);
// console.log(browser.capabilities);
await browser.sessionStatus({});

// browsing context means tab/page
// by the way, this page id is same as in /json/list page id,
// so you can manually set pageid and continue previous operation
const pageId = '5FCF72E885D3FCD9FCE648FACBD1B9C4';
// const { context: pageId } = await browser.browsingContextCreate({ type: 'tab' });
// // navigate to items page
// await browser.browsingContextNavigate({ context: pageId, url: 'https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=6', wait: 'interactive' });

async function traverseItemCards() {
    // get card container element
    const cardContainerLocateResult = await browser.browsingContextLocateNodes({ context: pageId, locator: { type: 'css', value: 'div.CommonCard__CardContainer-fQKpRL'} });
    if (cardContainerLocateResult.nodes.length != 1) { console.log('seems not correct'); process.exit(1); }
    const cardContainerElement = cardContainerLocateResult.nodes[0];

    // get all cards 
    const cardsLocateResult = await browser.browsingContextLocateNodes({
        context: pageId,
        locator: { type: 'css', value: 'div.MedicineCard__Border-ezfUDJ' },
        startNodes: [{ sharedId: cardContainerElement.sharedId }],
    });
    if (!cardsLocateResult.nodes.length) { console.log('seems not correct'); process.exit(1); }
    const cardElements = cardsLocateResult.nodes;

    // click card
    for (const [cardElement, cardIndex] of cardElements.map((e, i) => [e, i] as const)) {
        if (cardIndex != 14) { continue; }
        // scroll into view
        // TODO browser.scriptCallFunction and provide node shareid as function arguments
        await browser.scriptEvaluate({
            awaitPromise: false,
            target: { context: pageId },
            expression: "document.querySelector('div.CommonCard__CardContainer" +
                // NOTE nth-child start from 1
                `-fQKpRL>div.MedicineCard__Border-ezfUDJ:nth-child(${cardIndex + 1})').scrollIntoView()`,
        });
        // move pointer and click
        await browser.inputPerformActions({
            context: pageId,
            actions: [{
                type: 'pointer',
                id: '?',
                actions: [
                    // move to the element
                    { type: 'pointerMove', x: 8, y: 8, origin: { type: 'element', element: { sharedId: cardElement.sharedId } } },
                    { type: 'pointerDown', button: 0 },
                    { type: 'pointerUp', button: 0 },
                ],
            }],
        });
        await new Promise(resolve => setTimeout(() => (resolve as any)(), 10000));
        await browser.browsingContextTraverseHistory({ context: pageId, delta: -1 });
    }
    // need release?
    await browser.inputReleaseActions({ context: pageId });
}

// TODO find recipe

// // wait for 5 min let me try browser's devtoolsfrontendurl
// await new Promise<void>(resolve => setTimeout(() => resolve(), 300000));
// await browser.browsingContextClose({ context: pageId });

// // wait for 5 min let me try browser's devtoolsfrontendurl
// // await new Promise<void>(resolve => setTimeout(() => resolve(), 300000));

// need manually exit or else the script does not end
// no way to declare detach from the session or close the websocket connection, so directly exit
process.exit(0);
