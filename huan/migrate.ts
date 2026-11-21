import fs from 'node:fs/promises';
import npfs from 'node:fs';
import dayjs from 'dayjs';
import { diffLines } from 'diff';
import yaml from 'yaml';

// source#1 was assigned to huan initial test data, but the data schema really changes many times so this batch index is meaningless
// source#2, huan prototype, taiga test data, collect from raw chat completion streaming data, 1 session

function readMySQLCSV<T>(raw: string, map: (fields: string[]) => T): T[] {
    function splitRecords(line: string): string[] {
        const fields: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                current += ch;
                if (ch == '\\' && line[i + 1] == '"') {
                    current += line[i + 1];
                    i++;
                } else if (ch == '"') {
                    inQuotes = false;
                }
            } else {
                if (ch == '"') {
                    inQuotes = true;
                    current += ch;
                } else if (ch == ',') {
                    fields.push(current);
                    current = '';
                } else {
                    current += ch;
                }
            }
        }
        // don't forget last field
        fields.push(current);
        // if (line.startsWith('"36"')) {
        //     console.log(line, fields);
        // }
        return fields;
    }
    // Convert a raw field ("..." or \N) to its string value, or null for NULL.
    function unescape(raw: string): string | null {
        if (raw == '\\N') {
            return null;
        } else if (raw.length >= 2 && raw[0] == '"' && raw[raw.length - 1] == '"') {
            const inner = raw.slice(1, -1);
            let out = '';
            for (let i = 0; i < inner.length; i++) {
                const ch = inner[i];
                if (ch == '"' && inner[i + 1] == '"') {
                    out += '"';
                    i++;
                } else if (ch === '\\' && i + 1 < inner.length) {
                    const next = inner[i + 1];
                    switch (next) {
                        case 'n': out += '\n'; break;
                        case 'r': out += '\r'; break;
                        case 't': out += '\t'; break;
                        case '0': out += '\0'; break;
                        case '\\': out += '\\'; break;
                        case '"': out += '"'; break;
                        default: out += '\\' + next;
                    }
                    i++;
                } else {
                    out += ch;
                }
            }
            return out;
        } else {
            console.log(`field not \\N and not wrapped in double quote? ${raw}`);
            throw "unescape error";
        }
    }

    let recordLine = '';
    const records: T[] = [];
    for (const line of raw.split('\n')) {
        // trailing backslash means record continue at next line, change it to a \n and append to a buffer
        if (line.endsWith('\\')) {
            recordLine += line.slice(0, -1) + '\n';
            continue;
        }
        // don't forget last line
        recordLine += line;
        // ignore empty line
        if (!recordLine) { continue; }

        records.push(map(splitRecords(recordLine).map(unescape)));
        recordLine = '';
    }

    return records;
}

// source#3, mysql-backup-202603 from chatapp2025/theai/yala, about 60 sessions
// reference archive/theai/shapes.xml, src/database.sql, server/index.ts
// does old chat app ever thinking? RESULT: no data in thinking column, but one session have manual thinking formating?
interface Session3 {
    id: number,
    userId: number,
    name: string,
    comment: string,
    createTime: string,
    tags: string,
    shared: boolean,
    shareId: string,
    updateTime: string
}
interface Message3 {
    messageId: number,
    sessionId: number,
    role: string,
    content: string,
    createTime: string,
    inputToken: number,
    outputToken: number,
    parentMessageId: number,
    updateTime: string,
    thinkingContent: string,
}
async function read3(): Promise<[Session3[], Message3[]]> {

    const sessions = readMySQLCSV(await fs.readFile('mysql-backup-20260319-session.csv', 'utf8'), fields => ({
        id: +fields[0],
        userId: +fields[1],
        name: fields[2],
        comment: fields[3],
        createTime: fields[4],
        tags: fields[5],
        shared: fields[6].codePointAt(0) != 0,
        shareId: fields[7],
        updateTime: fields[8],
    } as Session3));

    const sessionIds: number[] = [];
    for (const session of sessions) {
        // console.log(session.name, session.createTime);
        // console.log(JSON.stringify(session));
        if (sessionIds.includes(session.id)) {
            console.log(`duplicate session id ${session.id}`);
        } else {
            sessionIds.push(session.id);
        }
        if (session.userId != 1) {
            console.log(`session ${session.id} user id not 1?`);
        }
        if (!session.name) {
            console.log(`session ${session.id} empty name`);
        }
        // RESULT: many
        if (!session.comment) {
            // console.log(`session ${session.id} empty comment`);
        }
        // RESULT: has data
        if (session.tags) {
            // console.log(`session ${session.id} tags ${session.tags}`);
        }
        // RESULT: has data
        if (session.shared) {
            // console.log(`session ${session.id} shared`);
        }
        if (session.shareId) {
            // console.log(`session ${session.id} share id ${session.shareId}`);
        }
        if (!session.createTime) {
            console.log(`session ${session.id} missing create time`);
        }
        if (!session.updateTime) {
            console.log(`session ${session.id} missing update time`);
        }
        // RESULT: some
        if (session.createTime != session.updateTime) {
            // console.log(`session ${session.id} create time not same as update time, ${session.createTime}, ${session.updateTime}`);
        }
        // don't forget normal datetime format can compare string
        if (session.createTime > session.updateTime) {
            console.log(`session ${session.id} create time > update time?`);
        }
        // RESULT: ok, can use this as new session file name
        if (sessions.some(s => s.id != session.id && s.createTime == session.createTime)) {
            console.log(`session ${session.id} duplicate create time ${session.createTime}`);
        }
        if (session.createTime.length != 19 || session.createTime[4] != '-' || session.createTime[7] != '-' || session.createTime[10] != ' ' || session.createTime[13] != ':' || session.createTime[16] != ':') {
            console.log(`session ${session.id} create time ${session.createTime} unexpected format`);
        }
    }

    const messages = readMySQLCSV(await fs.readFile('mysql-backup-20260319-message.csv', 'utf8'), fields => ({
        messageId: +fields[0],
        sessionId: +fields[1],
        role: fields[2],
        content: fields[3],
        createTime: fields[4],
        inputToken: +fields[5],
        outputToken: +fields[6],
        parentMessageId: +fields[7],
        updateTime: fields[8],
        thinkingContent: fields[9],
    } as Message3));
    for (const message of messages) {
        if (isNaN(message.messageId) || message.messageId <= 0) {
            console.log(`invalid message id ${message.messageId}`);
        }
        if (!sessions.some(s => s.id == message.sessionId)) {
            console.log(`message ${message.messageId} session ${message.sessionId} not found`);
        }
        const messagesOfSession = messages.filter(m => m.sessionId == message.sessionId);
        if (messagesOfSession.filter(m => m.messageId == message.messageId).length > 1) {
            console.log(`session ${message.sessionId} message id ${message.messageId} duplicate`);
        }
        // RESULT: many, old app allows branch system message, which means multiple system messages
        const systemMessages = messagesOfSession.filter(m => m.role == 'system');
        if (systemMessages.length > 1) {
            // console.log(`session ${message.sessionId} system message count > 1`);
        }
        // RESULT: many
        if (message.parentMessageId) {
            // console.log(`session ${message.sessionId} message ${message.messageId} parent message id ${message.parentMessageId}`);
        }
        if (message.parentMessageId && !messagesOfSession.some(m => message.parentMessageId == m.messageId)) {
            console.log(`session ${message.sessionId} message ${message.messageId} parent message id ${message.parentMessageId} not found in ${messagesOfSession.map(m => m.messageId)}`);
        }
        const parentMessage = messagesOfSession.find(m => m.messageId == message.parentMessageId);

        if (!['user', 'assistant', 'system'].includes(message.role)) {
            console.log(`session ${message.sessionId} message ${message.messageId} unexpected role ${message.role}`);
        }
        // RESULT: 1
        // UPDATE: what do you mean by finding the original mysql-backup.tar.xz and extract the message.csv file and this error fixed?
        if (parentMessage && !['assistant-user', 'user-assistant', 'user-system'].includes(`${message.role}-${parentMessage.role}`)) {
            console.log(`session ${message.sessionId} message ${message.messageId} parent message ${message.parentMessageId} unexpected role relationship ${message.role}-${parentMessage.role}`);
        }

        // why do many user message have token count while assistant message don't have token count?
        // 1 seems to be related to data migration error, 2 is because token count is erased after edit
        if (message.role != 'assistant' && (message.inputToken || message.outputToken)) {
            // console.log(`session ${message.sessionId} message ${message.messageId} has token count`);
            // following results are none
            if (message.role != 'user') {
                console.log(`   this message is not user`);
            }
            if (!parentMessage) {
                console.log(`   this message don't have parent message`);
            } else {
                if (parentMessage.role != 'assistant') {
                    console.log(`   parent message is not assistant`);
                }
                if (parentMessage.inputToken || parentMessage.outputToken) {
                    console.log(`   this message parent message have token count`);
                }
            }
        }

        if (message.thinkingContent) {
            console.log(`session ${message.sessionId} message ${message.messageId} has thinking content?`);
        }

        if (!message.createTime) {
            console.log(`session ${message.sessionId} message ${message.messageId} missing create time`);
        }
        if (!message.updateTime) {
            console.log(`session ${message.sessionId} message ${message.messageId} missing update time`);
        }
        // RESULT: some
        if (message.createTime != message.updateTime) {
            // console.log(`session ${message.sessionId} message ${message.messageId} create time not same as update time, ${message.createTime}, ${message.updateTime}`);
        }
        if (message.createTime > message.updateTime) {
            console.log(`session ${message.sessionId} message ${message.messageId} create time > update time?`);
        }
    }
    return [sessions, messages];
}
async function write3(sessions: Session3[], messages: Message3[]) {

    let ok_session_count = 0;
    let ok_message_count = 0;
    let ok_content_length = 0;
    for (const session of sessions) {
        let filename = session.createTime.substring(0, 4) + session.createTime.substring(5, 7)
            + session.createTime.substring(8, 10) + '-' + session.createTime.substring(11, 13)
            + session.createTime.substring(14, 16) + session.createTime.substring(17);
        let b = `name: ${session.name}\n`;
        b += 'metadata:\n';
        b += '  source: chatapp2025/theai/yala\n';
        b += `  source-id: ${session.id}\n`;
        b += `  source-create-time: ${session.createTime}\n`;
        if (session.updateTime != session.createTime) {
        b += `  source-update-time: ${session.updateTime}\n`;
        }
        if (session.comment) {
            if (session.comment.includes('\n')) {
                // you need double quote for this?
                b += `  source-comment: "${session.comment.replace('\n', '\\n')}"\n`;
            } else {
                b += `  source-comment: ${session.comment}\n`;
            }
        }
        if (session.tags) {
            b += `  source-tags: ${session.tags}\n`;
        }
        if (session.shared) {
            b += `  source-shared-flag: ${session.shared ? 1 : 0}\n`;
        }
        if (session.shareId) {
            b += `  source-share-id: ${session.shareId}\n`;
        }
        // console.log(`${filename}\n${b}`);
        for (const message of messages.filter(m => m.sessionId == session.id).sort((m1, m2) => m1.messageId - m2.messageId)) {
            b += '\n';
            b += `${message.role} ${message.messageId}${message.parentMessageId ? `>${message.parentMessageId}` : ''}:\n`;
            // console.log(`${filename} ${message.role} ${message.messageId}${message.parentMessageId ? `>${message.parentMessageId}` : ''}:`);
            if (message.role == 'assistant') {
                b += `  content:\n`;
                b += `  - kind: text\n`;
                b += `    value: |-\n`;
                // RESULT: there is trailing whitespaces
                // no need to preserve them, just trim
                for (const line of message.content.trim().split('\n')) {
                    if (line.trim().length == 0) {
                        b += '\n'
                    } else {
                        b += `      ${line.trimEnd()}\n`;
                    }
                }
                b += '  response:\n';
            } else {
                if (message.content.trim().includes('\n') || message.content.trim().includes(': ')) {
                    b += `  content: |-\n`;
                    for (const line of message.content.trim().split('\n')) {
                        if (line.trim().length == 0) {
                            b += '\n'
                        } else {
                            b += `    ${line.trimEnd()}\n`;
                        }
                    }
                } else if (message.content.trim().startsWith('"')
                    || message.content.trim().startsWith('[')
                    || /^\d+(\.\d+)?$/.test(message.content.trim()))
                {
                    b += `  content: '${message.content.trim()}'\n`;
                } else if (message.content.trim().length == 0) {
                    b += `  content: ''\n`;
                } else {
                    b += `  content: ${message.content.trim()}\n`;
                }
                b += '  metadata:\n';
            }
            b += `    source-create-time: ${message.createTime}\n`;
            if (message.createTime != message.updateTime) {
                b += `    source-update-time: ${message.updateTime}\n`;
            }
            if (message.inputToken) {
                b += `    source-usage-input-token: ${message.inputToken}\n`;
            }
            if (message.outputToken) {
                b += `    source-usage-output-token: ${message.outputToken}\n`;
            }
        }

        const document = yaml.parse(b);
        // const document = yaml.parse(await fs.readFile(`${filename}.yml`, 'utf-8'));

        if (document.name != session.name) {
            console.log(`document ${filename} unexpected name`);
        }
        if (document.metadata.source != 'chatapp2025/theai/yala') {
            console.log(`document ${filename} unexpected source`);
        }
        if (document.metadata['source-id'] != session.id) {
            console.log(`document ${filename} unexpected source id`);
        }
        if (document.metadata['source-create-time'] != session.createTime) {
            console.log(`document ${filename} unexpected source create time`);
        }
        if (session.createTime != session.updateTime && document.metadata['source-update-time'] != session.updateTime) {
            console.log(`document ${filename} unexpected source update time`);
        }
        if (session.comment && document.metadata['source-comment'] != session.comment) {
            console.log(`document ${filename} unexpected source comment`);
        }
        if (session.tags && document.metadata['source-tags'] != session.tags) {
            console.log(`document ${filename} unexpected source tags`);
        }
        if (session.shared && document.metadata['source-shared-flag'] != 1) {
            console.log(`document ${filename} unexpected source shared flag`);
        }
        if (session.shareId && document.metadata['source-share-id'] != session.shareId) {
            console.log(`document ${filename} unexpected source share id`);
        }
        for (const message of messages.filter(m => m.sessionId == session.id).sort((m1, m2) => m1.messageId - m2.messageId)) {
            const key = `${message.role} ${message.messageId}${message.parentMessageId ? `>${message.parentMessageId}` : ''}`;
            if (!document[key]) {
                console.log(`document ${filename} message ${message.messageId} missing`);
            }
            const element = document[key];
            if (message.role == 'assistant') {
                if (element.content[0].kind != 'text') {
                    console.log(`document ${filename} message ${message.messageId} content[0].kind not text`);
                }
                if (element.content[0].value != message.content.trim().split('\n').map(v => v.trimEnd()).join('\n')) {
                    console.log(`document ${filename} message ${message.messageId} content[0].value not same`);
                } else {
                    ok_content_length += element.content[0].value.length;
                }
            } else {
                if (element.content != message.content.trim().split('\n').map(v => v.trimEnd()).join('\n')) {
                    console.log(`document ${filename} message ${message.messageId} content not same`);
                } else {
                    ok_content_length += element.content.length;
                }
            }
            const metadata = message.role == 'assistant' ? element.response : element.metadata;
            if (metadata['source-create-time'] != message.createTime) {
                console.log(`document ${filename} message ${message.messageId} unexpected source create time`);
            }
            if (message.createTime != message.updateTime && metadata['source-update-time'] != message.updateTime) {
                console.log(`document ${filename} message ${message.messageId} unexpected source update time`);
            }
            if (message.inputToken && metadata['source-usage-input-token'] != message.inputToken) {
                console.log(`document ${filename} message ${message.messageId} unexpected source input token`);
            }
            if (message.outputToken && metadata['source-usage-output-token'] != message.outputToken) {
                console.log(`document ${filename} message ${message.messageId} unexpected source output token`);
            }
            ok_message_count += 1; // run to here does not imply ok, but lazy to add a lot of else clause
        }
        ok_session_count += 1; // run to here does not imply ok, but lazy to add a lot of else clause

        // console.log(`write ${filename}.yml`);
        // await fs.writeFile(`${filename}.yml`, b);
    }
    console.log(ok_session_count, ok_message_count, ok_content_length);
}
// const session3s = await read3();

// TODO validate source3 against chatapp2025-backup-*.sql files
function readalt34() {
}

// source#4, deepseek chat app old data migration, it is collected from f12 api not nowadays formal export function, 543 sessions
// reference archive/theai/shapes.xml, theai/migrate.ts
interface Message4File {
    id: string, // `file-${GUID}`
    status: 'SUCCESS', // according to current few records, only this
    file_name: string,
    file_size: number,
    token_usage: number,
    error_code: null,
    inserted_at: number,
    updated_at: number,
}
interface Message4Result {
    url: string,
    title: string,
    snippet: string,
    cite_index: number | null, // this is simply local cite index, use like [citation:8]
    published_at: number | null,
    site_name: string,
    site_icon: string, // url
}
// confirmed by current records that all property available in all objects
interface Session4Info {
    id: string, // guid string
    seq_id: number,
    agent: 'chat', // type confirmed by current records
    character: null, // type confirmed by current records
    title: string | null, // note deepseek website don't forbid you from make title empty, this result in title: null
    title_type: 'SYSTEM' | 'USER', // type confirmed by current records
    // this looks like current_message_id or current_message_id+1, but there are still exceptions, so unkown
    version: number,
    current_message_id: number, // this is same as max message id
    inserted_at: number, // timestamp number
    updated_at: number, // timestamp number
}
interface Message4 {
    // according to inspection, despite this id is inside session,
    // the message_id-parent_id tree structure is same as my design
    message_id: number,
    parent_id: number,
    model: '', // type confirmed by current records
    role: 'USER' | 'ASSISTANT',
    content: string,
    // if thinking_enabled is true
    //    if role is USER, thinking_content and thinking_elapsed_secs is null
    //    if role is ASSISTANT, thinking_content and thinking_elapsed_secs maybe empty string or null
    thinking_enabled: boolean,
    thinking_content: string | null,
    thinking_elapsed_secs: number | null,
    // according to current records,
    // !ban_edit && ban_regenerate is content is harmonized
    // ban_edit && ban_regenerate is same as thinking_enabled, include role=USER and role=ASSISTANT
    ban_edit: boolean,
    ban_regenerate: boolean,
    // incomplete seems like user stop
    // content filter is harmonize
    status: 'FINISHED' | 'INCOMPLETE' | 'CONTENT_FILTER', // type confirmed by current records
    // this is available on both user and assistant message,
    // with loss on prompt+completion information, but with gain on user/assistant difference
    // according to current records, this is always available (not null)
    accumulated_token_usage: number,
    // according to current records, will not be null
    // https://chat.deepseek.com/api/v0/file/preview?file_id=${id}
    // get a responseData.data.biz_data.url to download file, this result url has access key and should be short lived
    files: Message4File[],
    // according to current records, will not be null
    // no record in current records, type still unknown
    // but you can see tips on website and website http request have tips in response, which have this type
    // but this is not important so ok
    tips: { content: string, position: string, type: string }[],
    // type confirmed by current records
    tip_content_risk?: { tip_type: 'CONTENT_RISK', tip_params: { category: 'general' | 'legal' } },
    inserted_at: number, // timestamp number
    search_enabled: boolean,
    // type confirmed by current records
    // can still be null when saerch_enabled
    search_status: 'FINISHED' | 'ANSWER' | 'INIT' | null,
    search_results: Message4Result[] | null,
}
interface Session4 {
    chat_session: Session4Info,
    chat_messages: Message4[],
    cache_valid: false, // type confirmed by current records
    route_id: null, // type confirmed by current records
}

async function read4(): Promise<Session4[]> {
    const sessions = JSON.parse(await fs.readFile('deepseek-extract-20250709.json', 'utf-8')) as Session4[];

    console.log(sessions.length,
        sessions.reduce((acc, s) => acc + s.chat_messages.length, 0),
        sessions.reduce((acc, s) => acc + s.chat_messages.reduce((acc, m) => acc
            + Buffer.from(m.content).length + (m.thinking_content ? Buffer.from(m.thinking_content).length : 0), 0), 0));

    const validateResult: string[] = [];
    if (new Set(sessions.map(s => s.chat_session.id)).size != sessions.length) {
        validateResult.push(`duplicate session id`);
    }
    if (new Set(sessions.map(s => s.chat_session.seq_id)).size != sessions.length) {
        validateResult.push(`duplicate session seq_id`);
    }
    for (const session of sessions) {
        if (!session.chat_session || typeof session.chat_session != 'object') {
            validateResult.push('session missing chat_session?'); continue;
        }
        const info = session.chat_session;

        const infoPropertyNames = Object.keys(info).sort((a, b) => a.localeCompare(b));
        const expectedPropertyNames = ['id', 'seq_id', 'agent', 'character',
            'title', 'title_type', 'version', 'current_message_id', 'inserted_at', 'updated_at'].sort((a, b) => a.localeCompare(b));
        if (infoPropertyNames.length != expectedPropertyNames.length || infoPropertyNames.some((n, i) => expectedPropertyNames[i] != n)) {
            validateResult.push(`session ${info.seq_id} property name mismatch ${infoPropertyNames}`);
        }

        if (typeof info.id != 'string') {
            validateResult.push(`session ${info.seq_id} id is not string`);
        }
        if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(info.id)) {
            validateResult.push(`session ${info.seq_id} id not in guid format`);
        }
        if (typeof info.seq_id != 'number') {
            validateResult.push(`session ${info.seq_id} seq_id is not number`);
        }
        // RESULT: 1
        if (typeof info.title != 'string') {
            validateResult.push(`session ${info.seq_id} missing title`);
        }
        if (typeof info.inserted_at != 'number' || typeof info.updated_at != 'number') {
            validateResult.push(`session ${info.seq_id} inserted_at or updated_at is not number`);
        }
        // // this take very long time, nearly 1 second for 500x500 times of dayjs.unix invocation, comment after validation completed
        // const duplicateTimes = sessions.filter(s => s.chat_session.id != info.id
        //     && dayjs.unix(s.chat_session.inserted_at).format('YYYYMMDD-HHmmss') == dayjs.unix(info.inserted_at).format('YYYYMMDD-HHmmss'));
        // if (duplicateTimes.length) {
        //     validateResult.push(`session ${info.seq_id} time duplicate at second level`);
        // }

        if (session.chat_messages.length && !session.chat_messages.some(m => info.current_message_id == m.message_id)) {
            validateResult.push(`session ${info.seq_id} current_message_id not found`);
        }
        if (info.agent != 'chat') {
            validateResult.push(`session ${info.seq_id} agent not chat`);
        }
        if (info.character) {
            validateResult.push(`session ${info.seq_id} character not null`);
        }
        if (info.title_type != 'USER' && info.title_type != 'SYSTEM') {
            validateResult.push(`session ${info.seq_id} title_type not user or system`);
        }

        if (!Array.isArray(session.chat_messages)) {
            validateResult.push(`session ${info.seq_id} chat_messages is not array`);
        } else {
            for (const message of session.chat_messages) {
                if (!message.message_id || typeof message.message_id != 'number') {
                    validateResult.push(`session ${info.seq_id} message missing message_id`);
                    // but continue to following validations
                }
                // tip_content_risk is optional and not important, so directly exclude here
                const messagePropertyNames = Object.keys(message).filter(p => p != 'tip_content_risk').sort((a, b) => a.localeCompare(b));
                const expectedPropertyNames = [
                    'message_id', 'parent_id', 'model', 'role', 'content', 'thinking_enabled', 'thinking_content', 'thinking_elapsed_secs',
                    'ban_edit', 'ban_regenerate', 'status', 'accumulated_token_usage', 'files', 'tips', 'inserted_at', 'search_enabled', 'search_status', 'search_results',
                ].sort((a, b) => a.localeCompare(b));
                if (messagePropertyNames.length != expectedPropertyNames.length || messagePropertyNames.some((n, i) => expectedPropertyNames[i] != n)) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} property name mismatch`);
                }

                if (message.model.length != 0) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} model is not empty string`);
                }
                if (message.parent_id && typeof message.parent_id != 'number') {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} invalid parent_id`);
                }
                if (message.parent_id && !session.chat_messages.some(m => m.message_id == message.parent_id)) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} parent_id not found`);
                } else if (message.parent_id) {
                    const parentMessage = session.chat_messages.find(m => m.message_id == message.parent_id);
                    // no system message in these data
                    if (!['USER-ASSISTANT', 'ASSISTANT-USER'].includes(`${message.role}-${parentMessage!.role}`)) {
                        validateResult.push(`session ${info.seq_id} message ${message.message_id} unexpected role relationship`);
                    }
                }
                if (message.role != 'USER' && message.role != 'ASSISTANT') {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} invalid role`);
                }
                // RESULT: very many
                if (message.content.includes(' \n')) {
                    // validateResult.push(`session ${info.seq_id} message ${message.message_id} contains trailing whitespaces by the way`);
                }
                if (message.role == 'USER' && message.thinking_content) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} user should not have thinking_content`);
                }
                // RESULT: a few, regard them as not thinking
                if (message.role == 'ASSISTANT' && message.thinking_enabled && typeof message.thinking_content != 'string') {
                    // validateResult.push(`session ${info.seq_id} message ${message.message_id} thinking_content is not string`);
                }
                if (message.role == 'ASSISTANT' && message.thinking_content && !message.thinking_enabled) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} thinking switch mismatch`);
                }
                // RESULT: some, more than thinking_enabled and thinking_content mismatch, it's ok because this is only additional information
                if (message.role == 'ASSISTANT' && message.thinking_enabled && typeof message.thinking_elapsed_secs != 'number') {
                    // validateResult.push(`session ${info.seq_id} message ${message.message_id} thinking_elapsed_secs is not number`);
                }
            
                // RESULT: many
                if (message.ban_edit || message.ban_regenerate) {
                    // validateResult.push(`session ${info.seq_id} message ${message.message_id} ban_edit or ban_regenerate`);
                }
                if ((message.ban_edit && message.ban_regenerate) != message.thinking_enabled) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} what's this relationship?`);
                }
                // RESULT: 1 message, same as missing title, also this message session id is not in later sql backup data
                //         so the answer is this session is banned at first message and discarded and not collected into my database
                if (!message.thinking_enabled && (message.ban_edit || message.ban_regenerate)) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} ban_edit or ban_regenerate, ${message.ban_edit}, ${message.ban_regenerate}`);
                }
            
                if (message.status != 'FINISHED' && message.status != 'INCOMPLETE' && message.status != 'CONTENT_FILTER') {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} invalid status`);
                }
                if (typeof message.accumulated_token_usage != 'number') {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} accumulated_token_usage is not number`);
                }
                if (typeof message.inserted_at != 'number') {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} inserted_at is not number`);
                }

                if (!Array.isArray(message.tips)) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} tips is not array`);
                }
                if (message.tips.length) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} tips not empty`);
                }
                if (message.tip_content_risk && typeof message.tip_content_risk != 'object') {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} tip_content_risk is not object`);
                }
                if (message.tip_content_risk && message.tip_content_risk.tip_type != 'CONTENT_RISK') {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} tip_content_risk.tip_type is not CONTENT_RISK`);
                }
                if (message.tip_content_risk && (message.tip_content_risk.tip_params.category != 'general' && message.tip_content_risk.tip_params.category != 'legal')) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} tip_content_risk.tip_params.category is not general or legal`);
                }

                if (!Array.isArray(message.files)) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} files is not array`);
                }
                // total 3 files, nowadays deepseek have official file api, I'm afraid this old file record is not available
                // const response = await fetch(`https://chat.deepseek.com/api/v0/file/preview?file_id=file-*`, {
                //     headers: { 'authorization': '*' },
                // });
                // const data = await response.json();
                // console.log(data);
                // UPDATE yes file not found
                // if (message.files.length) { console.log(info.id, message.files); }
                // also, can open these sessions in current web app, as currently web app disables file upload, these files cannot be downloaded
                // but all of these files are not important, so will not try to access them, but record for fun

                // RESULT: very many mismatch, no relationship between enabled and data
                if (!message.search_enabled && message.search_status) {
                    // validateResult.push(`session ${info.seq_id} message ${message.message_id} search enabled mismatch, ${message.search_enabled}, ${message.search_status}`);
                }
                if (!message.search_enabled && message.search_results) {
                    // validateResult.push(`session ${info.seq_id} message ${message.message_id} search enabled mismatch (2), ${message.search_enabled}, ${JSON.stringify(message.search_results).substring(0, 100)}`);
                }
                if (message.search_enabled) {
                    if (!message.search_status) {
                        // validateResult.push(`session ${info.seq_id} message ${message.message_id} search enabled mismatch (3), ${message.search_enabled}, ${message.search_status}`);
                    }
                    if (!Array.isArray(message.search_results)) {
                        // validateResult.push(`session ${info.seq_id} message ${message.message_id} search enabled mismatch (4), ${message.search_enabled}, ${JSON.stringify(message.search_results).substring(0, 100)}`);
                    }
                }
                
                if (message.search_status && !['FINISHED', 'ANSWER', 'INIT'].includes(message.search_status)) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} unknown search status`);
                }
                if (message.search_results && !Array.isArray(message.search_results)) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} search results is not array`);
                }
                if (message.search_results) {
                    for (const search_result of message.search_results) {
                        // the struct is similar to nowadays deepseek formal web search api result
                        // console.log(JSON.stringify(search_result));
                    }
                }
            }
        }
    }
    validateResult.forEach(v => console.log(v));
    return sessions;
}
async function write4(sessions: Session4[]) {

    let sessionIndex = 0;
    // rv: reverse validation
    let rvSessionCount = 0;
    let rvMessageCount = 0;
    let rvBlockCount = 0;
    let onlyThisDifferenceCount = 0;

    for (const session of sessions) {
        const info = session.chat_session;
        const filename = dayjs.unix(info.inserted_at).format('YYYYMMDD-HHmmss');
        let b = '';
        // oh, title can have colon
        if (!info.title) {
            b += `name: (no title)\n`;
        } else {
            b += `name: ${info.title.includes(': ') ? "'" : ''}${info.title.trim()}${info.title.includes(': ') ? "'" : ''}\n`;
        }
        b += `metadata:\n`;
        b += `  source: deepseek-extract-2025\n`;
        b += `  source-id: ${info.id}\n`;
        b += `  source-seq-id: ${info.seq_id}\n`;
        b += `  source-title-type: ${info.title_type}\n`;
        b += `  source-version: ${info.version}\n`;
        b += `  source-current-message-id: ${info.current_message_id}\n`;
        b += `  source-create-time: ${dayjs.unix(info.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]')}\n`;
        if (info.inserted_at != info.updated_at) {
            b += `  source-update-time: ${dayjs.unix(info.updated_at).format('YYYY-MM-DDTHH:mm:ss[Z]')}\n`;
        }
        for (const message of session.chat_messages) {
            b += '\n';
            b += `${message.role.toLowerCase()} ${message.message_id}${message.parent_id ? `>${message.parent_id}` : ''}:\n`;
            if (message.role == 'ASSISTANT') {
                b += `  content:\n`;
                if (message.thinking_content) {
                    b += `  - kind: think\n`;
                    b += `    value: |-\n`;
                    for (const line of message.thinking_content.trim().split('\n')) {
                        if (line.trim().length == 0) {
                            b += '\n'
                        } else {
                            b += `      ${line.trimEnd()}\n`;
                        }
                    }
                    b += `    signature: ''\n`;
                }
                b += `  - kind: text\n`;
                b += `    value: |-\n`;
                for (const line of message.content.trim().split('\n')) {
                    if (line.trim().length == 0) {
                        b += '\n'
                    } else {
                        b += `      ${line.trimEnd()}\n`;
                    }
                }
                b += '  response:\n';
            } else {
                if (message.content.trim().includes('\n')
                    || message.content.trim().includes(': ')
                    || message.content.trim().startsWith('"')
                ) {
                    b += `  content: |-\n`;
                    for (const line of message.content.trim().split('\n')) {
                        if (line.trim().length == 0) {
                            b += '\n'
                        } else {
                            b += `    ${line.trimEnd()}\n`;
                        }
                    }
                } else if (
                    message.content.trim().includes(' #')
                ) {
                    b += `  content: '${message.content.trim()}'\n`;
                } else {
                    b += `  content: ${message.content.trim()}\n`;
                }
                b += '  metadata:\n';
            }
            b += `    status: ${message.status}\n`;
            b += `    create-time: ${dayjs.unix(message.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]')}\n`;
            if (message.thinking_enabled) {
                b += `    thinking-enabled: true\n`;
            }
            if (message.thinking_elapsed_secs) {
                b += `    thinking-elapsed-seconds: ${message.thinking_elapsed_secs}\n`;
            }
            if (!message.thinking_content && (message.ban_edit && message.ban_regenerate)) {
                b += `    ban-edit-regenerate: [${message.ban_edit}, ${message.ban_regenerate}]\n`;
            }
            if (message.accumulated_token_usage) {
                b += `    accumulated-token-usage: ${message.accumulated_token_usage}\n`;
            }
            if (message.tip_content_risk) {
                b += `    tip-content-risk-category: ${message.tip_content_risk.tip_params.category}\n`;
            }
            if (message.files.length) {
                b += `    files:\n`;
            }
            for (const file of message.files) {
                // console.log(file);
                b += `    - id: ${file.id}\n`;
                b += `      status: ${file.status}\n`;
                b += `      file-name: ${file.file_name}\n`;
                b += `      file-size: ${file.file_size}\n`;
                b += `      token-usage: ${file.token_usage}\n`;
                b += `      create-time: ${dayjs.unix(file.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]')}\n`;
                if (file.inserted_at != file.updated_at) {
                    b += `      update-time: ${dayjs.unix(file.updated_at).format('YYYY-MM-DDTHH:mm:ss[Z]')}\n`;
                }
            }
            if (message.search_enabled) {
                b += `    search-enabled: true\n`;
            }
            if (message.search_status) {
                b += `    search-status: ${message.search_status}\n`;
            }
            if (message.search_results) {
                b += `    search-results:\n`;
                for (const search_result of message.search_results) {
                    // console.log(search_result);
                    b += `    - url: ${search_result.url}\n`;
                    if (search_result.title.trim().startsWith('[')
                        || search_result.title.trim().includes(': ')
                        || search_result.title.trim().startsWith('"')
                        || search_result.title.trim().startsWith('#')
                        || search_result.title.trim().includes(' #')
                    ) {
                        if (search_result.title.trim().includes("'")) {
                            b += `      title: "${search_result.title.trim()}"\n`;
                        } else {
                            b += `      title: '${search_result.title.trim()}'\n`;
                        }
                    } else {
                        b += `      title: ${search_result.title.trim()}\n`;
                    }              
                    if (search_result.snippet.trim().includes('\n')
                        || search_result.snippet.trim().startsWith('#')
                        || search_result.snippet.trim().startsWith('@')
                        || search_result.snippet.trim().startsWith('[')
                        || search_result.snippet.trim().startsWith('|')
                        || search_result.snippet.trim().startsWith('- ')
                        || search_result.snippet.trim().includes(': ')
                        || search_result.snippet.trim().endsWith(':')
                        || search_result.snippet.trim().includes(' #')
                    ) {
                        if (search_result.snippet.includes('"') && search_result.snippet.includes("'")) {
                            b += `      snippet: |-\n`;
                            for (const line of search_result.snippet.trim().split('\n')) {
                                if (line.trim().length == 0) {
                                    b += '\n'
                                } else {
                                    b += `        ${line.trimEnd()}\n`;
                                }
                            }
                        } else if (search_result.snippet.includes("'")) {
                            b += `      snippet: "${search_result.snippet.trim()}"\n`;
                        } else {
                            b += `      snippet: '${search_result.snippet.trim()}'\n`;
                        }
                    } else {
                        b += `      snippet: ${search_result.snippet.trim()}\n`;
                    }

                    if (search_result.cite_index) {
                        b += `      cite-index: ${search_result.cite_index}\n`;
                    }
                    if (search_result.published_at) {
                        b += `      publish-time: ${dayjs.unix(search_result.published_at).format('YYYY-MM-DDTHH:mm:ss[Z]')}\n`;
                    }
                    // site_name ?? '(empty)' and site_name || '(empty)' differs for empty string
                    b += `      site-name: ${search_result.site_name || '(empty)'}\n`;
                    b += `      site-icon: ${search_result.site_icon}\n`;
                }
            }
        }

        // if (sessionIndex <= 600 && sessionIndex > 400) {
        // await fs.writeFile(`${filename}.yml`, b);
        // }
        sessionIndex += 1;

        // const document = yaml.parse(b);
        const currentContent = await fs.readFile(`${filename}.yml`, 'utf-8');
        const document = yaml.parse(currentContent);

        // temporary for fix message create time error
        let hasDifference = false;

        if (document.name != (info.title?.trim() ?? '(no title)')) {
            console.log(`session ${filename} unexpected name`);
        }
        if (document.metadata['source'] != 'deepseek-extract-2025') {
            console.log(`session ${filename} unexpected source`);
        }
        if (document.metadata['source-id'] != info.id) {
            console.log(`session ${filename} unexpected source id`);
        }
        if (document.metadata['source-seq-id'] != info.seq_id) {
            console.log(`session ${filename} unexpected source seq id`);
        }
        if (document.metadata['source-title-type'] != info.title_type) {
            console.log(`session ${filename} unexpected source title type`);
        }
        if (document.metadata['source-version'] != info.version) {
            console.log(`session ${filename} unexpected source version`);
        }
        if (document.metadata['source-current-message-id'] != info.current_message_id) {
            console.log(`session ${filename} unexpected source current message id`);
        }
        if (document.metadata['source-create-time'] != dayjs.unix(info.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]')) {
            console.log(`session ${filename} unexpected source create time`);
        }
        if (info.inserted_at != info.updated_at
            && document.metadata['source-update-time'] != dayjs.unix(info.updated_at).format('YYYY-MM-DDTHH:mm:ss[Z]')
        ) {
            console.log(`session ${filename} unexpected source update time`);
        }
        for (const message of session.chat_messages) {
            const key = `${message.role.toLowerCase()} ${message.message_id}${message.parent_id ? `>${message.parent_id}` : ''}`;
            const element = document[key];
            if (!element) {
                console.log(`document ${filename} message ${message.message_id} missing`);
            }
            if (message.role == 'ASSISTANT') {
                if (message.thinking_content) {
                    if (element.content[0].kind != 'think') {
                        console.log(`document ${filename} message ${message.message_id} content[0].kind not think`);
                    }
                    if (element.content[0].value != message.thinking_content.trim().split('\n').map(v => v.trimEnd()).join('\n')) {
                        console.log(`document ${filename} message ${message.message_id} content[0].value not same`);
                    } else {
                        rvBlockCount += 1;
                    }
                    if (element.content[1].kind != 'text') {
                        console.log(`document ${filename} message ${message.message_id} content[1].kind not text`);
                    }
                    if (element.content[1].value != message.content.trim().split('\n').map(v => v.trimEnd()).join('\n')) {
                        console.log(`document ${filename} message ${message.message_id} content[1].value not same`);
                    } else {
                        rvBlockCount += 1;
                    }
                } else {
                    if (element.content[0].kind != 'text') {
                        console.log(`document ${filename} message ${message.message_id} content[0].kind not text`);
                    }
                    if (element.content[0].value != message.content.trim().split('\n').map(v => v.trimEnd()).join('\n')) {
                        console.log(`document ${filename} message ${message.message_id} content[0].value not same`);
                    } else {
                        rvBlockCount += 1;
                    }
                }
            } else {
                if (element.content != message.content.trim().split('\n').map(v => v.trimEnd()).join('\n')) {
                    console.log(`document ${filename} message ${message.message_id} content not same`);
                } else {
                    rvBlockCount += 1;
                }
            }
            const metadata = message.role == 'ASSISTANT' ? element.response : element.metadata;
            if (metadata.status != message.status) {
                console.log(`document ${filename} message ${message.message_id} status not same`);
            }
            if (metadata['create-time'] != dayjs.unix(message.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]')) {
                hasDifference = true;
                console.log(`document ${filename} message ${message.message_id} create time not same`);
            }
            if (message.thinking_enabled && !metadata['thinking-enabled']) {
                console.log(`document ${filename} message ${message.message_id} thinking enabled not same`);
            }
            if (message.thinking_elapsed_secs && metadata['thinking-elapsed-seconds'] != message.thinking_elapsed_secs) {
                console.log(`document ${filename} message ${message.message_id} thinking elapsed seconds not same`);
            }
            if (!message.thinking_content && (message.ban_edit && message.ban_regenerate)
                && (metadata['ban-edit-regenerate'][0] != message.ban_edit || metadata['ban-edit-regenerate'][1] != message.ban_regenerate)
            ) {
                console.log(`document ${filename} message ${message.message_id} ban edit regenerate not same`);
            }
            if (message.accumulated_token_usage && metadata['accumulated-token-usage'] != message.accumulated_token_usage) {
                console.log(`document ${filename} message ${message.message_id} accumulated token usage not same`);
            }
            if (message.tip_content_risk && metadata['tip-content-risk-category'] != message.tip_content_risk.tip_params.category) {
                console.log(`document ${filename} message ${message.message_id} tip content risk category not same`);
            }
            if (message.files) {
                for (const [file, fileIndex] of message.files.map((f, i) => [f, i] as const)) {
                    const element = metadata.files[fileIndex];
                    if (file.id != element.id) {
                        console.log(`document ${filename} message ${message.message_id} file ${fileIndex} id not same`);
                    }
                    if (file.status != element.status) {
                        console.log(`document ${filename} message ${message.message_id} file ${fileIndex} status not same`);
                    }
                    if (file.file_name != element['file-name']) {
                        console.log(`document ${filename} message ${message.message_id} file ${fileIndex} file name not same`);
                    }
                    if (file.file_size != element['file-size']) {
                        console.log(`document ${filename} message ${message.message_id} file ${fileIndex} file size not same`);
                    }
                    if (file.token_usage != element['token-usage']) {
                        console.log(`document ${filename} message ${message.message_id} file ${fileIndex} token usage not same`);
                    }
                    if (dayjs.unix(file.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]') != element['create-time']) {
                        console.log(`document ${filename} message ${message.message_id} file ${fileIndex} create time not same`);
                    }
                    if (file.inserted_at != file.updated_at && dayjs.unix(file.updated_at).format('YYYY-MM-DDTHH:mm:ss[Z]') != element['update-time']) {
                        console.log(`document ${filename} message ${message.message_id} file ${fileIndex} update time not same`);
                    }
                }
            }
            if (message.search_results) {
                for (const [result, resultIndex] of message.search_results.map((f, i) => [f, i] as const)) {
                    const element = metadata['search-results'][resultIndex];
                    if (result.url != element.url) {
                        console.log(`document ${filename} message ${message.message_id} result ${resultIndex} url not same`);
                    }
                    if (result.title.trim() != element.title) {
                        console.log(`document ${filename} message ${message.message_id} result ${resultIndex} title not same`);
                    }
                    if (result.snippet.trim().split('\n').map(v => v.trimEnd()).join('\n') != element.snippet) {
                        console.log(`document ${filename} message ${message.message_id} result ${resultIndex} snippet not same\n${element.snippet}\n${result.snippet.trim().split('\n').map(v => v.trimEnd()).join('\n')}`);
                    }
                    if (result.cite_index && result.cite_index != element['cite-index']) {
                        console.log(`document ${filename} message ${message.message_id} result ${resultIndex} cite index not same`);
                    }
                    if (result.published_at && dayjs.unix(result.published_at).format('YYYY-MM-DDTHH:mm:ss[Z]') != element['publish-time']) {
                        console.log(`document ${filename} message ${message.message_id} result ${resultIndex} publish time not same`);
                    }
                    if ((result.site_name || '(empty)') != element['site-name']) {
                        console.log(`document ${filename} message ${message.message_id} result ${resultIndex} site name not same`);
                    }
                    if (result.site_icon != element['site-icon']) {
                        console.log(`document ${filename} message ${message.message_id} result ${resultIndex} site icon not same`);
                    }
                }
            }
            rvMessageCount += 1;
        }
        rvSessionCount += 1;
        if (hasDifference) {  
            const changes = diffLines(currentContent, b);
            if (changes.some(c => (c.added || c.removed) && !c.value.trim().startsWith('create-time'))) {
                console.log(`has difference, and is not about create time`, changes);
            } else {
                onlyThisDifferenceCount += 1;
            }
        }
    }
    console.log(rvSessionCount, rvMessageCount, rvBlockCount, onlyThisDifferenceCount);
}
// const session4s = await read4();
// await write4(session4s);

// you need a name to differ from other types, so use True for true source
type TrueContentBlock =
    // active flag is not related to this script
    | { kind: 'text', value: string, name?: string }
    | { kind: 'think', value: string, signature: string }
    // tool use is not related to this script, just declare a kind
    | { kind: 'tool-use' }
    | { kind: 'tool-result' }
interface TrueMessage {
    role: 'system' | 'user' | 'assistant',
    id: number,
    parentId: number, // 0 for no parent id
    content: TrueContentBlock[],
    metadata?: Record<string, any>,
    response?: Record<string, any>,
    // request config is not related to this script
}
interface TrueSession {
    filename: string, // manually include a filename for easy id and navigation
    name: string,
    messages: TrueMessage[],
    metadata: Record<string, any>,
}
async function readtrue(): Promise<TrueSession[]> {

    const sessions: TrueSession[] = await Promise.all((await fs.readdir('.')).map(async filename => {
        const session = yaml.parse(await fs.readFile(`${filename}`, 'utf-8'));
        const messages: TrueMessage[] = [];
        for (const key of Object.keys(session)) {
            if (key.startsWith('user ')) {
                messages.push({
                    role: 'user',
                    id: +key.substring(5).split('>')[0],
                    parentId: key.includes('>') ? +key.substring(5).split('>')[1] : 0,
                    ...session[key],
                });
            } else if (key.startsWith('assistant ')) {
                messages.push({
                    role: 'assistant',
                    id: +key.substring(10).split('>')[0],
                    parentId: key.includes('>') ? +key.substring(10).split('>')[1] : 0,
                    ...session[key],
                });
            } else if (key.startsWith('system ')) {
                messages.push({
                    role: 'system',
                    id: +key.substring(7).split('>')[0],
                    parentId: key.includes('>') ? +key.substring(7).split('>')[1] : 0,
                    ...session[key],
                });
            }
        }
        return { filename: filename.split('.')[0], name: session.name, messages, metadata: session.metadata };
    }));
    for (const session of sessions) {
        // console.log(session.filename, session.name, session.messages.length, JSON.stringify(session.metadata));
        for (const message of session.messages) {
            // don't forget content in truemessage can be string
            if (typeof message.content == 'string') {
                message.content = [{ kind: 'text', value: message.content }];
            }
        }
    }
    return sessions;
}
const truesessions = await readtrue();

interface Session5 {
    id: string,
    title: string,
    inserted_at: string, // this use iso8601
    updated_at: string, // this use iso8601
    mapping: Record<string, Message5AndId>,
}
interface Message5AndId {
    id: string,
    parent: string,
    children: string[],
    message: Message5,
}
interface Message5 {
    model: string,
    inserted_at: string,
    fragments: Fragment5[],
}
type Fragment5 =
    | { type: 'REQUEST', content: string }
    | { type: 'RESPONSE', content: string }
    | { type: 'THINK', content: string }
    | { type: 'FILE', files: { file_id: string, file_name: string, file_size: string }[] }
    | { type: 'SEARCH', results: { url: string, title: string }[] }

// source#5, deepseek chat app data migration, from formal export function, 1990 sessions (include 543 existing sessions)
// TODO s5 will be rerun with same or larger dataset and same or slightly changed data schema

async function read5(): Promise<Session5[]> {
    const sessions = JSON.parse(await fs.readFile('deepseek-export-20261105.json', 'utf-8')) as Session5[];

    let sessionCount = 0;
    let existingSessionCount = 0;
    let messageCount = 0;
    let blockCount = 0;
    let diffCount = 0;
    for (const [session, sessionIndex] of sessions.map((s, i) => [s, i] as const)) {
        if (typeof session.id != 'string') {
            console.log(`session ${session.id}: but id is not string?`);
        }
        if (sessions.filter(s => s.id == session.id).length > 1) {
            console.log(`session ${session.id}: duplicate id`);
        }
        sessionCount += 1;
        const truesession = truesessions.find(s => s.metadata?.source == 'deepseek-extract-2025' && s.metadata['source-id'] == session.id);
        if (truesession) {
            existingSessionCount += 1;
        }

        if (typeof session.title != 'string') {
            console.log(`session ${session.id}: title is not string`);
        }
        if (!session.title.length) {
            // RESULT: the same session that is content filtered
            console.log(`session ${session.id}: title is empty`);
        } else if (truesession && session.title.trim() != truesession.name.trim()) {
            console.log(`session ${truesession.filename}: name not same, ${session.title}, ${truesession.name}`);
        }
        
        if (!session.inserted_at) {
            console.log(`session ${session.id}: create time is empty`);
        }
        const createTime = dayjs(session.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]');
        if (truesession && truesession.metadata['source-create-time'] != createTime) {
            console.log(`session ${truesession.filename}: create time not same, ${createTime}, ${truesession.metadata['source-create-time']}`);
        }

        if (!session.updated_at) {
            console.log(`session ${session.id}: update time is empty`);
        }
        const updateTime = dayjs(session.updated_at).format('YYYY-MM-DDTHH:mm:ss[Z]');
        // ATTENTION one mismatch at 20250708 which is exactly
        // 1. chatapp2025 starts developing, 2. deepseek webapp data is extracted, 3. new message append to this session exactly talking about developing of chatapp2025
        if (truesession && (truesession.metadata['source-update-time'] || truesession.metadata['source-create-time']) != updateTime) {
            console.log(`session ${truesession.filename}: update time not same, ${updateTime}, ${truesession.metadata['source-update-time'] || truesession.metadata['source-create-time']}`);
        }

        const actualPropertyNames = Object.keys(session).sort((a, b) => a.localeCompare(b));
        const expectedPropertyNames = ['id', 'title', 'inserted_at', 'updated_at', 'mapping'].sort((a, b) => a.localeCompare(b));
        if (actualPropertyNames.length != expectedPropertyNames.length || actualPropertyNames.some((n, i) => expectedPropertyNames[i] != n)) {
            console.log(`session ${session.id} property name mismatch ${actualPropertyNames}`);
        }

        if (!session.mapping) {
            console.log(`session ${session.id}: missing mapping`);
        }
        let hasRoot = false;
        for (const [messageId, messageAndId] of Object.entries(session.mapping)) {
            if (typeof messageId != 'string') {
                console.log(`session ${session.id} message ${messageId}: but message id is not string?`);
            }
            if (messageAndId.id != messageId) {
                console.log(`session ${session.id} message ${messageId}: key and body id not same?`);
            }
            if (!Array.isArray(messageAndId.children)) {
                console.log(`session ${session.id} message ${messageId}: children not array`);
            }
            if (messageAndId.parent && !Object.keys(session.mapping).includes(messageAndId.parent)) {
                console.log(`session ${session.id} message ${messageId}: parent id not found`);
            }
            const expectChildren = Object.entries(session.mapping).filter(m => m[1].parent == messageId).map(m => m[0]).sort((a, b) => a.localeCompare(b));
            const actualChildren = [...messageAndId.children].sort((a, b) => a.localeCompare(b));
            if (expectChildren.length != actualChildren.length || actualChildren.some((n, i) => expectChildren[i] != n)) {
                console.log(`session ${session.id} message ${messageId} children mismatch ${expectChildren}`);
            }

            const actualPropertyNames = Object.keys(messageAndId).sort((a, b) => a.localeCompare(b));
            const expectedPropertyNames = ['id', 'parent', 'children', 'message'].sort((a, b) => a.localeCompare(b));
            if (actualPropertyNames.length != expectedPropertyNames.length || actualPropertyNames.some((n, i) => expectedPropertyNames[i] != n)) {
                console.log(`session ${session.id} message ${messageId} property name mismatch ${actualPropertyNames}`);
            }

            if (messageId == 'root') {
                hasRoot = true;
                if (messageAndId.message) {
                    console.log(`session ${session.id} root has message body`);
                }
                continue;
            }
            messageCount += 1;
            const message = messageAndId.message;
            if (!message) {
                console.log(`session ${session.id} message ${messageId} no body`);
            }
            if ((+messageId).toString() != messageId) {
                console.log(`session ${session.id} message ${messageId} is not integer`);
            }
            const truemessage = truesession ? truesession.messages.find(m => m.id == +messageId) : null;
            if (truesession && !truemessage) {
                console.log(`session ${truesession.filename} message ${messageId} not found in existing data`);
            }
            if (truemessage && messageAndId.parent != 'root' && +messageAndId.parent != truemessage.parentId) {
                console.log(`session ${truesession.filename} message ${messageId} parent id not same`);
            }

            // this is still using -chat and -reasoner? but not -flash and -pro?
            // source5 has model, but source4 don't have a field to distinguish -chat and -reasoner or -flash and -pro
            // RESULT from later validation: message.model can be regarded as consistent with has-thinking-block
            // but I'd like to add additional model information to distinguish v3, v4 and v4.1, split line according to official news release date
            // source4 data is not changed, source: deepseek-extract implies deepseek v3
            // 2026-04-24 change to -v4-flash and -v4-pro, 2026-09-10 change to -flash and -v4-pro
            if (!['deepseek-chat', 'deepseek-reasoner'].includes(message.model)) {
                console.log(`session ${session.id} message ${messageId} model ${message.model}`);
            }

            // const createTime = dayjs(message.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]');
            // console.log(`session ${session.id} message ${messageId} create time ${createTime}`);
            if (!Array.isArray(message.fragments)) {
                console.log(`session ${session.id} message ${messageId} fragments is not array`);
            }
            for (const [fragment, fragmentIndex] of message.fragments.map((f, i) => [f, i] as const)) {
                blockCount += 1;
                if (!['REQUEST', 'RESPONSE', 'THINK', 'SEARCH', 'FILE'].includes(fragment.type)) {
                    console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} unknown type ${fragment.type}`);
                }

                const actualPropertyNames = Object.keys(fragment).filter(p => p != 'type').sort((a, b) => a.localeCompare(b));
                if (fragment.type == 'REQUEST' || fragment.type == 'RESPONSE' || fragment.type == 'THINK') {
                    if (actualPropertyNames.length != 1 || actualPropertyNames[0] != 'content') {
                        console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} property name mismatch ${actualPropertyNames}`);
                    }
                    if (typeof fragment.content != 'string') {
                        console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} content not string`);
                    }
                } else if (fragment.type == 'FILE') {
                    if (actualPropertyNames.length != 1 || actualPropertyNames[0] != 'files') {
                        console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} property name mismatch ${actualPropertyNames}`);
                    }
                    if (!Array.isArray(fragment.files)) {
                        console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} files not array`);
                    }
                    for (const [file, fileIndex] of fragment.files.map((f, i) => [f, i] as const)) {
                        // console.log(file);
                        const actualPropertyNames = Object.keys(file).sort((a, b) => a.localeCompare(b));
                        const expectedPropertyNames = ['file_id', 'file_name', 'file_size'].sort((a, b) => a.localeCompare(b));
                        if (actualPropertyNames.length != expectedPropertyNames.length || actualPropertyNames.some((n, i) => expectedPropertyNames[i] != n)) {
                            console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} file ${fileIndex} property name mismatch ${actualPropertyNames}`);
                        }
                        if (typeof file.file_id != 'string') {
                            console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} file ${fileIndex} file_id not string`);
                        }
                        if (typeof file.file_name != 'string') {
                            console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} file ${fileIndex} file_name not string`);
                        }
                        if (typeof file.file_size != 'number') {
                            console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} file ${fileIndex} file_size not number`);
                        }
                    }
                } else if (fragment.type == 'SEARCH') {
                    if (actualPropertyNames.length != 1 || actualPropertyNames[0] != 'results') {
                        console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} property name mismatch ${actualPropertyNames}`);
                    }
                    if (!Array.isArray(fragment.results)) {
                        console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} results not array`);
                    }
                    for (const [result, resultIndex] of fragment.results.map((r, i) => [r, i] as const)) {
                        // console.log(result);
                        // snippet, site name, site icon etc. is not in export data while available in web app
                        // it's not very not ok because I only record these for fun
                        const actualPropertyNames = Object.keys(result).sort((a, b) => a.localeCompare(b));
                        const expectedPropertyNames = ['url', 'title'].sort((a, b) => a.localeCompare(b));
                        if (actualPropertyNames.length != expectedPropertyNames.length || actualPropertyNames.some((n, i) => expectedPropertyNames[i] != n)) {
                            console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} result ${resultIndex} property name mismatch ${actualPropertyNames}`);
                        }
                        if (typeof result.url != 'string') {
                            console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} result ${resultIndex} url not string`);
                        }
                        if (typeof result.title != 'string') {
                            console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} result ${resultIndex} title not string`);
                        }
                    }
                }

                if (fragment.type == 'REQUEST') {
                    if (truemessage && truemessage.role != 'user') {
                        console.log(`session ${session.id} message ${messageId} fragement ${fragmentIndex} unknown type ${fragment.type}`);
                    }
                }
            }
            // at max 1 for each fragment types, request don't stay with other types I guess
            const requestCount = message.fragments.filter(f => f.type == 'REQUEST').length;
            if (requestCount > 1) {
                console.log(`session ${session.id} message ${messageId} REQUEST fragment more than 1`);
            }
            const responseCount = message.fragments.filter(f => f.type == 'RESPONSE').length;
            const thinkCount = message.fragments.filter(f => f.type == 'THINK').length;
            const filesCount = message.fragments.filter(f => f.type == 'FILE').length;
            const resultsCount = message.fragments.filter(f => f.type == 'SEARCH').length;
            // RESULT: 1 session multiple search fragments, should be multiple server side search tool calls with different queries
            //         but keyword is not exported so collect them together
            if (responseCount > 1 || thinkCount > 1 || filesCount > 1 || resultsCount > 1) {
                console.log(`session ${session.id} message ${messageId} assistant fragment more than 1`);
            }
            if ((requestCount || filesCount) && (responseCount || thinkCount || resultsCount)) {
                console.log(`session ${session.id} message ${messageId} user fragment and assistant fragment appear in same message, ${JSON.stringify({ requestCount, responseCount, thinkCount, filesCount, resultsCount })}`);
            }
            // RESULT: 3 messages, is cancelled assistant message
            if (!(requestCount || filesCount) && !(responseCount || thinkCount || resultsCount)) {
                // console.log(`session ${session.id} message ${messageId} neither user nor assistant?, ${JSON.stringify({ requestCount, responseCount, thinkCount, filesCount, resultsCount })}`);
            }
            // no fragment message don't have children
            if (message.fragments.length == 0 && messageAndId.children.length) {
                console.log(`session ${session.id} message ${messageId} is empty but has children`);
            }

            // same as source 4, deepseek export don't have system message
            const role = requestCount || filesCount ? 'user' : 'assistant';
            if (truemessage && role != truemessage.role) {
                console.log(`session ${session.id} message ${messageId} role not same`);
            }

            // imported data don't have multiple text block or thinking block
            const textFragment = message.fragments.find(f => f.type == 'REQUEST' || f.type == 'RESPONSE');
            const textBlock = truemessage ? truemessage.content.find(c => c.kind == 'text') : null;
            if (textFragment && truemessage) { // not include textblock nullablity in condition implies a text block must be in truemessage validation
                const s5value = textFragment.content.trim().split('\n').map(v => v.trimEnd()).join('\n');
                const s4value = textBlock.value;
                // RESULT: fixed 1 error in source4 result building in 4 messages
                if (s5value != s4value) {
                    // diffCount += 1;
                    console.log(`session ${truesession.filename} message ${messageId} text block not same`);
                    if (diffCount == 1) {
                        console.log(s4value, s5value);
                    }
                }
            }

            const thinkFragment = message.fragments.find(f => f.type == 'THINK');
            const thinkBlock = truemessage ? truemessage.content.find(c => c.kind == 'think') : null;
            if (thinkFragment && truemessage) { // not include thinkblock nullablity in condition implies a think block must be in truemessage validation
                const s5value = thinkFragment.content.trim().split('\n').map(v => v.trimEnd()).join('\n');
                const s4value = thinkBlock.value;
                if (s5value != s4value) {
                    diffCount += 1;
                    console.log(`session ${truesession.filename} message ${messageId} think block not same`);
                    if (diffCount == 1) {
                        console.log(s4value, s5value);
                    }
                }
            }

            if (role == 'user' && message.model == 'deepseek-reasoner') {
                // RESULT: many
                // console.log(`session ${session.title} message ${messageId} is user while model is reasoner`);
            } else if (role == 'assistant') {
                if (thinkFragment && message.model != 'deepseek-reasoner') {
                    console.log(`session ${session.id} message ${messageId} is assistant, has thinking block but not reasoner`);
                // RESULT: some, at least 1 empty message, at least 5 服务器繁忙请稍后再试
                } else if (!thinkFragment && message.model == 'deepseek-reasoner') {
                    // console.log(`session ${session.id} message ${messageId} is assistant, has no thinking block but is reasoner`);
                }
            }

            const files = message.fragments.find(f => f.type == 'FILE')?.files;
            if (files && truemessage) {
                if (!Array.isArray(truemessage.metadata.files)) {
                    console.log(`session ${truesession.filename} message ${messageId} files mismatch`);
                }
                if (files.length != truemessage.metadata.files.length) {
                    console.log(`session ${truesession.filename} message ${messageId} file count mismatch`);
                }
                const s4files = truemessage.metadata.files.sort((f1: Message4File, f2: Message4File) => f1.id.localeCompare(f2.id));
                const s5files = [...files].sort((f1, f2) => f1.file_id.localeCompare(f2.file_id));
                for (let fileIndex = 0; fileIndex < s4files.length; fileIndex += 1) {
                    const s4file = s4files[fileIndex];
                    const s5file = s5files[fileIndex];
                    if (s4file.id != `file-${s5file.file_id}`) {
                        console.log(`session ${truesession.filename} message ${messageId} file ${fileIndex} id not same`);
                    }
                    if (s4file['file-name'] != s5file.file_name) {
                        console.log(`session ${truesession.filename} message ${messageId} file ${fileIndex} name not same`);
                    }
                    if (s4file['file-size'] != s5file.file_size) {
                        console.log(`session ${truesession.filename} message ${messageId} file ${fileIndex} size not same`);
                    }
                }
            }

            const results = message.fragments.filter(f => f.type == 'SEARCH')
                .reduce<{ url: string, title: string }[]>((acc, f) => { acc.push(...f.results); return acc; }, []);
            if (results.length && truemessage) {
                if (!Array.isArray(truemessage.response?.['search-results'])) {
                    console.log(`session ${truesession.filename} message ${messageId} search-results mismatch`);
                } else {
                    if (results.length != truemessage.response['search-results'].length) {
                        console.log(`session ${truesession.filename} message ${messageId} search result count mismatch`);
                    }
                    const s4results = truemessage.response['search-results'].sort((f1: Message4Result, f2: Message4Result) => f1.url.localeCompare(f2.url));
                    const s5results = [...results].sort((f1, f2) => f1.url.localeCompare(f2.url));
                    for (let resultIndex = 0; resultIndex < s4results.length; resultIndex += 1) {
                        const s4file = s4results[resultIndex];
                        const s5file = s5results[resultIndex];
                        if (s4file.url != s5file.url) {
                            console.log(`session ${truesession.filename} message ${messageId} result ${resultIndex} url not same`);
                        }
                        if (s4file.title != s5file.title.trim()) {
                            // RESULT: ' #' again
                            console.log(`session ${truesession.filename} message ${messageId} result ${resultIndex} title not same, ${s4file.title}, ${s5file.title.trim()}`);
                        }
                    }
                    // console.log(s4results, s5results);
                }
            }
        }
        if (!hasRoot) {
            console.log(`session ${session.id} no root`);
        }
    }
    console.log(sessionCount, existingSessionCount, messageCount, blockCount);
    return sessions;
}
async function write5(sessions: Session5[]) {

    let sessionIndex = 0;
    // rv: reverse validation
    let reverseValidationSessionCount = 0;
    let reverseValidationMessageCount = 0;
    let reverseValidationContentBlockContent = 0;

    for (const session of sessions) {
        const filename = dayjs(session.inserted_at).format('YYYYMMDD-HHmmss');
        if (filename != '20250708-005909' && npfs.existsSync(`${filename}.yml`)) {
            // console.log(`skip ${filename}`);
            continue;
        }

        let b = '';
        // oh, title can have colon
        if (!session.title) {
            b += `name: (no title)\n`;
        } else if (session.title.includes(': ')) {
            b += `name: '${session.title.trim()}'\n`;
        } else {
            b += `name: ${session.title.trim()}\n`;
        }
        b += `metadata:\n`;
        b += `  source: deepseek-chatapp-migration-202611\n`;
        b += `  source-id: ${session.id}\n`;
        b += `  source-create-time: ${dayjs(session.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]')}\n`;
        if (session.inserted_at != session.updated_at) {
            b += `  source-update-time: ${dayjs(session.updated_at).format('YYYY-MM-DDTHH:mm:ss[Z]')}\n`;
        }
        for (const [messageId, messageAndId] of Object.entries(session.mapping)) {
            if (messageId == 'root') { continue; }
            const message = messageAndId.message;
            const role = message.fragments.some(f => f.type == 'REQUEST' || f.type == 'FILE') ? 'user' : 'assistant';
            b += '\n';
            b += `${role} ${messageId}${messageAndId.parent && messageAndId.parent != 'root' ? `>${messageAndId.parent}` : ''}:\n`;
            if (role == 'assistant') {
                b += `  content:\n`;
                // server side search tool's result is assitant message's content block
                // but for now just record them in metadata
                const thinkingFragment = message.fragments.find(f => f.type == 'THINK');
                if (thinkingFragment) {
                    b += `  - kind: think\n`;
                    b += `    value: |-\n`;
                    for (const line of thinkingFragment.content.trim().split('\n')) {
                        if (line.trim().length == 0) {
                            b += '\n'
                        } else {
                            b += `      ${line.trimEnd()}\n`;
                        }
                    }
                }
                const textFragment = message.fragments.find(f => f.type == 'RESPONSE');
                if (textFragment) {
                    b += `  - kind: text\n`;
                    b += `    value: |-\n`;
                    for (const line of textFragment.content.trim().split('\n')) {
                        if (line.trim().length == 0) {
                            b += '\n'
                        } else {
                            b += `      ${line.trimEnd()}\n`;
                        }
                    }
                }
                if (!thinkingFragment && !textFragment) {
                    b += `  - kind: text\n`;
                    b += `    value: (this is empty message in migrate data, which means 服务器繁忙，请稍后再试)\n`;
                }
                b += '  response:\n';
            } else {
                const textFragment = message.fragments.find(f => f.type == 'REQUEST');
                if (textFragment) {
                    if (textFragment.content.trim().includes('\n')
                        || textFragment.content.trim().includes(': ')
                        || textFragment.content.trim().startsWith('"')
                        || textFragment.content.trim().startsWith('- ')
                    ) {
                        b += `  content: |-\n`;
                        for (const line of textFragment.content.trim().split('\n')) {
                            if (line.trim().length == 0) {
                                b += '\n'
                            } else {
                                b += `    ${line.trimEnd()}\n`;
                            }
                        }
                    } else if (
                        textFragment.content.trim().includes(' #')
                        // message.content.trim().startsWith('"')
                        // || message.content.trim().startsWith('[')
                        // || /^\d+(\.\d+)?$/.test(message.content.trim())
                    ) {
                        b += `  content: '${textFragment.content.trim()}'\n`;
                    // } else if (message.content.trim().length == 0) {
                    //     b += `  content: ''\n`;
                    } else {
                        b += `  content: ${textFragment.content.trim()}\n`;
                    }
                }
                b += '  metadata:\n';
            }
            b += `    create-time: ${dayjs(message.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]')}\n`;
            const filesFragment = message.fragments.find(f => f.type == 'FILE');
            if (filesFragment) {
                b += `    files:\n`;
                for (const file of filesFragment.files) {
                    b += `    - file-id: ${file.file_id}\n`;
                    b += `      file-name: ${file.file_name}\n`;
                    b += `      file-size: ${file.file_size}\n`;
                }
            }
            const resultsFragments = message.fragments.filter(f => f.type == 'SEARCH');
            if (resultsFragments.length) {
                b += `    search-results:\n`;
                for (const search_result of resultsFragments
                    .reduce<{ url: string, title: string }[]>((acc, f) => { acc.push(...f.results); return acc; }, []))
                {
                    // console.log(search_result);
                    b += `    - url: ${search_result.url}\n`;
                    if (search_result.title.trim().startsWith('[')
                        || search_result.title.trim().includes(': ')
                        || search_result.title.trim().includes(' #')
                        || search_result.title.trim().startsWith('#')
                        || search_result.title.trim().startsWith('@')
                        || search_result.title.trim().startsWith('*')
                        || search_result.title.trim().startsWith("'")
                        || search_result.title.trim().endsWith(':')
                        || search_result.title.trim().startsWith('"')
                    ) {
                        if (search_result.title.trim().includes("'")) {
                            b += `      title: "${search_result.title.trim()}"\n`;
                        } else {
                            b += `      title: '${search_result.title.trim()}'\n`;
                        }
                    } else if (!search_result.title.trim()) {
                        b += `      title: (empty)\n`;
                    } else {
                        b += `      title: ${search_result.title.trim()}\n`;
                    }
                }
            }
        }

        await fs.writeFile(`${filename}.yml`, b);
        sessionIndex += 1;

        // console.log(filename);
        const document = yaml.parse(b);
        // const document = yaml.parse(await fs.readFile(`${filename}.yml`, 'utf-8'));

        if (document.name != (session.title?.trim() || '(no title)')) {
            console.log(`session ${filename} unexpected name`);
        }
        if (document.metadata['source'] != 'deepseek-chatapp-migration-202611') {
            console.log(`session ${filename} unexpected source`);
        }
        if (document.metadata['source-id'] != session.id) {
            console.log(`session ${filename} unexpected source id`);
        }
        if (document.metadata['source-create-time'] != dayjs(session.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]')) {
            console.log(`session ${filename} unexpected source create time`);
        }
        if (session.inserted_at != session.updated_at
            && document.metadata['source-update-time'] != dayjs(session.updated_at).format('YYYY-MM-DDTHH:mm:ss[Z]')
        ) {
            console.log(`session ${filename} unexpected source update time`);
        }
        for (const [messageId, messageAndId] of Object.entries(session.mapping)) {
            if (messageId == 'root') { continue; }
            const message = messageAndId.message;
            const role = message.fragments.some(f => f.type == 'REQUEST' || f.type == 'FILE') ? 'user' : 'assistant';

            const key = `${role} ${messageId}${messageAndId.parent && messageAndId.parent != 'root' ? `>${messageAndId.parent}` : ''}`;
            const element = document[key];
            if (!element) {
                console.log(`document ${filename} message ${messageId} missing`);
            }
            if (role == 'assistant') {
                let blockIndex = 0;
                const thinkingFragment = message.fragments.find(f => f.type == 'THINK');
                if (thinkingFragment) {
                    if (element.content[blockIndex].kind != 'think') {
                        console.log(`document ${filename} message ${messageId} content[${blockIndex}].kind not think`);
                    }
                    if (element.content[blockIndex].value != thinkingFragment.content.trim().split('\n').map(v => v.trimEnd()).join('\n')) {
                        console.log(`document ${filename} message ${messageId} content[${blockIndex}].value not same`);
                    } else {
                        reverseValidationContentBlockContent += 1;
                    }
                    blockIndex += 1;
                }
                const textFragment = message.fragments.find(f => f.type == 'RESPONSE');
                if (textFragment) {
                    if (element.content[blockIndex].kind != 'text') {
                        console.log(`document ${filename} message ${messageId} content[${blockIndex}].kind not text`);
                    }
                    if (element.content[blockIndex].value != textFragment.content.trim().split('\n').map(v => v.trimEnd()).join('\n')) {
                        console.log(`document ${filename} message ${messageId} content[${blockIndex}].value not same`);
                    } else {
                        reverseValidationContentBlockContent += 1;
                    }
                }
            } else {
                const textFragment = message.fragments.find(f => f.type == 'REQUEST');
                if (element.content != textFragment.content.trim().split('\n').map(v => v.trimEnd()).join('\n')) {
                    console.log(`document ${filename} message ${messageId} content not same`);
                } else {
                    reverseValidationContentBlockContent += 1;
                }
            }
            const metadata = role == 'assistant' ? element.response : element.metadata;
            if (metadata['create-time'] != dayjs(message.inserted_at).format('YYYY-MM-DDTHH:mm:ss[Z]')) {
                console.log(`document ${filename} message ${messageId} create time not same`);
            }
            const filesFragment = message.fragments.find(f => f.type == 'FILE');
            if (filesFragment) {
                for (const [file, fileIndex] of filesFragment.files.map((f, i) => [f, i] as const)) {
                    const element = metadata.files[fileIndex];
                    if (file.file_id != element['file-id']) {
                        console.log(`document ${filename} message ${messageId} file ${fileIndex} file id not same`);
                    }
                    if (file.file_name != element['file-name']) {
                        console.log(`document ${filename} message ${messageId} file ${fileIndex} file name not same`);
                    }
                    if (file.file_size != element['file-size']) {
                        console.log(`document ${filename} message ${messageId} file ${fileIndex} file size not same`);
                    }
                }
            }
            const resultsFragments = message.fragments.filter(f => f.type == 'SEARCH');
            if (resultsFragments.length) {
                for (const [result, resultIndex] of resultsFragments
                    .reduce<{ url: string, title: string }[]>((acc, f) => { acc.push(...f.results); return acc; }, [])
                    .map((r, i) => [r, i] as const))
                {
                    const element = metadata['search-results'][resultIndex];
                    if (result.url != element.url) {
                        console.log(`document ${filename} message ${messageId} result ${resultIndex} url not same`);
                    }
                    if ((result.title.trim() || '(empty)') != element.title) {
                        console.log(`document ${filename} message ${messageId} result ${resultIndex} title not same`);
                    }
                }
            }
            reverseValidationMessageCount += 1;
        }
        reverseValidationSessionCount += 1;
    }
    console.log(reverseValidationSessionCount, reverseValidationMessageCount, reverseValidationContentBlockContent);
}
const session5s = await read5();
await write5(session5s);
