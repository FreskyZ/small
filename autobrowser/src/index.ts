
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
            const result = JSON.parse(responseText)?.value;
            console.log(`session id`, result?.sessionId);
            // this is localhost:8004, no need to handle localhost:8003
            console.log(`websocket url`, result?.capabilities?.webSocketUrl);
            console.log(`browser name`, result?.capabilities?.browserName);
            console.log(`browser version`, result?.capabilities?.browserVersion);
            console.log(`driver version`, result?.capabilities?.msedge?.msedgedriverVersion);
            // this is localhost:8001, no need to handle it because it is not used programmingly
            console.log(`debugger address`, result?.capabilities?.['ms:edgeOptions']?.debuggerAddress);
        } catch (e) {
            console.log(`failed to parse json, when will that happen?`, e);
        }
        process.exit(0);
    }
}

interface CommandResult<T = any> {
    ok: boolean,
    // if ok, value is result object, if not ok, value is the complete response
    value: T,
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
    private eventMessageHandlers: ((data: any) => void)[];
    // return cleanup
    public addEventMessageHandler(f: (data: any) => void): () => void {
        this.eventMessageHandlers.push(f);
        return () => {
            const index = this.eventMessageHandlers.indexOf(f);
            if (index) { this.eventMessageHandlers.splice(index, 1); }
        };
    }

    private nextCommandId: number = 1;
    private waits = new Map<number, { resolve: (value: CommandResult) => void, timeout: NodeJS.Timeout }>();
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
                let message: any;
                try {
                    message = JSON.parse(event.data);
                } catch (e) {
                    console.log('received data parse error', e, event.data);
                    return;
                }
                if (!message.id || typeof message.id != 'number') {
                    // TODO this is event, need to check event id and send to subscriptions
                    console.log('received data unexpected format', message);
                    return;
                } else {
                    const waitingCommand = this.waits.get(message.id);
                    if (waitingCommand) {
                        clearTimeout(waitingCommand.timeout);
                        this.waits.delete(message.id);
                        if (message.type == 'success') {
                            waitingCommand.resolve({ ok: true, value: message.result });
                        } else {
                            waitingCommand.resolve({ ok: false, value: message });
                        }
                    }
                }
            });
            this.connection.addEventListener('close', () => {
                // fail all pending commands
                for (const [, { resolve, timeout }] of this.waits) {
                    clearTimeout(timeout);
                    resolve({ ok: false, value: { message: 'client connection closed' } });
                }
                this.waits.clear();
                this.connection = null;
            });
        });
    }

    public async send(method: string, params: any): Promise<CommandResult> {
        const id = this.nextCommandId++;
        this.connection.send(JSON.stringify({ id, method, params }));
        return new Promise<CommandResult>(resolve => {
            this.waits.set(id, {
                resolve,
                timeout: setTimeout(() => {
                    this.waits.delete(id);
                    resolve({ ok: false, value: { message: 'client side timeout' } });
                }, 30000),
            });
        });
    }
}

// const connection = new RawClient(sessionId);
// await connection.connect();
// console.log(await connection.send('session.status', {}));
// connection.close();

// spec type session.StatusResult
interface DriverStatusResult {
    ready: boolean,
    message: string,
}
// spec type browsingContext.ReadinessState
type PageReadiness = 'none' | 'interactive' | 'complete';
// spec type browsingContext.NavigateResult
interface NavigateResult {
    url: string,
    // spec type is browsingContext.Navigation
    navigation: string, // what's this string
}

// spec type script.NodeRemoteValue
// although it is Node in dom api and spec, but I only use Element so call it element
interface Element {
    sharedId: string,
    value?: ElementProperties,
}
// spec type script.NodeProperties
interface ElementProperties {
    nodeType: number,
    childNodeCount: number,
    attributes: Record<string, string>,
    children: Element[],
    mode: 'open' | 'closed',
    namespaceURI: string,
    nodeValue: string,
    shadownRoot: Element,
}

// spec type script.LocalValue
type ScriptLocalValue = any; // not very meaningful to write it precisely, any for now

// convert to spec type script.LocalValue
// this spec type is designed to be programming language neutral,
// but I'm currently using js so can automatically convert it here
function convertScriptLocalValue(value: Element): ScriptLocalValue {
    if (value.sharedId) { return value; }
    else { console.log('cannot convert value for now', value); }
}

type ScriptRemoteValue =
    string; // TODO not this


// spec type script.EvaluateResult
type EvalResult = EvalResultSuccess | EvalResultException;
// spec type script.EvaluateResultSuccess
interface EvalResultSuccess {
    type: 'success',
    result: ScriptRemoteValue,
}
interface EvalResultException {

}

// this class have protocol type compare to rawclient
class Client {
    public raw: RawClient;
    public constructor(sessionId: string) {
        this.raw = new RawClient(sessionId);
    }
    public close() { this.raw.close(); }
    public async connect() { await this.raw.connect(); }

    // although this is called session.status, it is not asking session's status but driver's status
    public async driverStatus(): Promise<CommandResult<DriverStatusResult>> {
        return await this.raw.send('session.status', {});
    }

    public pageId: string;
    public setPageId(pageId: string): Client {
        this.pageId = pageId;
        return this;
    }

    public async navigate(url: string, wait?: PageReadiness): Promise<CommandResult<NavigateResult>> {
        return await this.raw.send('browsingContext.navigate', { context: this.pageId, url, wait });
    }
    public async querySelectorAll(selector: string, parameters?: { origin?: Element[], maxCount?: number }): Promise<CommandResult<Element[]>> {
        const result = await this.raw.send('browsingContext.locateNodes', {
            context: this.pageId,
            locator: { type: 'css', value: selector },
            maxNodeCount: parameters?.maxCount,
            startNodes: parameters?.origin ? parameters?.origin.map(e => ({ sharedId: e.sharedId })) : undefined,
        });
        if (!result.ok) { return result; }
        return { ok: true, value: result.value.nodes };
    }

    // ? every parameter is keyword
    public async evalWith(
        $function: string, // function code as string ()
        $arguments: any[],
        parameters?: {
            await?: boolean,
            this?: any,
        },
    ): Promise<CommandResult<EvalResult>> {
        // for now seems not related to other realm, so fix use page normal top level realm for now
        // TODO for now no need to matter result ownership, but I guess that will be happen soon


    }
}

// TODO consider subscription operation like
// const subscription = await client
//     .subscribe(pageId, 'browsingContext.contextCreated', () => { ...handle... })
//     .subscribe(pageId, 'browsingContext.navigationStarted', () => { ...handle... })
//     .subscribe(pageId, ['network.responseCompleted', 'network.fetchError'], e => { handle e.name and e.pageId })
//     .commitSubscription(); // this collects all interests and submit a subscription
// ...
// await subscription.unsubscribe(); // unsubscribe everything in the subscription

// await createSession();

// after create session, check
// - returns some page id: curl localhost:8004/session/{sessionId}/window/handles
// - browser is started and page id is same: curl localhost:8002/json/list
// - another operation to check browser is started: docker top browser1
// - manually delete session: curl -X DELETE localhost:8004/session/{sessionId}

const client = new Client('53df82d7318d563bf788f008a6624316');
await client.connect();
console.log(`connection open attach session ${client.raw.sessionId}`);
console.log(`driver status ${JSON.stringify(await client.driverStatus())}`);

client.setPageId('BB6BC7338ACB006D705994C4369AF334');
console.log(`attach page ${client.pageId}`);
// main page
// console.log(await client.navigate('https://wiki.skland.com', 'interactive'));
// weapons page
// console.log(await client.navigate('https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=2', 'interactive'));

// locate cards, this is same as item page card container class name
const querySelectorResult1 = await client.querySelectorAll('div.CommonCard__CardContainer-fQKpRL');
// console.log(querySelectorResult1);
if (!querySelectorResult1.ok || querySelectorResult1.value.length != 1) { console.log('seems not correct (1)'); }
const cardContainerElement = querySelectorResult1.value[0];

const querySelectorResult2 = await client.querySelectorAll('div.ArmsCard__Border-bHFog', [cardContainerElement], 10);
// console.log(JSON.stringify(querySelectorResult2));
if (!querySelectorResult2.ok) { console.log('seems not correct (2)'); }
const cardElements = querySelectorResult2.value;
console.log(`card count ${cardElements.length}`);

// scroll item 1 into view
await client.evalWith(((e: HTMLElement) => e.scrollIntoView()).toString(), [cardElements[0]]);

client.close();
