
// https://api-docs.deepseek.com/api/create-chat-completion
const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer`,
    },
    body: JSON.stringify({
        model: 'deepseek-v4-flash',
        // thinking: { type: 'enabled' },
        stream: true,
        messages: [
            { role: 'user', content: tempUserMessage },
        ],
    }),
});

console.log(`response ${response.status}`);
for (const [key, value] of response.headers.entries()) {
    console.log(`response header ${key}: ${value}`);
}
// no expected error status code, all non 200 are critical error
if (!response.ok) {
    console.error(`response not ok`);
    process.exit(1);
}
const responseContentType = response.headers.get('content-type');
// response content-type can contain charset= and boundary= by the way
if (!responseContentType || !responseContentType.includes('text/event-stream')) {
    console.error(`response content type not event stream?`);
    process.exit(1);
}

// html spec (why is this not rfc) https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
// mdn https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format
// by the way, microsoft branded not active developing but active downloaded package https://www.npmjs.com/package/@microsoft/fetch-event-source

// according to spec
// - stream = event*
// - event = (comment | field)* EOL
// - comment = COLON ANY* EOL
// - field = field-name (COLON SPACE* ANY*)? EOL
// - field-name = ANYEXCEPT* # any char except colon, cr and lf
// - EOL = CR | LF | CR LF
// - ANY is any utf8 char, ANY* is any utf8 sequence

// - the common practice is split whole response by \n\n, and then split message (event) by \n into fields, but actually
//   the \n\n comes from field's eol + message's eol, if the final message miss the eol, it is not complete and is not dispatched
// - a field can have extra space after the colon, but not before, before the colon is always field name?
//   field without colon is regarded all as field name and no field value, what's the usage? emptify last event id and event type?
// - for web EventSource api, field names allow id, event, data, retry, others are ignored
//   - id does not allow \0?, or else it is ignored,
//     use in last-event-id, while I don't see any discussion about this in ai apis?
//   - event is event name use in .addEventListener
//   - data is data, can have multiple data in one message, they are concat with .join(\n)
//   - retry is retry time, why do server send this?
//   - if you have control of server and client side you can have custom field names? not for this scenario
// - a message with empty data is not dispatched
// - there is NO guarantee over a message will not be cut in the middle in 2 transmits,
//   there is NO guarantee over a utf8 multi byte character will not be cut in the middle in 2 transmits,
//   so you need a byte level parser to parse messages 

interface EventSourceMessage {
    // web event source api default this to empty string, null should be better for this scenario I guess
    id?: string,
    // web event source api default this to 'message', it is not needed here
    type?: string,
    data: string,
}

// this design also see fine/script/remote-akari.ts BuildScriptMessageParser
class Parser {
    // working buffer
    private chunk: Buffer = Buffer.allocUnsafe(0);
    // working cursor
    private position = 0;
    
    private currentId: string;
    private currentType: string;
    private currentData: string = '';

    public push(newChunk: Buffer) {
        this.chunk = Buffer.concat([this.chunk, newChunk]);
    }
    // pull next message, return undefined if no new message
    public pull(): EventSourceMessage | undefined {
        while (true) {
            // eol begin index and eol end index, same for bare cr and lf, +1 for crlf
            let eolIndex: [number, number] = [-1, -1];
            const crIndex = this.chunk.indexOf(13, this.position);
            const lfIndex = this.chunk.indexOf(10, this.position);
            if (crIndex < 0 && lfIndex < 0) { // line is not completed
                return;
            } else if (crIndex >= 0 && lfIndex < 0) { // bare cr
                // cannot determine bare cr if it is end of existing chunk
                // it's ok to be precise here because I assume this overall branch will never be hit
                if (crIndex == this.chunk.length - 1) {
                    return;
                }
                eolIndex = [crIndex, crIndex];
            } else if (crIndex < 0 && lfIndex >= 0) { // lf
                eolIndex = [lfIndex, lfIndex];
            } else /* crindex >= 0 && lfIndex >= 0 */ if (crIndex + 1 == lfIndex) { // crlf
                eolIndex = [crIndex, lfIndex];
            } else /* crindex >= 0 && lfindex >= 0 and not crlf */ if (crIndex < lfIndex) {
                eolIndex = [crIndex, crIndex];
            } else /* crindex >= 0 and lfindex >= 0 and not crlf and lfindex < crindex */ {
                eolIndex = [lfIndex, lfIndex];
            }

            if (eolIndex[0] == this.position) { // empty line, end of message
                let message: EventSourceMessage;
                if (this.currentData) { // do not dispatch empty data according to spec
                    if (this.currentData.endsWith('\n')) {
                        // trim one end lf according to spec, making data concat effectively .join(\n)
                        this.currentData = this.currentData.substring(0, this.currentData.length - 1);
                    }
                    message = { data: this.currentData };
                    if (this.currentId) { message.id = this.currentId; }
                    if (this.currentType) { message.type = this.currentType; }
                }
                // clear state
                this.currentId = undefined;
                this.currentType = undefined;
                this.currentData = '';
                // discard used buffer
                this.chunk = this.chunk.subarray(eolIndex[1] + 1);
                this.position = 0;
                return message;
            } else {
                const field = this.chunk.toString('utf-8', this.position, eolIndex[0]);
                this.position = eolIndex[1] + 1;
                let name: string;
                let value: string;
                const colonIndex = field.indexOf(':');
                if (colonIndex < 0) {
                    console.log('really no colon in line?');
                    name = field;
                    value = '';
                } else if (colonIndex == 0) { // comment line, ignore
                    continue;
                } else {
                    name = field.substring(0, colonIndex);
                    value = field.substring(colonIndex + 1).trimStart();
                }
                if (name == 'data') {
                    this.currentData += value + '\n';
                } else if (name == 'id') {
                    this.currentId = value;
                } else if (name == 'event') {
                    this.currentType = value;
                } else if (name == 'retry') {
                    console.log(`really retry? value = ${value}`);
                } // ignore other field name
            }
        }
    }
}

interface MessageChunk {
    // chat completion id, same for all chunks, why do you put same value in all chunks?
    id: string,
    // chat completion created time, same for all chunks, why do you put same value in all chunks?
    created: number,
    // input model name, same for all chunks, why do you put same value in all chunks?
    // model: string,
    // same for all chunks, why do you put same value in all chunks?
    // system_fingerprint: string,
    // always chat.completion.chunk, why do you put same constant value in all chunks?
    // object: string,
    choices: {
        // index in choices, choices array seems always 1 and this seems always 0
        index: number,
        // null if not required in parameter, why do you put null in all elements in all chunks?
        // logprobes
        // stop seems normal, length seems max token limitation exceed, why do you put a special 500 insufficient system resource here?
        finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'insufficient_system_resource',
        delta: {
            // content is null if is thinking, reasoning_content is null if completes thinking, why do you put null in all elements in all chunks?
            content: string,
            reasoning_content: string,
            // compare to other null properties, this may not exist? if exist value must be assistant
            role?: string,
            // tool_calls is missing from streaming response type definition in official documents for now,
            // according to https://github.com/Hmbown/CodeWhale/blob/cc0ac498223610e500049cc890f36484ead145b8/src/client.rs#L1906 should have
            tool_calls?: {
                id: string,
                // type: function,
                function: {
                    name: string,
                    // TODO this seems to be arguments json?
                    arguments: string,
                },
            }[],
        },
    }[],
    // now this can jsonb and don't need precise definition if not used
    usage: any,
}

const parser = new Parser();
const reader = response.body.getReader();
while (true) {
    const { done, value } = await reader.read();
    if (value) {
        parser.push(Buffer.from(value));
        let message = parser.pull();
        while (message) {
            console.log(`id: ${message.id}, type: ${message.type}, data: ${message.data}`);
            // this is chunk in another abstraction layer
            let chunk: MessageChunk;
            if (message.data == '[DONE]') {
                console.log('data done');
            } else {
                try {
                    chunk = JSON.parse(message.data);
                } catch {
                    console.error(`failed to parse json?`);
                }
                if (Array.isArray(chunk.choices) && chunk.choices.length > 0 && chunk.choices[0].delta) {
                    if (chunk.choices[0].delta.content) {
                        console.log(`content: ${chunk.choices[0].delta.content}`);
                    } else if (chunk.choices[0].delta.reasoning_content) {
                        console.log(`reasoning: ${chunk.choices[0].delta.reasoning_content}`);
                    } else {
                        console.log('both content and reasoning content is empty?');
                    }
                } else {
                    console.log(`message structure unknown?`);
                }
            }
            message = parser.pull();
        }
    }
    if (done) { break; }
}

// explicit close
// await response.body.cancel();
// or abort signal
// const controller = new AbortController();
// addEventListener('keydown', e => { /* if some condition */ controller.abort(); });
// fetch('https://example.com', { signal: controller.signal });

// const responseData = await response.json() as CompletionAPIResponse;
// const responseOriginalContent = responseData.choices && responseData.choices[0] ? responseData.choices[0].message.content : '(no response)';
// responseReasoningContent = responseData.choices && responseData.choices[0] ? responseData.choices[0].message.reasoning_content : '(no response)';
// responseContent = responseOriginalContent.trim();
    // .replace(/\r?\n\r?\n/g, '\n') // remove empty line
    // .split('\n').map(v => v.trim()).join('\n') // trim each line
    // additional refinements if need
    // .replace(/"([^"]*)"/g, '“$1”') // replace ASCII double quotes with fullwidth quotes
    // .replaceAll('...', '……') // replace ... with full width …
    // .replaceAll('**', '') // remove markdown bold
export {};
