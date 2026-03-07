import http from 'node:http';
// import { WebSocket } from 'ws';

// start browser
// microsoft-edge --headless --disable-gpu --no-sandbox --window-size=1920,1080 --disable-dev-shm-usage --user-data-dir=/userdata1 --remote-debugging-port=10001

// NOTE this globalThis.fetch is web fetch and forbid overwrite request header host
const response = await new Promise(resolve => {
    http.request({
        hostname: 'localhost',
        port: 9223,
        path: '/json/version',
        method: 'GET',
        // headers: { host: 'localhost' },
    }, response => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => { resolve(JSON.parse(data)); });
    }).end();
});
const websocketURL = response['webSocketDebuggerUrl'];

const wakers: (() => void)[] = [];
const buffer: { id: number, [prop: string]: any }[] = [];

const client = new WebSocket(websocketURL/*, { headers: { host: 'localhost' } }*/);
await new Promise<void>(resolve => {
    client.addEventListener('open', () => {
        console.log('connection open');
        resolve();
    });
    client.addEventListener('close', e => {
        console.log(`connection closed`, e);
        process.exit(0);
    });
    client.addEventListener('error', e => {
        console.log(`connection error`, e);
        process.exit(1);
    });
    client.addEventListener('message', messageEvent => {
        let data: typeof buffer[0];
        try {
            data = JSON.parse(messageEvent.data as string);
        } catch (e) {
            console.log(`failed to parse received data`, messageEvent.data, e);
            return;
        }
        buffer.push(data);
        wakers.forEach(w => w());
        // console.log(`received`, data.id ?? '(no id?)');
    });
});

let nextRequestId = 1;
function send(method: string, sessionId?: string, params?: any): Promise<any> {
    const requestId = nextRequestId;
    nextRequestId += 1;
    let waker: any;
    let timeout: any;
    const received = new Promise<any>(resolve => {
        wakers.push(waker = () => {
            const dataIndex = buffer.findIndex(d => d.id == requestId);
            if (dataIndex >= 0) {
                const wakerIndex = wakers.indexOf(waker);
                if (wakerIndex >= 0) { wakers.splice(wakerIndex, 1); }
                if (timeout) { clearTimeout(timeout); }
                const data = buffer.splice(dataIndex, 1)[0];
                console.log(`received #${data.id} ${JSON.stringify(data)}`);
                resolve(data);
            }
        });
    });

    console.log(`sending #${requestId} ${method} ${JSON.stringify(params)}`);
    client.send(JSON.stringify({ id: requestId, sessionId, method, params }));

    return Promise.any([
        new Promise(resolve => timeout = setTimeout(() => {
            console.log(`request ${requestId} timeout`);
            const wakerIndex = wakers.indexOf(waker);
            if (wakerIndex >= 0) { wakers.splice(wakerIndex, 1); }
            resolve(null);
        }, 10000)),
        received,
    ]);
}

await send('Browser.getVersion');
await send('Target.getTargets');

// close new tab
// console.log(await send('Target.closeTarget', { targetId: '392C7E818C3CD4A79EF5CA9768321051' }));

// client.send(JSON.stringify({
//     id: 2,
//     method: 'Target.createTarget',
//     params: {
//         url: 'https://wiki.skland.com',
//     },
// }));

// const { result: { sessionId } } = await send('Target.attachToTarget',
//     undefined, { targetId: '98ABFE296BB8B8CBA3914058CF4F21B3', flatten: true });

// method name is case sensitive
// await send('Page.navigate', sessionId, { url: 'https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=5' });

// const document = await send('DOM.getDocument', sessionId, { depth: 2 });
// const bodyNodeId = document.result.root.children[1].children[1].nodeId;
// console.log(`body nodeid = ${bodyNodeId}`);

// const selectResult = await send('DOM.querySelectorAll', sessionId, { nodeId: bodyNodeId, selector: 'div.MedicineCard__Title-bfcsTh' });
// const nodeIds = selectResult.result.nodeIds;

// for (const nodeId of nodeIds) {
//     // now this become extreme complex to get innertext, so this experiment stop here
// }

// if this method does not need sessionId but you pass it, it will also error
// await send('Target.detachFromTarget', undefined, { targetId: '98ABFE296BB8B8CBA3914058CF4F21B3', sessionId });

// console.log('closing browser');
// await send('Browser.close');
// client.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
setTimeout(() => { console.log('timeout closing'); client.close(); }, 10000);
process.on('SIGINT', () => { console.log('interrupt closing'); client.close(); });

export {};
