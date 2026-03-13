import fs from 'node:fs/promises';
import type * as spec from './spec.js';

// create session, display and exit
async function createSession(): Promise<never> {
    const browserArguments = [
        // this is important, not sure what happens if missing in no gui environment
        "headless",
        // this is important, or else cannot access devtools frontend url
        "remote-debugging-port=8001",
        // this is important, or else cannot access devtools frontend url from other machine
        "remote-allow-origins=*",
        // this should be important, this was raising error if missing, not sure what happens if missing now
        "no-sandbox",
        // this should be important, not sure what happens if missing
        "disable-gpu",
        // this may be important, not sure what happens if missing in no gui environment
        "window-size=1920,1080",
        // this is not important, but not sure what happens if not specified
        "user-data-dir=/browser-profile1",
        // this seems common
        "disable-dev-shm-usage",
        // the following values comes from arbitrary picking from
        // https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md
        // should be ok if missing
        "disable-client-side-phishing-detection",
        "disable-component-extensions-with-background-pages",
        "disable-default-apps",
        "disable-extensions",
        "disable-features=InterestFeedContentSuggestions",
        "disable-features=Translate",
        "no-default-browser-check",
        "no-first-run",
        "ash-no-nudges",
        "disable-breakpad",
        "disable-sync",
        "disable-background-networking",
        "disable-search-engine-choice-screen",
    ];

    const capabilities = {
        alwaysMatch: {
            // this is important, or else no websocket url provided,
            // // but may be browser can still work if you concat a websocket url?
            webSocketUrl: true,
            'ms:edgeOptions': {
                // // document page says this default to false,
                // // but you need to manually specify false to prevent browser from closing
                // detach: false
                // // this is remote debugging address in returned capabilities object,
                // // may be can be used to connect to already opened browser instance,
                // // but I want to avoid put the long list of arguments in container setup or service setup, so not try this
                // debuggerAddress: 'localhost:8001',
                args: browserArguments,
            },
        },
        // standard says firstMatch array can be omitted, so omit
        // https://w3c.github.io/webdriver/#processing-capabilities 7.2.3
        // firstMatch: [{}],
    };

    const response = await fetch('http://localhost:8004/session', { method: 'POST', body: JSON.stringify({ capabilities }) });
    if (!response.ok) {
        console.log(`amazingly not ok`, await response.text());
        process.exit(1);
    } else {
        const responseText = await response.text();
        console.log(responseText);
        try {
            const result = JSON.parse(responseText)?.value as spec.session.NewResult;
            console.log(`session id`, result?.sessionId);
            // this is localhost:8004, no need to handle localhost:8003
            console.log(`websocket url`, result?.capabilities?.webSocketUrl);
            console.log(`browser name`, result?.capabilities?.browserName);
            console.log(`browser version`, result?.capabilities?.browserVersion);
            console.log(`driver version`, result?.capabilities?.['msedge']?.msedgedriverVersion);
            // this is localhost:8001, no need to handle it because it is not used programmingly
            console.log(`debugger address`, result?.capabilities?.['ms:edgeOptions']?.debuggerAddress);
        } catch (e) {
            console.log(`failed to parse json, when will that happen?`, e);
        }
        process.exit(0);
    }
}

class RawClient {
    // note nodejs direct run typescript does not support constructor parameter declared member fields for now
    public readonly sessionId: string;
    public constructor(sessionId: string) {
        this.sessionId = sessionId;
        this.eventMessageHandlers = [];
    }

    public connection: WebSocket;
    public close() {
        this.connection?.close();
    }
    
    // this is not generic event handlers, this only handles event message
    // event message is not response of command, does not have id, is only enabled by subscription
    // in this class, all handlers receive all event messages, event dispatch is in higher abstraction level
    private readonly eventMessageHandlers: ((event: spec.Event) => void)[];
    // return cleanup
    public addEventMessageHandler(f: (event: spec.Event) => void): () => void {
        this.eventMessageHandlers.push(f);
        return () => {
            const index = this.eventMessageHandlers.indexOf(f);
            if (index) { this.eventMessageHandlers.splice(index, 1); }
        };
    }

    private nextCommandId: number = 1;
    private readonly waits = new Map<number, { resolve: (value: spec.CommandResponse | spec.ErrorResponse) => void, timeout: NodeJS.Timeout }>();
    public async connect() {
        if (this.connection) {
            console.log('connection not null, what happened?');
            return;
        }
        return new Promise<void>((resolve, reject) => {
            this.connection = new WebSocket(`ws://localhost:8004/session/${this.sessionId}`);
            this.connection.addEventListener('open', () => {
                resolve();
            });
            this.connection.addEventListener('error', e => {
                console.log(`connection error`, e);
                reject();
            });
            this.connection.addEventListener('message', (event) => {
                let message: spec.Message;
                try {
                    message = JSON.parse(event.data);
                } catch (e) {
                    console.log('received data parse error', e, event.data);
                    return;
                }
                if (message.type == 'success' || message.type == 'error') {
                    if (!message.id || typeof message.id != 'number') {
                        console.log('received data unexpected format', message, JSON.stringify(message));
                        return;
                    }
                    const waitingCommand = this.waits.get(message.id);
                    if (waitingCommand) {
                        clearTimeout(waitingCommand.timeout);
                        this.waits.delete(message.id);
                        waitingCommand.resolve(message);
                    }
                } else /* event */ {
                    if (!message.method || typeof message.method != 'string') {
                        console.log('received event unexpected format', message, JSON.stringify(message));
                        return;
                    }
                    this.eventMessageHandlers.forEach(h => h(message));
                }
            });
            this.connection.addEventListener('close', () => {
                // fail all pending commands
                for (const [, { resolve, timeout }] of this.waits) {
                    clearTimeout(timeout);
                    resolve({ type: 'error', id: null, error: 'client side error' as spec.ErrorCode, message: 'client connection closed' });
                }
                this.waits.clear();
                this.connection = null;
            });
        });
    }

    public async send<M extends spec.Method>(method: M, params: spec.MethodMap<M>): Promise<spec.MethodResultMap[M]> {
        const id = this.nextCommandId++;
        this.connection.send(JSON.stringify({ id, method, params }));
        const response = await new Promise<spec.CommandResponse | spec.ErrorResponse>((resolve, reject) => {
            this.waits.set(id, {
                resolve,
                timeout: setTimeout(() => {
                    this.waits.delete(id);
                    reject('client side timeout');
                }, 30000),
            });
        });
        if (response.type == 'error') {
            console.log('command response error', response, JSON.stringify(response));
            throw new Error(response.message);
        }
        return response.result as spec.MethodResultMap[M];
    }
}

// const connection = new RawClient(sessionId);
// await connection.connect();
// console.log(await connection.send('session.status', {}));
// connection.close();

// convert to spec type script.LocalValue
// this spec type is designed to be programming language neutral,
// but I'm currently using js so can automatically convert it here
// function convertScriptLocalValue(value: spec.script.NodeRemoteValue): spec.script.LocalValue {
//     if (value.sharedId) { return value; }
//     else { console.log('cannot convert value for now', value); }
// }

// const unsubscribe = await client
//     .setPageId(pageId)
//     .subscribe('browsingContext.contextCreated', () => { ...handle... })
//     .subscribe('browsingContext.navigationStarted', () => { ...handle... })
//     .subscribe(['network.responseCompleted', 'network.fetchError'], e => { handle e.name and e.pageId })
//     .commit(); // this collects all interests and submit a subscription
// ...
// await unsubscribe(); // unsubscribe everything in the subscription
class SubscriptionBuilder {
    public readonly raw: RawClient;
    public readonly pageId: string;
    public constructor(raw: RawClient, pageId: string) {
        this.raw = raw;
        this.pageId = pageId;
    }

    private readonly events: spec.EventName[] = [];
    private readonly handlers: Partial<Record<spec.EventName, ((e: spec.Event) => void)[]>> = {};
    public subscribe(events: spec.EventName | spec.EventName[], handler: (e: spec.Event) => void): SubscriptionBuilder {
        events = Array.isArray(events) ? events : [events];
        events.forEach(e => this.events.push(e));
        events.forEach(e => (this.handlers[e] ??= []).push(handler));
        return this;
    }

    public async commit() {
        const { subscription } = await this.raw.send('session.subscribe', { events: this.events, contexts: [this.pageId] });
        const removeHandler = this.raw.addEventMessageHandler((e: spec.Event) => {
            (this.handlers[e.method] ?? []).forEach(h => h(e));
        });
        return async () => {
            removeHandler();
            await this.raw.send('session.unsubscribe', { subscriptions: [subscription] });
        };
    }
}

// this class have protocol type compare to rawclient
class Client {
    public readonly raw: RawClient;
    public constructor(sessionId: string) {
        this.raw = new RawClient(sessionId);
    }
    public close() { this.raw.close(); }
    public async connect() { await this.raw.connect(); }

    public subscribe(events: spec.EventName | spec.EventName[], handler: (e: spec.Event) => void): SubscriptionBuilder {
        return new SubscriptionBuilder(this.raw, this.pageId).subscribe(events, handler);
    }

    // although this is called session.status, it is not asking session's status but driver's status
    public async driverStatus(): Promise<spec.session.StatusResult> {
        return await this.raw.send('session.status', {});
    }

    public pageId: string;
    public setPageId(pageId: string): Client {
        this.pageId = pageId;
        return this;
    }

    public async navigate(
        url: string,
        wait?: spec.browsingContext.ReadinessState,
    ): Promise<spec.browsingContext.NavigateResult> {
        return await this.raw.send('browsingContext.navigate', { context: this.pageId, url, wait });
    }
    public async go(offset: number): Promise<void> {
        await this.raw.send('browsingContext.traverseHistory', { context: this.pageId, delta: offset });
    }

    public async querySelectorAll(
        selector: string,
        parameters?: {
            origin?: spec.script.NodeRemoteValue[],
            maxCount?: number,
            maxDepth?: number,
        },
    ): Promise<spec.script.NodeRemoteValue[]> {
        const result = await this.raw.send('browsingContext.locateNodes', {
            context: this.pageId,
            locator: { type: 'css', value: selector },
            maxNodeCount: parameters?.maxCount,
            serializationOptions: { maxDomDepth: parameters?.maxDepth },
            startNodes: parameters?.origin ? parameters.origin.map(e => ({ sharedId: e.sharedId })) : undefined,
        });
        return result.nodes;
    }
    // wait to be locatable
    public async waitElements(
        selector: string,
        timeout: number, // in seconds
        parameters?: {
            origin?: spec.script.NodeRemoteValue[],
            maxCount?: number,
        },
    ): Promise<spec.script.NodeRemoteValue[]> {
        // it may be amazing when you first see AI use Date in wait and timeout operations
        // but it's actually more simple than Promise.race, and is more precise than assuming delay time is accurate
        const startTime = Date.now();
        while (Date.now() - startTime < timeout * 1000) {
            const result = await this.querySelectorAll(selector, parameters);
            if (result.length > 0) {
                return result;
            }
            await delay(1);
        }
        return [];
    }

    // ? every parameter is keyword
    public async call(
        $function: string, // function code as string ()
        $arguments: any[],
        parameters?: {
            await?: boolean,
            this?: any,
        },
    ): Promise<spec.script.EvaluateResult> {
        // TODO for now no need to matter result ownership, but I guess that will be happen soon
        const result = await this.raw.send('script.callFunction', {
            functionDeclaration: $function,
            awaitPromise: parameters?.await ?? false,
            // for now seems not related to other realm, so fix use page normal top level realm for now
            target: { context: this.pageId },
            arguments: /* TODO this conversion */ $arguments,
        });
        return result;
    }

    public async click(element: spec.script.NodeRemoteValue): Promise<void> {
        await this.raw.send('input.performActions', {
            context: this.pageId,
            actions: [{
                type: 'pointer',
                id: '?', // ?
                actions: [
                    { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: element.sharedId } } },
                    { type: 'pointerDown', button: 0 },
                    { type: 'pointerUp', button: 0 },
                ],
            }],
        });
    }
}

async function delay(seconds: number) {
    await new Promise<void>(resolve => setTimeout(() => resolve(), seconds * 1000));
}

// diagnostic approaches
// - check container ps: docker top browser1
// - check cdp api localhost:8002/json/version and localhost:8002/json/list
// - check webdriver classic api localhost:8004/status and localhost:8004/session/{sessionId}/window/handles
// - delete session? curl -X DELETE localhost:8004/session/{sessionId}

// 1. createSession
// await createSession();
// 2. get page id: curl localhost:8002/json/list
// 3. insert session id and page id in this source code
// 4. open devtools frontend url

const client = new Client('3e1d7b6e1d02dedc13f552695d65c740');
await client.connect();
console.log(`connection open attach session ${client.raw.sessionId}`);
console.log(`driver status ${JSON.stringify(await client.driverStatus())}`);

client.setPageId('A2EE4528B46AA95FF5404DC856E0533D');
console.log(`attach page ${client.pageId}`);
// main page
// console.log(await client.navigate('https://wiki.skland.com', 'interactive'));
// weapons page
// console.log(await client.navigate('https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=2', 'interactive'));

// the random sequence in the classnames are definitely generated by some logic
// and it very likely to change after website is updated, so better put them together to make them easier to find
const selectors = {
    cardContainer: 'div.CommonCard__CardContainer-fQKpRL',
    card: 'div.ArmsCard__Border-bHFog',
    documentWrapper: 'div.Document__Wrapper-eLvDYV',
    rarityClasses: [['jnHwkG', 6], ['dVhNsJ', 5], ['eFBkOY', 4], ['gFiiRG', 3]] as [string, number][],
};
const remoteFunctions = {
    // weapon name from card element
    getWeaponName: ((e: HTMLDivElement) => (e.childNodes[0].childNodes[3] as HTMLDivElement).innerText).toString(),
    // scroll into any element
    scrollIntoView: ((e: HTMLElement) => e.scrollIntoView()).toString(),
    // weapon attributes in weapon detail page
    // this site use api data structure and html layout structure that no human and AI can understand
    getWeaponAttributes: (() => {
        // ATTENTION this is remote function cannot reference variables here
        for (const documentWrapperElement of Array.from(document.querySelectorAll('div.Document__Wrapper-eLvDYV'))) {
            if ((documentWrapperElement?.childNodes[0]?.childNodes[0]?.childNodes[0] as HTMLSpanElement)?.innerText == '属性能力') {
                return [2, 5, 8].map(i => (documentWrapperElement.childNodes[i]?.childNodes[0]?.childNodes[0] as HTMLSpanElement)?.innerText);
            }
        }
    }).toString(),
};

async function collectWeapons() {
    interface WeaponData {
        name: string,
        rarity: number,
        attributes: string[],
    }
    const weapondata: WeaponData[] = JSON.parse(await fs.readFile('weapon.json', 'utf-8'));

    await client.waitElements(selectors.cardContainer, 10);
    // NOTE these elements are invalidated after navigation
    // // actually js in browser also gets invalidated after navigation, this is kind of reasonable
    // so add a stale flag to reload element if need or avoid reload if not stale
    let elementsAreValid = true;
    let cardElements = await client.querySelectorAll(selectors.card, { maxDepth: 3 });
    // console.log(JSON.stringify(cardElements, undefined, 2));
    const cardElementCount = cardElements.length;
    console.log(`card count ${cardElementCount}`);

    // name and rarity is available in returned node infomation
    for (const cardElement of cardElements) {
        const children = cardElement?.value?.children?.[0]?.value?.children;
        if (!children || children.length != 4) {
            console.log(`card element unexpected layout`, JSON.stringify(cardElement, undefined, 2));
            continue;
        }

        const weaponName = children[3]?.value?.children?.[0]?.value?.nodeValue?.trim();
        if (!weaponName) {
            console.log(`card element not found name in children[3].innerText`, JSON.stringify(cardElement, undefined, 2));
            continue;
        }
        let entry = weapondata.find(w => w.name == weaponName);
        if (!entry) {
            console.log(`create new entry for previously unknown weapon ${weaponName}`);
            entry = { name: weaponName, rarity: undefined, attributes: undefined };
            weapondata.push(entry);
        }

        // rarity can be found by decoration style
        if (!entry.rarity) {
            const classname = children[2]?.value?.attributes?.['class'];
            if (classname && typeof classname == 'string') {
                const classnames = classname.split(' ');
                const rarity = selectors.rarityClasses.find(([c]) => classnames.includes(c))?.[1];
                if (!rarity) {
                    console.log(`card element not found rarity by known mapping, ` +
                        `classname is ${classname}`, JSON.stringify(cardElement, undefined, 2));
                } else {
                    entry.rarity = rarity;
                }
            } else {
                console.log(`card element not found rarity style in children[2]`, JSON.stringify(cardElement, undefined, 2));
                // not continue
            }
        }
    }

    for (let cardIndex = 0; cardIndex < cardElementCount; cardIndex += 1) {
        if (!elementsAreValid) {
            await client.waitElements(selectors.cardContainer, 10);
            cardElements = await client.querySelectorAll(selectors.card, { maxDepth: 3 });
            elementsAreValid = true;
        }

        const cardElement = cardElements[cardIndex];
        const weaponName = cardElement?.value?.children?.[0]?.value?.children?.[3]?.value?.children?.[0]?.value?.nodeValue?.trim();
        if (!weaponName) {
            console.log(`weapon index ${cardIndex} not found weapon name?`, JSON.stringify(cardElement, undefined, 2));
            continue;
        }
        const entry = weapondata.find(w => w.name == weaponName);
        if (!entry) {
            console.log(`you find a new weapon inside the loop, how?`, JSON.stringify(cardElement, undefined, 2));
            continue;
        }

        // already known, skip
        if (entry.attributes && entry.attributes.length) { continue; }

        // click into weapon detail page
        console.log(`click into ${weaponName}`);
        await client.call(remoteFunctions.scrollIntoView, [cardElement]);
        await client.click(cardElement);
        elementsAreValid = false;

        // search for attributes
        const attributes: string[] = [];
        await client.waitElements(selectors.documentWrapper, 10);
        const evalResult2 = await client.call(remoteFunctions.getWeaponAttributes, []);
        // by the way, 3 star weapon only have 2 attributes, making this condition false, and the last element is {type:"undefined"}
        if (evalResult2.type == 'success' && evalResult2.result.type == 'array'
            && evalResult2.result.value.length == 3 && !evalResult2.result.value.some(v => v.type != 'string'))
        {
            attributes.push(...evalResult2.result.value.map(v => (v as spec.script.StringValue).value.trim()));
        } else {
            console.log(`unexpected eval result2`, JSON.stringify(evalResult2));
        }
        entry.attributes = attributes;
        console.log(`load attributes for ${weaponName}: ${attributes}`);

        // go back
        await delay(3); // wait for my human eye
        await client.go(-1);
    }

    await fs.writeFile('weapon.json', JSON.stringify(weapondata, undefined, 2));
}

await collectWeapons();
client.close();
