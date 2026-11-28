import fs from 'node:fs/promises';
import npfs from 'node:fs';
import path from 'node:path';
import dayjs from 'dayjs';
import { diffLines } from 'diff';
import mysql from 'mysql2/promise';
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
                } else if (ch == '\\' && line[i + 1] == '\\') {
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
const truesessions: TrueSession[] = []; // await readtrue();

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
// const session5s = await read5();
// await write5(session5s);

// source alternative#1, mysql csv backup files for tables that is created from source#4, it tries to match source#3 data
// schema but still results in a lot of differences and different database table while still discards a lot of information

interface SessionAlt1 {
    id: string,
    seqId: number,
    title: string,
    createTime: string,
    updateTime: string,
}
interface MessageAlt1 {
    sessionId: string,
    messageId: number,
    parentId: number,
    role: string,
    content: string,
    thinkingEnabled: boolean,
    thinkingContent: string,
    searchEnabled: boolean,
    accumulatedTokenUsage: number,
    createTime: string,
}
async function readalt1() {

    const sessions = readMySQLCSV(await fs.readFile('mysql-backup-20260319-dsession.csv', 'utf8'), fields => ({
        id: fields[0],
        seqId: +fields[1],
        title: fields[2],
        createTime: fields[3],
        updateTime: fields[4],
    } as SessionAlt1));

    const messages = readMySQLCSV(await fs.readFile('mysql-backup-20260319-dmessage.csv', 'utf8'), fields => ({
        sessionId: fields[0],
        messageId: +fields[1],
        parentId: +fields[2],
        role: fields[3],
        content: fields[4],
        thinkingEnabled: fields[5].codePointAt(0) != 0,
        thinkingContent: fields[6],
        accumulatedTokenUsage: +fields[7],
        createTime: fields[8],
        searchEnabled: fields[9].codePointAt(0) != 0,
    } as MessageAlt1));

    let matchCount = 0;
    const sessionIds: string[] = [];
    for (const session of sessions) {
        if (sessionIds.includes(session.id)) {
            console.log(`alt1: session ${session.id} duplicate id`);
        }
        sessionIds.push(session.id);
    
        const truesession = truesessions.find(s => s.metadata && s.metadata['source-id'] == session.id);
        if (!truesession) {
            console.log(`alt1: session ${session.id} not found in true data`);
        }
        const filename = truesession.filename;
        if (sessions.some(s => s.id != session.id && s.seqId == session.seqId)) {
            console.log(`alt1: session ${filename} duplicate seq id`);
        }
        if (session.seqId != truesession.metadata['source-seq-id']) {
            console.log(`alt1: session ${filename} seq id not same as true`);
        } else { matchCount += 1; }
        if (session.title.trim() != truesession.name) {
            console.log(`alt1: session ${filename} name not same as true`);
        } else { matchCount += 1; }
        // dayjs need additional plugin to work with tz, so the answer is...
        // hardcode subtract 8 hours
        const createTime = dayjs(session.createTime, 'YYYY-MM-DD HH:mm:ss').subtract(8, 'hour');
        // may be +1s difference
        if (createTime.diff(dayjs(truesession.metadata['source-create-time']), 'second') > 1){
            console.log(`alt1: session ${filename} create time not same as true`, createTime, truesession.metadata['source-create-time']);
        } else { matchCount += 1; }
        const updateTime = dayjs(session.updateTime, 'YYYY-MM-DD HH:mm:ss').subtract(8, 'hour');
        const trueUpdateTime = dayjs(truesession.metadata['source-update-time'] ?? truesession.metadata['source-create-time']);
        if (updateTime.diff(trueUpdateTime, 'second') > 1 || updateTime.diff(trueUpdateTime, 'second') < -1) {
            // RESULT: the classic case captured in source4 and changed in source5 in the process of developing source3
            console.log(`alt1: session ${filename} update time not same as true`);
        } else { matchCount += 1; }

        for (const message of messages.filter(m => m.sessionId == session.id)) {
            const truemessage = truesession.messages.find(m => m.id == message.messageId);
            if (!truemessage) {
                console.log(`alt1: session ${filename} message ${message.messageId} not found in true`);
            }
            if (truemessage.role != message.role.toLowerCase()) {
                console.log(`alt1: session ${filename} message ${message.messageId} role not same`);
            } else { matchCount += 1; }
            if (truemessage.parentId && message.parentId != truemessage.parentId) {
                console.log(`alt1: session ${filename} message ${message.messageId} parent id not same`);
            } else { matchCount += 1; }

            if (message.thinkingContent) {
                const thinkingBlock = truemessage.content.find(c => c.kind == 'think');
                if (message.thinkingContent.trim().split('\n').map(v => v.trimEnd()).join('\n') != thinkingBlock.value) {
                    console.log(`alt1: session ${filename} message ${message.messageId} thinking content not same`);
                } else { matchCount += 1; }
            }
            const textBlock = truemessage.content.find(c => c.kind == 'text');
            if (message.content.trim().split('\n').map(v => v.trimEnd()).join('\n') != textBlock.value) {
                console.log(`alt1: session ${filename} message ${message.messageId} content not same`);
            } else { matchCount += 1; }

            const metadata = truemessage.role == 'assistant' ? truemessage.response : truemessage.metadata;
            if (message.thinkingEnabled && !metadata['thinking-enabled']) {
                console.log(`alt1: session ${filename} message ${message.messageId} thinking enabled not same`);
            } else { matchCount += 1; }
            if (message.searchEnabled && !metadata['search-enabled']) {
                console.log(`alt1: session ${filename} message ${message.messageId} search enabled not same`);
            } else { matchCount += 1; }
            if (message.accumulatedTokenUsage && metadata['accumulated-token-usage'] != message.accumulatedTokenUsage) {
                console.log(`alt1: session ${filename} message ${message.messageId} accumulated token usage not same`);
            } else { matchCount += 1; }

            const createTime = dayjs(message.createTime, 'YYYY-MM-DD HH:mm:ss').subtract(8, 'hour');
            // may be +1s difference
            if (createTime.diff(dayjs(metadata['create-time']), 'second') > 1 || createTime.diff(dayjs(metadata['create-time']), 'second') < -1){
                console.log(`alt1: session ${filename} message ${message.messageId} create time not same`);
            } else { matchCount += 1; }
        }
    }
    for (const message of messages) {
        if (!sessionIds.includes(message.sessionId)) {
            console.log(`alt1: message ${message.sessionId} ${message.messageId} sessionid not found`);
        }
    }

    console.log(sessions.length, messages.length, matchCount);
}
// await readalt1();

// source alternative#2, mysql sql backup files for source#3,
// or more specifically, chatapp2025 before message id scope change

// https://dev.mysql.com/doc/mysql-installation-excerpt/8.0/en/docker-mysql-more-topics.html
// docker run -d --rm --name mysql1
//   -e MYSQL_RANDOM_ROOT_PASSWORD=1 -e MYSQL_DATABASE=YALA -e MYSQL_USER=yala -e MYSQL_PASSWORD=123456
//   -v init.sql:/docker-entrypoint-initdb.d/init.sql -v ~/mysql-socket:/var/run/mysqld
//   -p 3306:3306 mysql

interface SessionAlt2 {
    SessionId: number,
    UserId: number,
    Name: string,
    Comment?: string,
    // Date become iso8601 after json.stringify,
    // and incorrectly add a Z flag although the value is +8:00
    CreateTime: string, // Date // mysql library default setting result in this
    Tags: string,
    // buffer become this after json.stringify
    Shared: { type: 'buffer', data: number[] }, // Buffer, // length 1
    ShareId?: string,
}
interface MessageAlt2 {
    MessageId: number,
    SessionId: number,
    Role: string,
    Content: string,
    CreateTime: string,
    PromptTokenCount?: number,
    CompletionTokenCount?: number,
    ParentMessageId?: number,
}
async function readalt2() {

    // // https://sidorares.github.io/node-mysql2/docs
    // await using connection = await mysql.createConnection({
    //     socketPath: '/var/run/mysqld/mysqld.sock',
    //     user: 'yala',
    //     password: '123456',
    //     database: 'YALA',
    // });

    // const [sessions] = await connection.query<SessionAlt2[] & mysql.QueryResult>('SELECT * FROM `Session`;');
    // const [messages] = await connection.query<MessageAlt2[] & mysql.QueryResult>('SELECT * FROM `Message`;');
    // await fs.writeFile('session.json', JSON.stringify(sessions));
    // await fs.writeFile('message.json', JSON.stringify(messages)); 

    const sessions: SessionAlt2[] = JSON.parse(await fs.readFile('session.json', 'utf-8'));
    const messages: MessageAlt2[] = JSON.parse(await fs.readFile('message.json', 'utf-8'));

    // database validated a lot for you,
    // no unkown columnes, no duplicate pk, not null when column is not null

    let matchCount = 0;
    for (const session of sessions) {
        if (session.UserId != 1) {
            console.log(`session ${session.SessionId} user id not 1`);
        }
        const truesession = truesessions.find(s => s.metadata &&
            s.metadata.source == 'chatapp2025/theai/yala' && s.metadata['source-id'] == session.SessionId);
        if (!truesession) {
            console.log(`session ${session.SessionId} not found true session`);
        }
        if (session.Name != truesession.name) {
            console.log(`session ${truesession.filename} name not same`);
        } else { matchCount += 1; }
        if (session.Comment && session.Comment != truesession.metadata['source-comment']) {
            console.log(`session ${truesession.filename} comment not same`);
        } else { matchCount += 1; }
        const createTime = dayjs(session.CreateTime).subtract(8, 'hours');
        const trueCreateTime = dayjs(truesession.metadata['source-create-time'], 'YYYY-MM-DD HH:mm:ss');
        if (createTime.diff(trueCreateTime, 'second') > 1 || createTime.diff(trueCreateTime, 'second') < -1) {
            console.log(`session ${truesession.filename} create time not same`, session.CreateTime, truesession.metadata['source-create-time']);
        } else { matchCount += 1; }
        // RESULT: 1, obviously test data because that tag is called "test tag"
        if (session.Tags && session.Tags != truesession.metadata['source-tags']) {
            console.log(`session ${truesession.filename} tags not same`);
        } else { matchCount += 1; }
        if ((session.Shared.data[0] == 1) != (truesession.metadata['source-shared-flag'] == 1)) {
            console.log(`session ${truesession.filename} share flag not same`);
        } else { matchCount += 1; }
        // RESULT: 1, obviously enabled share after backup
        if (session.ShareId != truesession.metadata['source-share-id']) {
            console.log(`session ${truesession.filename} share id not same`);
        } else { matchCount += 1; }

        // alt21 message id is overall pk
        for (const message of messages.filter(m => m.SessionId == session.SessionId)) {
            const truemessage = truesession.messages.find(m => m.id == message.MessageId);
            // RESULT: 2 sets of message-x content mismatch, message x+1 missing, message x+2 parent id not same
            //         they are assumed manual fixed result of incorrect role relationship because of chatapp2025 ui bug or data migration error
            if (!truemessage) {
                console.log(`session ${truesession.filename} message ${message.MessageId} not found`);
                continue;
            }
            if (message.Role != truemessage.role) {
                console.log(`session ${truesession.filename} message ${message.MessageId} role not same`);
            } else { matchCount += 1; }
            if (message.ParentMessageId && message.ParentMessageId != truemessage.parentId) {
                console.log(`session ${truesession.filename} message ${message.MessageId} parent id not same`);
            } else { matchCount += 1; }
            // source3 have system message but don't have thinking content if you forget
            // RESULT: 1 mismatch, check the update time which is obviously edited after backup
            if (truemessage.content[0].kind != 'text') {
                console.log(`session ${truesession.filename} message ${message.MessageId} true content block type not text?`);
            } else { matchCount += 1; }
            if (message.Content.trim().split('\n').map(v => v.trimEnd()).join('\n') != (truemessage.content[0] as any).value) {
                console.log(`session ${truesession.filename} message ${message.MessageId} content not same`);
            } else { matchCount += 1; }
            const metadata = message.Role == 'assistant' ? truemessage.response : truemessage.metadata;
            const createTime = dayjs(message.CreateTime).subtract(8, 'hours');
            const trueCreateTime = dayjs(metadata['source-create-time'], 'YYYY-MM-DD HH:mm:ss');
            if (createTime.diff(trueCreateTime, 'second') > 1 || createTime.diff(trueCreateTime, 'second') < -1) {
                console.log(`session ${truesession.filename} message ${message.MessageId} create time not same`);
            } else { matchCount += 1; }
            if (message.PromptTokenCount && message.PromptTokenCount != metadata['source-usage-input-token']) {
                console.log(`session ${truesession.filename} message ${message.MessageId} input token not same`);
            } else { matchCount += 1; }
            if (message.CompletionTokenCount && message.CompletionTokenCount != metadata['source-usage-output-token']) {
                console.log(`session ${truesession.filename} message ${message.MessageId} output token not same`);
            } else { matchCount += 1; }
        }
    }
    // alt2 don't have message.sessionid fk if you forget
    for (const message of messages) {
        if (!sessions.some(s => s.SessionId == message.SessionId)) {
            console.log(`message ${message.SessionId} ${message.MessageId} session id not found`);
        }
    }
    console.log(sessions.length, messages.length, matchCount);
}
// await readalt2();

// source alternative#3, mysql sql backup files for source#3 and source#4,
// compare to alt2, this is after message id scope change and include simplified source#4

interface SessionAlt3 extends SessionAlt2 {
    // same
}
interface MessageAlt3 extends MessageAlt2 {
    UpdateTime: string,
    ThinkingContent?: string,
}
// dsession and dmessage
interface SessionAlt3Alt {
    id: string,
    seq_id: number,
    title: string,
    inserted_at: string,
    updated_at: string,
}
interface MessageAlt3Alt {
    session_id: string,
    message_id: number,
    parent_id?: number,
    role: string,
    content: string,
    thinking_enabled: { type: 'buffer', data: number[] },
    thinking_content?: string,
    accumulated_token_usage: number,
    inserted_at: string,
    search_enabled: { type: 'buffer', data: number[] },
}

async function readalt3() {

    // await using connection = await mysql.createConnection({
    //     socketPath: '/var/run/mysqld/mysqld.sock',
    //     user: 'yala',
    //     password: '123456',
    //     database: 'YALA',
    // });
    // const [sessions] = await connection.query<SessionAlt3[] & mysql.QueryResult>('SELECT * FROM `Session`;');
    // const [messages] = await connection.query<MessageAlt3[] & mysql.QueryResult>('SELECT * FROM `Message`;');
    // const [dsessions] = await connection.query<SessionAlt3[] & mysql.QueryResult>('SELECT * FROM `dsession`;');
    // const [dmessages] = await connection.query<MessageAlt3[] & mysql.QueryResult>('SELECT * FROM `dmessage`;');
    // await fs.writeFile('session.json', JSON.stringify(sessions));
    // await fs.writeFile('message.json', JSON.stringify(messages)); 
    // await fs.writeFile('dsession.json', JSON.stringify(dsessions));
    // await fs.writeFile('dmessage.json', JSON.stringify(dmessages)); 

    const sessions: SessionAlt3[] = JSON.parse(await fs.readFile('session.json', 'utf-8'));
    const messages: MessageAlt3[] = JSON.parse(await fs.readFile('message.json', 'utf-8'));
    const dsessions: SessionAlt3Alt[] = JSON.parse(await fs.readFile('dsession.json', 'utf-8'));
    const dmessages: MessageAlt3Alt[] = JSON.parse(await fs.readFile('dmessage.json', 'utf-8'));

    // database validated a lot for you,
    // no unkown columnes, no duplicate pk, not null when column is not null

    let matchCount = 0;
    for (const session of sessions) {
        if (session.UserId != 1) {
            console.log(`session ${session.SessionId} user id not 1`);
        }
        const truesession = truesessions.find(s => s.metadata &&
            s.metadata.source == 'chatapp2025/theai/yala' && s.metadata['source-id'] == session.SessionId);
        if (!truesession) {
            console.log(`session ${session.SessionId} not found true session`);
        }
        // RESULT: 3, obviously improved session name after backup
        if (session.Name != truesession.name) {
            console.log(`session ${truesession.filename} name not same`);
        } else { matchCount += 1; }
        // RESULT: 1, obviously test data because the content is "test comment"
        if (session.Comment && session.Comment != truesession.metadata['source-comment']) {
            console.log(`session ${truesession.filename} comment not same`);
        } else { matchCount += 1; }

        // compare to alt2 same mysqldump file, this time don't need -8hour
        const createTime = dayjs(session.CreateTime);
        const trueCreateTime = dayjs(truesession.metadata['source-create-time'], 'YYYY-MM-DD HH:mm:ss');
        if (createTime.diff(trueCreateTime, 'second') > 1 || createTime.diff(trueCreateTime, 'second') < -1) {
            console.log(`session ${truesession.filename} create time not same`, session.CreateTime, truesession.metadata['source-create-time']);
        } else { matchCount += 1; }
        if (session.Tags && session.Tags != truesession.metadata['source-tags']) {
            console.log(`session ${truesession.filename} tags not same`);
        } else { matchCount += 1; }
        // RESULT: several, obviously enabled share after backup
        if ((session.Shared.data[0] == 1) != (truesession.metadata['source-shared-flag'] == 1)) {
            console.log(`session ${truesession.filename} share flag not same`);
        } else { matchCount += 1; }
        if (session.ShareId != truesession.metadata['source-share-id']) {
            console.log(`session ${truesession.filename} share id not same`);
        } else { matchCount += 1; }

        // alt21 message id is overall pk
        for (const message of messages.filter(m => m.SessionId == session.SessionId)) {
            const truemessage = truesession.messages.find(m => m.id == message.MessageId);
            // same x-content, x+1-missing, x+2-parent-id sequence as alt2, but only remain 1 set,
            // that mean one set is fixed between alt2 and alt3, but the remaining set is fixed later
            if (!truemessage) {
                console.log(`session ${truesession.filename} message ${message.MessageId} not found`);
                continue;
            }
            if (message.Role != truemessage.role) {
                console.log(`session ${truesession.filename} message ${message.MessageId} role not same`);
            } else { matchCount += 1; }
            if (message.ParentMessageId && message.ParentMessageId != truemessage.parentId) {
                console.log(`session ${truesession.filename} message ${message.MessageId} parent id not same`);
            } else { matchCount += 1; }
            // source3 have system message but don't have thinking content if you forget
            // RESULT: 2, obviously edited after backup
            if (truemessage.content[0].kind != 'text') {
                console.log(`session ${truesession.filename} message ${message.MessageId} true content block type not text?`);
            } else { matchCount += 1; }
            if (message.Content.trim().split('\n').map(v => v.trimEnd()).join('\n') != (truemessage.content[0] as any).value) {
                console.log(`session ${truesession.filename} message ${message.MessageId} content not same`);
            } else { matchCount += 1; }
            const metadata = message.Role == 'assistant' ? truemessage.response : truemessage.metadata;

            const createTime = dayjs(message.CreateTime);
            const trueCreateTime = dayjs(metadata['source-create-time'], 'YYYY-MM-DD HH:mm:ss');
            if (createTime.diff(trueCreateTime, 'second') > 1 || createTime.diff(trueCreateTime, 'second') < -1) {
                console.log(`session ${truesession.filename} message ${message.MessageId} create time not same`);
            } else { matchCount += 1; }
            // compare to alt2, added column update time
            if (message.UpdateTime != message.CreateTime) {
                const updateTime = dayjs(message.UpdateTime);
                const trueUpdateTime = dayjs((metadata['source-update-time'] || metadata['source-create-time']), 'YYYY-MM-DD HH:mm:ss');
                if (updateTime.diff(trueUpdateTime, 'second') > 1 || updateTime.diff(trueUpdateTime, 'second') < -1) {
                    console.log(`session ${truesession.filename} message ${message.MessageId} update time not same`);
                } else { matchCount += 1; }
            }

            if (message.PromptTokenCount && message.PromptTokenCount != metadata['source-usage-input-token']) {
                console.log(`session ${truesession.filename} message ${message.MessageId} input token not same`);
            } else { matchCount += 1; }
            if (message.CompletionTokenCount && message.CompletionTokenCount != metadata['source-usage-output-token']) {
                console.log(`session ${truesession.filename} message ${message.MessageId} output token not same`);
            } else { matchCount += 1; }

            if (message.ThinkingContent) {
                console.log(`session ${truesession.filename} message ${message.MessageId} has thinking content?`);
            }
        }
    }
    // alt3 both message and dmessage have correct fk so no need to validate that

    console.log(sessions.length, messages.length, matchCount);

    // RESULT overall 1 mismatch, which is the classic session edited after backup
    matchCount = 0;
    const sessionIds: string[] = [];
    for (const session of dsessions) {
        if (sessionIds.includes(session.id)) {
            console.log(`alt3: session ${session.id} duplicate id`);
        }
        sessionIds.push(session.id);
    
        const truesession = truesessions.find(s => s.metadata && s.metadata['source-id'] == session.id);
        if (!truesession) {
            console.log(`alt3: dsession ${session.id} not found in true data`);
        }
        const filename = truesession.filename;
        if (dsessions.some(s => s.id != session.id && s.seq_id == session.seq_id)) {
            console.log(`alt3: dsession ${filename} duplicate seq id`);
        }
        if (session.seq_id != truesession.metadata['source-seq-id']) {
            console.log(`alt3: dsession ${filename} seq id not same as true`);
        } else { matchCount += 1; }
        if (session.title.trim() != truesession.name) {
            console.log(`alt3: dsession ${filename} name not same as true`);
        } else { matchCount += 1; }

        // the time from mysql2 library default setting and then json.stringify results in +8:00 but incorrectly ends with z
        // the correct action is hardcode subtract 8 hours
        const createTime = dayjs(session.inserted_at).subtract(8, 'hours');
        // may be +1s difference
        if (createTime.diff(dayjs(truesession.metadata['source-create-time']), 'second') > 1){
            console.log(`alt3: dsession ${filename} create time not same as true`);
        } else { matchCount += 1; }
        const updateTime = dayjs(session.updated_at).subtract(8, 'hours');
        const trueUpdateTime = dayjs(truesession.metadata['source-update-time'] ?? truesession.metadata['source-create-time']);
        if (updateTime.diff(trueUpdateTime, 'second') > 1 || updateTime.diff(trueUpdateTime, 'second') < -1) {
            console.log(`alt3: dsession ${filename} update time not same as true`);
        } else { matchCount += 1; }

        for (const message of dmessages.filter(m => m.session_id == session.id)) {
            const truemessage = truesession.messages.find(m => m.id == message.message_id);
            if (!truemessage) {
                console.log(`alt3: dsession ${filename} message ${message.message_id} not found in true`);
            }
            if (truemessage.role != message.role.toLowerCase()) {
                console.log(`alt3: dsession ${filename} message ${message.message_id} role not same`);
            } else { matchCount += 1; }
            if (truemessage.parentId && message.parent_id != truemessage.parentId) {
                console.log(`alt3: dsession ${filename} message ${message.message_id} parent id not same`);
            } else { matchCount += 1; }

            if (message.thinking_content) {
                const thinkingBlock = truemessage.content.find(c => c.kind == 'think');
                if (message.thinking_content.trim().split('\n').map(v => v.trimEnd()).join('\n') != thinkingBlock.value) {
                    console.log(`alt3: dsession ${filename} message ${message.message_id} thinking content not same`);
                } else { matchCount += 1; }
            }
            const textBlock = truemessage.content.find(c => c.kind == 'text');
            if (message.content.trim().split('\n').map(v => v.trimEnd()).join('\n') != textBlock.value) {
                console.log(`alt3: dsession ${filename} message ${message.message_id} content not same`);
            } else { matchCount += 1; }

            const metadata = truemessage.role == 'assistant' ? truemessage.response : truemessage.metadata;
            if ((message.thinking_enabled.data[0] == 1) != (metadata['thinking-enabled'] === true)) {
                console.log(`alt3: dsession ${filename} message ${message.message_id} thinking enabled not same`);
            } else { matchCount += 1; }
            if ((message.search_enabled.data[0] == 1) != (metadata['search-enabled'] === true)) {
                console.log(`alt3: dsession ${filename} message ${message.message_id} search enabled not same`);
            } else { matchCount += 1; }
            if (message.accumulated_token_usage && metadata['accumulated-token-usage'] != message.accumulated_token_usage) {
                console.log(`alt3: dsession ${filename} message ${message.message_id} accumulated token usage not same`);
            } else { matchCount += 1; }

            const createTime = dayjs(message.inserted_at).subtract(8, 'hours');
            // may be +1s difference
            if (createTime.diff(dayjs(metadata['create-time']), 'second') > 1 || createTime.diff(dayjs(metadata['create-time']), 'second') < -1){
                console.log(`alt3: dsession ${filename} message ${message.message_id} create time not same`);
            } else { matchCount += 1; }
        }
    }
    console.log(dsessions.length, dmessages.length, matchCount);
}
// await readalt3();

// source 6, vscode copilot sessions from workspace storage
// note this is the old storage format of vscode github copilot plugin, at the time of
// writing, the directories and json files is merged into vscdb sqlite database file not outside it

interface Session6 {
    version: 3,
    sessionId: string,
    initialLocation: 'panel',
    isImported: false,
    customTitle?: string,
    creationDate: number,
    lastMessageDate: number,
    requesterUsername: string,
    requesterAvatarIconUri?: any,
    responderUsername: string,
    responderAvatarIconUri?: any,

    requests: Request6[],
    // append these properties to use this as return type
    workspaceId?: string,
    workspacePath?: string,
}
interface Request6 {
    requestId: string,
    timestamp: number,
    isCanceled: false,
    modelId?: string,
    slashCommand?: {
        name: 'explain',
        description: 'Explain how the code in your active editor works',
        disambiguation: {
            category: 'explain',
            description: 'Explain how the code in your active editor works',
            examples: "Write an explanation for the code above as paragraphs of text."[],
        }[],
    },
    confirmation?: 'Enable' | 'Pause' | 'Continue',
    // no data
    followups?: [],
    agent?: { id: string },
    codeCitations: {
        kind: 'codeCitation',
        value: {
            scheme: 'https',
            authority: 'github.com',
            path: string,
        },
        license: string,
        snippet: string,
    }[],
    // no data
    responseMarkdownInfo?: [],
    variableData: {
        variables: {
            kind: 'file',
            id: string,
            name: string,
            value: any,
            modelDescription?: string,
        }[],
    },
    contentReferences: {
        kind: 'reference',
        reference: any,
        options?: { isFromTool: false },
    }[],
    message: {
        text: string,
        parts: ({
            range: { start: number, endInclusive: number },
            editorRange: { startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number },
        } & (
            | { kind: 'text', text: string }
            | { kind: 'agent', agent: any }
            | { kind: 'slash', slashCommand: any }
            | { kind: 'subcommand', command: any }
        ))[],
    },
    responseId: string,
    response: (
        | {
            value: string,
            supportThemeIcons: false,
            supportHtml: false,
            isTrusted?: any,
            baseUri?: any,
            uris?: any,
        }
        | { kind: 'inlineReference', inlineReference: any, resolveId?: string }
        | { kind: 'codeblockUri', uri: any, isEdit?: true }
        | { kind: 'thinking', value: string }
        | { kind: 'progressMessage', content: { value: string } }
        | { kind: 'warning', content: { value: string } }
        | { kind: 'command' }
        | { kind: 'markdownVuln' }
        | { kind: 'undoStop', id: string }
        | { kind: 'confirmation', title: string, message: string }
        | { kind: 'progressTaskSerialized', content: { value: string }, progress: [] }
        | { kind: 'prepareToolInvocation', toolName: string }
        | {
            kind: 'toolInvocationSerialized',
            toolId: string,
            toolCallId: string,
            isComplete: true,
            isConfirmed: true,
            invocationMessage: string | { value: string },
            presentation?: string,
            pastTenseMessage?: { value: string },
        }
        | { kind: 'textEditGroup', done: true, uri: any, edits: { text: string, range: any }[][] }
    )[],
    result: {
        timings: { firstProgress: number, totalElapsed: number },
        details?: string,
        metadata: {
            modelMessageId: string,
            responseId: string,
            sessionId: string,
            agentId: string,
            command?: 'explain',
            maxToolCallsExceeded?: true,
            codeBlocks?: {
                code: string,
                language: string,
                markdownBeforeBlock: string,
                resource?: any,
            }[],
            renderedUserMessage?: [{ type: 1, text: string }, { type: 3, cacheType: 'ephemeral'}],
            renderedGlobalContext?: [{ type: 1, text: string }, { type: 3, cacheType: 'ephemeral'}],
            toolCallRounds?: {
                id: string,
                statefulMarker?: string,
                thinking?: {
                    id: string,
                    text: string,
                    encrypted: string,
                    tokens: number,
                },
                // no data
                toolInputRetry: null,
                response: string,
                toolCalls: { id: string, name: string, arguments: string }[],
            }[],
            toolCallResults?: Record<string, any>,
        },
    },
}

async function read6() {
    let matchCount = 0;

    // 1. collect all files
    interface WorkspaceFiles {
        backupId: string,
        // workspace id is the guid folder names at top level of the workspacestorage folder
        id: string,
        // workspace path is in workspace.json at top level of workspace folder, it may be
        // - a normal local file system path, file://
        // - a .code-workspace file path
        // - remote folder (vscode-remote://wsl%2Bubuntu-24.04/home/)
        // - remote folder over mounted files? (vscode-remote://wsl%2Bubuntu-24.04/mnt/c/Users/)
        // - dev container (vscode-remote://dev-container%2Bverylonghexhere/volume)
        // - attached container (vscode-remote://attached-container%2Bveryverylonghexhere/x)
        path: string,
        sessions: SessionFiles[],
    }
    interface SessionFiles {
        // session id is session file names in chatSessions folder
        id: string,
        // session file content
        content: any,
        // session state.json file content in chatEditingSessions/<session-id> folder
        state: any,
        // content file name and content in chatEditingSessions/<session-id>/contents folder
        contents: [string, string][],
    }

    const allBackupIds = ['20250813', '20251022'];
    const baseBaseDirectory = '/workspaces/vscode-workspace-storage-';
    const allWorkspaceFiles: WorkspaceFiles[] = [];

    for (const backupId of allBackupIds) {
        const baseDirectory = baseBaseDirectory + backupId;
        for (const entry of await fs.readdir(baseDirectory, { withFileTypes: true })) {
            if (!entry.isDirectory()) { continue; }

            const workspaceId = entry.name;
            const workspaceJsonPath = path.join(baseDirectory, workspaceId, 'workspace.json');
            if (!npfs.existsSync(workspaceJsonPath)) { continue; }

            // this json only include one property, folder or workspace,
            const workspaceJsonText = await fs.readFile(workspaceJsonPath, 'utf-8');
            const workspaceJsonProperties = Object.entries(JSON.parse(workspaceJsonText));
            // RESULT: no unexpected schema
            if (workspaceJsonProperties.length != 1) {
                console.log(`${backupId}/${workspaceId} workspace.json unexpected structure? ${workspaceJsonText}`);
                continue;
            } else if (workspaceJsonProperties[0][0] != 'folder' && workspaceJsonProperties[0][0] != 'workspace') {
                console.log(`${backupId}/${workspaceId} workspace.json unknown property name? ${workspaceJsonText}`);
                continue;
            }
            const workspacePath = workspaceJsonProperties[0][1] as string;

            // ignore no chatSessions workspace as they are not related to this migration work
            const chatSessionsPath = path.join(baseDirectory, workspaceId, 'chatSessions');
            if (!npfs.existsSync(chatSessionsPath)) { continue; }

            const sessions: SessionFiles[] = [];
            for (const filename of await fs.readdir(chatSessionsPath)) {
                // lazy to parse guid here, just check by length
                if (filename.length != 41 || !filename.endsWith('.json')) { continue; }
                const sessionId = filename.substring(0, 36);
                // RESULT: no json parse error
                const sessionFileContent = JSON.parse(await fs.readFile(path.join(chatSessionsPath, filename), 'utf-8'));

                const chatEditingSessionPath = path.join(baseDirectory, workspaceId, 'chatEditingSessions', sessionId);
                // RESULT: no json parse error, this also implies files exists
                const stateFileContent = JSON.parse(await fs.readFile(path.join(chatEditingSessionPath, 'state.json'), 'utf-8'));
                const contents: [string, string][] = [];
                // RESULT: no unexpected file structure
                for (const filename of await fs.readdir(path.join(chatEditingSessionPath, 'contents'))) {
                    contents.push([filename, await fs.readFile(path.join(chatEditingSessionPath, 'contents', filename), 'utf-8')]);
                }
                sessions.push({ id: sessionId, content: sessionFileContent, state: stateFileContent, contents });
            }
            // RESULT: none
            if (sessions.length == 0) {
                console.log(`${backupId}/${workspaceId} have chatSessions directory but no sessions?`); continue;
            }
            sessions.sort((s1, s2) => Buffer.from(s1.id).compare(Buffer.from(s2.id)));
            allWorkspaceFiles.push({ backupId, id: workspaceId, path: workspacePath, sessions });
        }
    }
    // workspaceFiles.forEach(f => console.log(`${f.backupId}/${f.id}: ${f.path}, ${f.sessions.map(s => s.id)}`));

    // 2. cross backup relationships
    //    according to following results, backup1 is completely included in backup2
    for (const workspaceId of allWorkspaceFiles.map(w => w.id).filter((e, i, a) => a.indexOf(e) == i)) {
        const records = allWorkspaceFiles.filter(w => w.id == workspaceId);

        if (records.length != 1 && records.length != 2) {
            throw new Error("don't forget this part is assuming backup count is 2!");
        } else if (records.length == 1) {
            // RESULT: none
            if (records[0].backupId == allBackupIds[0]) {
                console.log(`${workspaceId}: only appear in 1 backup but is backup1?`);
            }
            continue;
        }
        const [backup1, backup2] = records;
    
        // RESULT: some
        // console.log(`${workspaceId}: appears in multiple backups`);
        // RESULT: none
        if (backup1.path != backup2.path) {
            console.log(`${workspaceId}: have different path in different backups`);
        }
        // if (records.length > 1) { console.log(workspaceId, [record1.path, record2.path]); }

        // RESULT: 1 workspace, 1 session in backup2 not in backup1, this mean all session id in backup1 is in backup2
        if (backup1.sessions.length != backup2.sessions.length || backup1.sessions.some((s1, i) => s1.id != backup2.sessions[i].id)) {
            const in1not2 = backup1.sessions.filter(s1 => !backup2.sessions.some(s2 => s2.id == s1.id)).map(s => s.id);
            const in2not1 = backup2.sessions.filter(s2 => !backup1.sessions.some(s1 => s1.id == s2.id)).map(s => s.id);
            console.log(`${workspaceId}: session list difference`, in1not2, in2not1);
        } else { matchCount += 1; }

        for (const sessionFiles2 of backup2.sessions) {
            const sessionId = sessionFiles2.id;
            const sessionFiles1 = backup2.sessions.find(s => s.id == sessionId);
            if (!sessionFiles1) { /* skip the previous exception */ continue; }

            // RESULT: none
            if (sessionFiles1.content != sessionFiles2.content) {
                console.log(`${workspaceId}/${sessionId}: have different content`);
            } else { matchCount += 1; }
            // RESULT: none
            if (sessionFiles1.state != sessionFiles2.state) {
                console.log(`${workspaceId}/${sessionId}: have different chatEditingSessions/state.json`);
            } else { matchCount += 1; }
            
            // RESULT: none
            const contents1 = sessionFiles1.contents.sort((c1, c2) => c1[0].localeCompare(c2[0]));
            const contents2 = sessionFiles2.contents.sort((c1, c2) => c1[0].localeCompare(c2[0]));
            if (contents1.length != contents2.length || contents1.some((c1, i) => c1[0] != contents2[i][0] || c1[1] != contents2[i][1])) {
                console.log(`${workspaceId}/${sessionId}: have different chatEditingSessions/contents`);
            } else { matchCount += 1; }
        }
        // const backupId = records[records.length - 1].backupId;
        // workspace2s.push({ id: workspaceId, path: records[0].path, backupId, sessions: sessionIds });
    }
    const workspaces = allWorkspaceFiles.filter(w => w.backupId == allBackupIds[1]);
    // RESULT: 26 workspaces, 99 sessions
    console.log(workspaces.length, workspaces.reduce((acc, w) => acc + w.sessions.length, 0),
        // by the way, session id is unique
        workspaces.reduce((acc, w) => acc.concat(w.sessions.map(s => s.id)), []).filter((e, i, a) => a.indexOf(e) == i).length, matchCount);

    // 3. session json file schema
    matchCount = 0;
    const agentIdToContent: Record<string, any> = {};
    const blockTypeToCount: Record<string, number> = {};

    for (const [workspace, sessionFiles] of workspaces
        .reduce<[WorkspaceFiles, SessionFiles][]>((acc, w) => acc.concat(w.sessions.map(s => [w, s] as const)), [])
    ) {
        const session = sessionFiles.content as Session6;
        const header = `${workspace.id}/${session.sessionId}`;

        const actualPropertyNames = Object.keys(session).sort((a, b) => a.localeCompare(b))
            // these seems optional
            .filter(k => k != 'requesterAvatarIconUri' && k != 'responderAvatarIconUri' && k != 'customTitle');
        const expectPropertyNames = [
            'version', 'requesterUsername', 'responderUsername',
            'initialLocation', 'requests', 'sessionId', 'creationDate', 'isImported', 'lastMessageDate',
        ].sort((a, b) => a.localeCompare(b));
        // RESULT: all expected
        if (actualPropertyNames.length != expectPropertyNames.length || expectPropertyNames.some((e, i) => actualPropertyNames[i] != e)) {
            console.log(`${header}: session unexpected properties`);
        }

        // RESULT: at the time of backups, they are all version 3
        if (session.version != 3) {
            console.log(`${header}: session version not 3`);
        } else { matchCount += 1; }
        // RESULT: ok
        if (session.sessionId != sessionFiles.id) {
            console.log(`${header}: session file name not same as content .sessionId`);
        } else { matchCount += 1; }

        // RESULT: all this value, where is inline chat?
        if (session.initialLocation != 'panel') {
            console.log(`${header}: unexpected initial location ${session.initialLocation}`);
        } else { matchCount += 1; }
        // RESULT: none
        if (session.isImported) {
            console.log(`${header}: session is imported`);
        }
        // RESULT: none
        if (session.customTitle && (typeof session.customTitle != 'string' || !session.customTitle)) {
            console.log(`${header}: customt tile is not string or is empty string`);
        } else { matchCount += 1; }

        const createTime = dayjs(session.creationDate);
        const updateTime = dayjs(session.lastMessageDate);
        // RESULT: none
        if (createTime.isAfter(updateTime)) {
            console.log(`${header}: update time is before create time`);
        } else { matchCount += 1; }
        // console.log(`${header}: time ${createTime.format('YYYY-MM-DD HH:mm:ssZ')} ${updateTime.format('YYYY-MM-DD HH:mm:ssZ')}`);

        // by the way: 202505:13, 202506:41, 202507:16, 202508:28, 202509:1 <- this 202509 is the exact data not in backup1 but in backup2
        // const month = createTime.format('YYYYMM');
        // if (month in monthlyDistribution) { monthlyDistribution[month] += 1; } else { monthlyDistribution[month] = 1; }

        // RESULT: always my github user name
        if (session.requesterUsername && session.requesterUsername != 'FreskyZ') {
            console.log(`${header}: unexpected user name`);
        } else { matchCount += 1; }
        // RESULT: always my github user name
        if (session.responderUsername && session.responderUsername != 'GitHub Copilot') {
            console.log(`${header}: unexpected responder user name ${session.responderUsername}`);
        } else { matchCount += 1; }
        // RESULT: some, lazy to investigate the 4 requester/responder properties' nullness
        if (!!session.requesterUsername != !!session.responderUsername) {
            // console.log(`${header}: requester and responder user name nullness not same`);
        }

        // RESULT: many, how are these sessions created?
        if (session.requests.length == 0) {
            // console.log(`${header}: is empty`);
            // RESULT: many, not relavent
            // if (session.requesterUsername) {
            //     console.log(`${header}: is empty but has request user name`);
            // }
            // RESULT: many, not relavent
            // if (session.responderUsername) {
            //     console.log(`${header}: is empty but has respond user name`);
            // }
            // RESULT: none
            if (sessionFiles.contents.length) {
                console.log(`${header}: is empty but chatEditingSessions/contents`);
            }
            // console.log(sessionFiles.state);
        }
        session.workspaceId = workspace.id;
        session.workspacePath = workspace.path;

        for (const [request, requestIndex] of session.requests.map((r, i) => [r, i] as const)) {
            const header = `${workspace.id}/${session.sessionId}/request#${requestIndex}`;

            // RESULT: no unexpected schema, many properties are optional
            const actualPropertyNames = Object.keys(request).sort((a, b) => a.localeCompare(b))
                .filter(k => k != 'responseMarkdownInfo' && k != 'confirmation'
                    && k != 'modelId' && k != 'agent' && k != 'followups' && k != 'slashCommand');
            const expectPropertyNames = [
                'requestId', 'message', 'variableData', 'response', 'responseId', 'result',
                'isCanceled', 'contentReferences', 'codeCitations', 'timestamp',
            ].sort((a, b) => a.localeCompare(b));
            if (actualPropertyNames.length != expectPropertyNames.length || expectPropertyNames.some((e, i) => actualPropertyNames[i] != e)) {
                console.log(`${header}: unexpected properties, ${actualPropertyNames}, ${expectPropertyNames}`);
            }
            // RESULT: none
            if (!request.requestId) {
                console.log(`${header}: missing request id`);
            }

            const createTime = dayjs(request.timestamp);
            // console.log(header, createTime.format('YYYY-MM-DD HH:mm:ssZ'));

            // RESULT: none
            if (request.isCanceled) {
                console.log(`${header}: is canceled`);
            }
            // RESULT: values may be these, I really have used some gpt and claude at that time
            if (request.modelId && ![
                'copilot/gpt-4.1',
                'copilot/gpt-5-mini',
                'copilot/gpt-5-codex',
                'github.copilot-chat/gpt-4.1',
                'github.copilot-chat/gpt-4o',
                'github.copilot-chat/claude-3.7-sonnet-thought',
                'github.copilot-chat/claude-sonnet-4',
            ].includes(request.modelId)) {
                console.log(`${header}: unknown model id ${request.modelId}`);
            } else { matchCount += 1; }
            
            // RESULT: 2 requests have .slashCommand, all values are same
            // it's reasonable to include the leading slash command in request data,
            // but why do you put the description and duplicate an name + description and include an example in my disk storage?
            if (request.slashCommand
                && (request.slashCommand.name != 'explain'
                || request.slashCommand.description != 'Explain how the code in your active editor works'
                || request.slashCommand.disambiguation.length != 1
                || request.slashCommand.disambiguation[0].category != 'explain'
                || request.slashCommand.disambiguation[0].description != 'Explain how the code in your active editor works'
                || request.slashCommand.disambiguation[0].examples.length != 1
                || request.slashCommand.disambiguation[0].examples[0] != 'Write an explanation for the code above as paragraphs of text.')
            ) {
                console.log(`${header}: unexpected slash command`);
            }
            // RESULT: none, what does these string values mean?
            if (request.confirmation && !['Enable', 'Pause', 'Continue'].includes(request.confirmation)) {
                console.log(`${header}: unexpected confirmation ${request.confirmation}`);
            } else { matchCount += 1; }
            // RESULT: none
            if (request.followups && request.followups.length) {
                console.log(`${header}: has followups ${request.followups}`);
            }

            // why do you put a very large object that is mostly same on my disk?
            // TODO you can learn some prompts here
            if (request.agent) {
                // RESULT: some
                // console.log(request.agent);
                // RESULT: these values
                if (![
                    'github.copilot.default',
                    // what's the relationship between editor and editsagent?
                    'github.copilot.editor',
                    'github.copilot.editsAgent',
                    // this is @vscode
                    'github.copilot.vscode',
                    // this is @workspace
                    'github.copilot.workspace',
                    'setup.chat',
                ].includes(request.agent.id)) {
                    console.log(`${header}: unexpected agent id`, request.agent.id);
                }
                if (request.agent.id in agentIdToContent) {
                    if (JSON.stringify(request.agent) != agentIdToContent[request.agent.id]) {
                        // RESULT: some, about 20%? may be version difference
                        // console.log(`${header} agent id ${request.agent.id} not same as previous same id content`);
                    } else { matchCount += 1; }
                } else {
                    agentIdToContent[request.agent.id] = JSON.stringify(request.agent);
                }
            }

            // RESULT: 2 requests 3 citations, referencing real github repository source code
            // UPDATE: 3 links, 1 404, 2 into repositories with total star 0, how do you find these?
            // TODO remember to record these values for fun
            if (request.codeCitations && request.codeCitations.length) {
                // console.log(header, request.codeCitations);
                for (const codeCitation of request.codeCitations) {
                    // console.log(encodeURI(`https://github.com${codeCitation.value.path}`));
                }
            }

            // RESULT: many
            if (!request.responseMarkdownInfo) {
                // console.log(`${header}: no responsemarkdowninfo`);
            }
            // RESULT: none
            if (request.responseMarkdownInfo && !Array.isArray(request.responseMarkdownInfo)) {
                console.log(`${header}: responsemarkdowninfo is not array`, request.responseMarkdownInfo);
            }
            // RESULT: none
            if (request.responseMarkdownInfo && request.responseMarkdownInfo.length) {
                console.log(`${header}: responsemarkdowninfo has data`, request.responseMarkdownInfo);
            }

            // RESULT: none
            if (!request.variableData) {
                console.log(`${header}: missing variabledata`);
            }
            // RESULT: no unexpected structure
            if (Object.keys(request.variableData).length != 1) {
                console.log(`${header}: variabledata unexpected structure?`, request.variableData);
            }
            // RESULT: no unexpected structure
            if (Object.keys(request.variableData)[0] != 'variables') {
                console.log(`${header}: variabledata unexpected structure? (2)`, request.variableData);
            }
            // RESULT: no unexpected structure, 37 variables
            for (const [variable, variableIndex] of request.variableData.variables.map((v, i) => [v, i] as const)) {
                // console.log(variable);
                if (variable.kind != 'file') {
                    console.log(`${header}: variable ${variableIndex} kind not file`);
                } else { matchCount += 1; }
                if (typeof variable.id != 'string') {
                    console.log(`${header}: variable ${variableIndex} id not string`);
                } else { matchCount += 1; }
                if (typeof variable.name != 'string') {
                    console.log(`${header}: variable ${variableIndex} name not string`);
                } else { matchCount += 1; }
                if (variable.modelDescription && typeof variable.modelDescription != 'string') {
                    console.log(`${header}: variable ${variableIndex} model description not string`);
                } else { matchCount += 1; }
                // this path should be enough if the variable will be recorded
                if (typeof (variable.value.path || variable.value.uri.path) != 'string') {
                    console.log(`${header}: variable ${variableIndex} path not string`);
                } else { matchCount += 1; }
            }

            // RESULT: no unexpected structure
            if (request.contentReferences) {
                for (const [reference, referenceIndex] of request.contentReferences.map((r, i) => [r, i] as const)) {
                    // console.log(reference);
                    const properties = Object.keys(reference)
                        .filter(k => k != 'options').sort((k1, k2) => k1.localeCompare(k2));
                    if (properties.length != 2 || properties[0] != 'kind' || properties[1] != 'reference') {
                        console.log(`${header}: contentreferences[${referenceIndex}] unknown structure`, properties);
                    } else { matchCount += 1; }
                    if (reference.kind != 'reference') {
                        console.log(`${header}: contentreferences[${referenceIndex}] kind not reference`);
                    } else { matchCount += 1; }
                    // console.log(reference.reference.path || reference.reference.uri.path);
                    if (typeof (reference.reference.path || reference.reference.uri.path) != 'string') {
                        console.log(`${header}: contentreferences[${referenceIndex}] path not string`);
                    } else { matchCount += 1; }
                    if (reference.options && reference.options.isFromTool !== false) {
                        console.log(`${header}: contentreferences[${referenceIndex}] options.isfromtool not false`);
                    } else { matchCount += 1; }
                    // RESULT: 1 in many contentreferences, they are irrelavent, so what's this information?
                    if (sessionFiles.contents.length) {
                        // console.log(`${header}: contentreferences[${referenceIndex}] has chatEditignSessions/contents`);
                    }
                }
            }
            
            // RESULT: all have value
            if (!request.message) {
                console.log(`${header}: missing message`);
            } else { matchCount += 1; }
            // RESULT: only 2 properties
            const actualProperties = Object.keys(request.message).sort((a, b) => a.localeCompare(b));
            if (actualProperties.length != 2 && actualProperties[0] != 'parts' && actualProperties[1] != 'text') {
                console.log(`${header}: message unknown structure?`);
            } else { matchCount += 1; }
            // RESULT: all have value
            if (typeof request.message.text != 'string' || !request.message.text.length) {
                console.log(`${header}: message.text not string or is empty?`);
            } else { matchCount += 1; }
            // RESULT: all have value
            if (!Array.isArray(request.message.parts) || !request.message.parts.length) {
                console.log(`${header}: message.parts not array or is empty?`);
            } else { matchCount += 1; }
            for (const [part, partIndex] of request.message.parts.map((p, i) => [p, i] as const)) {
                // RESULT: 4 kinds
                if (!['text', 'agent', 'subcommand', 'slash'].includes(part.kind)) {
                    console.log(`${header}: message part kind unexpected ${part.kind}`);
                } else { matchCount += 1; }
                // RESULT: no unexpected structure
                const actualPropertyNames = Object.keys(part).sort((a, b) => a.localeCompare(b));
                const expectPropertyNames = ['kind', 'range', 'editorRange',
                    part.kind == 'text' ? 'text' : part.kind == 'agent' ? 'agent' : part.kind == 'subcommand' ? 'command' : 'slashCommand',
                ].sort((a, b) => a.localeCompare(b));
                if (actualPropertyNames.length != expectPropertyNames.length || expectPropertyNames.some((e, i) => actualPropertyNames[i] != e)) {
                    console.log(`${header} part ${partIndex} unexpected properties, ${actualPropertyNames}, ${expectPropertyNames}`);
                }

                // for agent, all part.agent is exactly same as request.agent, include property order
                if (part.kind == 'agent' && JSON.stringify(part.agent) != JSON.stringify(request.agent)) {
                    console.log(`${header} part ${partIndex} part.agent not same as request.agent`);
                // for subcommand, all part.command is exactly same as request.slashCommand
                // note it's kind=subcommand, property is part.command, not kind=slashcommand, not part.slashCommand
                } else if (part.kind == 'subcommand' && JSON.stringify(part.command) != JSON.stringify(request.slashCommand)) {
                    console.log(`${header} part ${partIndex} part.command not same as request.slashCommand`);
                }
                // but for kind=slash, it is not same as request.slashCommand, as the only session to contain this value is 202505,
                // I think it is the old plugin version, note that /help command is no longer available in current version of vscode

                // additionally, message.text is constructed from parts that
                // agent part become @something and subcommand part become /somecommand and text become text
                // lazy to validate that, use message.text is super enough for this migration work
                // RESULT: none
                if (part.kind == 'text' && !request.message.text.includes(part.text)) {
                    console.log(`${header} part ${partIndex} request.message.parts.text not in request.message.text`);
                }
            }
            
            // RESULT: none
            if (!request.response) {
                console.log(`${header}: missing response`);
            }
            // RESULT: all not empty
            if (!Array.isArray(request.response) || !request.response.length) {
                console.log(`${header}: response is not array or is empty`);
            }
            // block.kind is very format-related and ui-related (click to goto somewhere, etc.)
            // TODO if request.result is better, use that
            for (const [block, blockIndex] of request.response.map((b, i) => [b, i] as const)) {
                if ('kind' in block && !['inlineReference', 'thinking', 'progressMessage', 'confirmation',
                    'warning', 'command', 'codeblockUri', 'progressTaskSerialized', 'undoStop',
                    'markdownVuln', 'toolInvocationSerialized', 'prepareToolInvocation', 'textEditGroup'].includes(block.kind)
                ) {
                    console.log(`${header}/block#${blockIndex}: unknown kind ${block.kind}`);
                }

                // RESULT:
                //   (undefined): 281,
                //   inlineReference: 72,
                //   toolInvocationSerialized: 63,
                //   codeblockUri: 46,
                //   textEditGroup: 37,
                //   undoStop: 34,
                //   prepareToolInvocation: 30,
                //   progressMessage: 23,
                //   warning: 6,
                //   command: 4,
                //   thinking: 4,
                //   confirmation: 3,
                //   markdownVuln: 2,
                //   progressTaskSerialized: 1,
                // if (block.kind in blockTypeToCount) { blockTypeToCount[block.kind] += 1; }
                // else { blockTypeToCount[block.kind] = 1; }

                // why `!block.kind` does not recognize the variant?
                // why `!('kind' in block)` does not recognize the variant?
                if ('supportHtml' in block) {
                    // console.log(block);
                    const properties = Object.keys(block)
                        .filter(k => k != 'kind' && k != 'baseUri' && k != 'uris' && k != 'isTrusted').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    if (properties.length != 3 || properties[0] != 'supportHtml'
                        || properties[1] != 'supportThemeIcons' || properties[2] != 'value'
                    ) {
                        console.log(`${header}/block#${blockIndex}: kind=undefined unexpected structure`, properties);
                    }
                    // RESULT: none
                    if (typeof block.value != 'string' || !block.value) {
                        console.log(`${header}/block#${blockIndex}: kind=undefined value is not string or is empty`);
                    } else { matchCount += 1; }
                    // RESULT: none
                    if (block.supportThemeIcons) {
                        console.log(`${header}/block#${blockIndex}: kind=undefined support theme icons`);
                    } else { matchCount += 1; }
                    // RESULT: none
                    if (block.supportHtml) {
                        console.log(`${header}/block#${blockIndex}: kind=undefined support html`);
                    } else { matchCount += 1; }
                    // RESULT: some, what does a istrusted flag or object in a response text block mean?
                    if (typeof block.isTrusted != 'undefined') {
                        // console.log(`${header}/block#${blockIndex}: kind=undefined is trusted`, block);
                    }
                    // RESULT: many, what does uri in a response text block mean?
                    if (block.baseUri) {
                        // console.log(block);
                    }
                    // RESULT: 1 block has real uri elements in uris, all other is empty object
                    if (block.uris && Object.keys(block.uris).length) {
                        // console.log(block);
                    }

                // why is thinking block count so small?
                // why is thinking content so short? oh, that's because those closed models do not provide full reasoning content
                // why is thinking content can be empty?
                } else if (block.kind == 'thinking') {
                    const properties = Object.keys(block).filter(k => k != 'kind').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    if (properties.length != 2 || properties[0] != 'id' || properties[1] != 'value') {
                        // console.log(`${header}/block#${blockIndex}: kind=thinking unexpected structure`, properties);
                    }
                    // RESULT: none
                    if (typeof block.value != 'string') {
                        console.log(`${header}/block#${blockIndex}: kind=thinking value is not string`);
                    } else { matchCount += 1; }

                } else if (block.kind == 'inlineReference') {
                    const properties = Object.keys(block).filter(k => k != 'kind' && k != 'resolveId').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    if (properties.length != 1 || properties[0] != 'inlineReference') {
                        console.log(`${header}/block#${blockIndex}: kind=inlineReference unexpected structure`, properties);
                    }
                    // RESULT: none
                    if (typeof (block.inlineReference.name || block.inlineReference.path) != 'string') {
                        console.log(`${header}/block#${blockIndex}: kind=inlineReference path is not string or is empty`);
                    } else { matchCount += 1; }
                    // TODO also check this choice in concat result
                    // console.log(block.inlineReference.name || block.inlineReference.path);
                    // RESULT: some, what does this guid mean?
                    // if (block.resolveId) { console.log(block.resolveId); }

                } else if (block.kind == 'codeblockUri') {
                    const properties = Object.keys(block)
                        .filter(k => k != 'kind' && k != 'isEdit').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    if (properties.length != 1 || properties[0] != 'uri') {
                        console.log(`${header}/block#${blockIndex}: kind=codeblockUri unexpected structure`, properties);
                    }
                    // RESULT: none
                    if (typeof block.uri.path != 'string' || !block.uri.path) {
                        console.log(`${header}/block#${blockIndex}: kind=codeblockUri uri.path is not string or is empty`);
                    } else { matchCount += 1; }
                    // RESULT: 1 block, this seems referencing a non-exist file in path
                    if (typeof block.isEdit != 'undefined' && !block.isEdit) {
                        console.log(`${header}/block#${blockIndex}: kind=codeblockUri is edit but is not edit`);
                    }

                } else if (block.kind == 'progressMessage') {
                    const properties = Object.keys(block)
                        .filter(k => k != 'kind').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    if (properties.length != 1 || properties[0] != 'content') {
                        console.log(`${header}/block#${blockIndex}: kind=progressMessage unexpected structure`, properties);
                    }
                    // RESULT: this is same as the text block (kind=undefined), lazy to write again
                    // why do you need a supportthemeicons, supporthtml and uri in progressmessage's content?
                    // additionally, all flags are false all uris are empty in real data
                    const properties1 = Object.keys(block.content)
                        .filter(k => k != 'kind').sort((k1, k2) => k1.localeCompare(k2));
                    if (properties1.length != 1 || properties1[0] != 'value') {
                        // console.log(`${header}/block#${blockIndex}: kind=progressMessage unexpected structure (2)`, properties1);
                    }
                    // RESULT: none
                    // seems all system level message (I mean agent system, not system prompt),
                    // TODO so should be not used to construct response message?
                    if (block.content.value != 'Getting Copilot ready'
                        && block.content.value != 'Copilot is almost ready'
                        && block.content.value != 'Refining question to improve search accuracy.'
                        && block.content.value != 'Searching command and setting index....'
                        && block.content.value != 'Searching doc index...'
                    ) {
                        console.log(`${header}/block#${blockIndex}: kind=progressMessage unknown message`, block);
                    }

                } else if (block.kind == 'warning') {
                    const properties = Object.keys(block)
                        .filter(k => k != 'kind').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    if (properties.length != 1 || properties[0] != 'content') {
                        console.log(`${header}/block#${blockIndex}: kind=warning unexpected structure`, properties);
                    }
                    // same as progressMessage, same as kind=undefined, and in real data all flags are false
                    const properties1 = Object.keys(block.content)
                        .filter(k => k != 'kind').sort((k1, k2) => k1.localeCompare(k2));
                    if (properties1.length != 1 || properties1[0] != 'value') {
                        // console.log(`${header}/block#${blockIndex}: kind=warning unexpected structure (2)`, properties1, block);
                    }
                    // RESULT: none
                    if (block.content.value != 'Copilot took too long to get ready. Please ensure you are signed in to GitHub and that the extension `GitHub.copilot-chat` is installed and enabled.') {
                        console.log(`${header}/block#${blockIndex}: kind=warning unknown message`, block);
                    }

                // RESULT: all are opening vscode settings, generated from @vscode messages
                // and in real data the vscode setting name is present in preceding text block so no need to care about this
                } else if (block.kind == 'command') {
                    // console.log(header, block);
            
                // RESULT: some, why is there a markdown vulnerability block in response?
                } else if (block.kind == 'markdownVuln') {
                    // console.log(header, block);

                // RESULT: many, only have a .id, not sure what id, not found the id value in the session file?
                } else if (block.kind == 'undoStop') {
                    const properties = Object.keys(block)
                        .filter(k => k != 'kind').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    if (properties.length != 1 || properties[0] != 'id') {
                        console.log(`${header}/block#${blockIndex}: kind=undostop unexpected structure`, properties);
                    }
                    // RESULT: none
                    if (typeof block.id != 'string') {
                        console.log(`${header}/block#${blockIndex}: kind=undostop id is not string`);
                    }
                    // RESULT: all found, what does this mean?
                    if (!JSON.stringify(sessionFiles.state).includes(block.id)) {
                        console.log(`${header}/block#${blockIndex}: kind=undostop id not found in state.json`);
                    }

                // RESULT: 3 blocks
                // TODO use .title and .message if you want to collect this block
                // why block.kind==confirmation is not related to request.confirmation?
                } else if (block.kind == 'confirmation') {
                    // console.log(block);

                // RESULT: 1 occurance, the @workspace Enable: "Enable GPT-5-Codex (Preview) for all clients" session
                // TODO use .content.value if you are collecting this block
                } else if (block.kind == 'progressTaskSerialized') {
                    // console.log(block);

                // RESULT: just a name to display a message, no need to include
                } else if (block.kind == 'prepareToolInvocation') {
                    const properties = Object.keys(block)
                        .filter(k => k != 'kind').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    if (properties.length != 1 || properties[0] != 'toolName') {
                        console.log(`${header}/block#${blockIndex}: kind=prepareToolInvocation unexpected structure`, properties);
                    }
                    // RESULT: none
                    if (typeof block.toolName != 'string' || !block.toolName) {
                        console.log(`${header}/block#${blockIndex}: kind=prepareToolInvocation toolName is not string or is empty`);
                    }

                } else if (block.kind == 'toolInvocationSerialized') {
                    // console.log(header, block);
                    const actualProperties = Object.keys(block)
                        .filter(k => k != 'kind' && k != 'resultDetails' && k != 'pastTenseMessage').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    const expectProperties1 = ['toolId', 'toolCallId', 'isComplete',
                        'isConfirmed', 'presentation', 'invocationMessage'].sort((k1, k2) => k1.localeCompare(k2));
                    const expectProperties2 = ['toolId', 'toolCallId', 'isComplete',
                        'isConfirmed', 'invocationMessage'].sort((k1, k2) => k1.localeCompare(k2));
                    if (actualProperties.length == expectProperties1.length && !actualProperties.some((a, i) => expectProperties1[i] != a)) {
                        // RESULT: if is presentation-version, presentation and invocation message is string and non empty
                        if (typeof block.presentation != 'string' || !block.presentation) {
                            console.log(`${header}/block#${blockIndex}: kind=toolInvocationSerialized presentation is not string or is empty`);
                        } else { matchCount += 1; }
                        if (typeof block.invocationMessage != 'string' || !block.invocationMessage) {
                            console.log(`${header}/block#${blockIndex}: kind=toolInvocationSerialized invocationMessage is not string or is empty`);
                        } else { matchCount += 1; }
                    } else if (actualProperties.length == expectProperties2.length && !actualProperties.some((a, i) => expectProperties2[i] != a)) {
                        // RESULT: if is past-tense-version, pasttensemessage and invocationmessage is basic text block and value is non empty
                        if (typeof block.pastTenseMessage.value != 'string' || !block.pastTenseMessage.value) {
                            console.log(`${header}/block#${blockIndex}: kind=toolInvocationSerialized past tense message is not string or is empty`);
                        } else { matchCount += 1; }
                        if (typeof (block.invocationMessage as any).value != 'string' || !(block.invocationMessage as any).value) {
                            console.log(`${header}/block#${blockIndex}: kind=toolInvocationSerialized past tense message is not string or is empty`);
                        } else { matchCount += 1; }
                    } else {
                        console.log(`${header}/block#${blockIndex}: kind=toolInvocationSerialized unexpected structure`, actualProperties);
                    }
                    
                    // RESULT: ok, toolid is tool name
                    if (typeof block.toolId != 'string' || !block.toolId) {
                        console.log(`${header}/block#${blockIndex}: kind=toolInvocationSerialized tool id is not string or is empty`);
                    } else { matchCount += 1; }
                    // RESULT: ok
                    if (typeof block.toolCallId != 'string' || !block.toolCallId) {
                        console.log(`${header}/block#${blockIndex}: kind=toolInvocationSerialized tool call id is not string or is empty`);
                    } else { matchCount += 1; }
                    // RESULT: all true
                    if (!block.isComplete) {
                        console.log(`${header}/block#${blockIndex}: kind=toolInvocationSerialized is not complete`);
                    } else { matchCount += 1; }
                    // RESULT: all true
                    if (!block.isConfirmed) {
                        console.log(`${header}/block#${blockIndex}: kind=toolInvocationSerialized is not confirmed`);
                    } else { matchCount += 1; }
                    // TODO validate against data in request.result

                } else if (block.kind == 'textEditGroup') {
                    // console.log(header, block);
                    const properties = Object.keys(block)
                        .filter(k => k != 'kind').sort((k1, k2) => k1.localeCompare(k2));
                    // RESULT: no unexpected structure
                    if (properties.length != 3 || properties[0] != 'done' || properties[1] != 'edits' || properties[2] != 'uri') {
                        console.log(`${header}/block#${blockIndex}: kind=textEditGroup unexpected structure`, properties);
                    }
                    // RESULT: all true
                    if (!block.done) {
                        console.log(`${header}/block#${blockIndex}: kind=textEditGroup is not done`);
                    }
                    // RESULT: all have value
                    if (typeof block.uri.path != 'string' || !block.uri.path) {
                        console.log(`${header}/block#${blockIndex}: kind=textEditGroup path is not string or is empty`);
                    }
                    for (const [editElement, editIndex] of block.edits.map((e, i) => [e, i] as const)) {
                        // RESULT: last element is fixed length 0
                        // why do you put an empty element in the array? this operation looks very C and native style?
                        if (editIndex == block.edits.length - 1) {
                            if (editElement.length != 0) {
                                console.log(`${header}/block#${blockIndex}: kind=textEditGroup last edit element is not length 0`);
                            } else { matchCount += 1; }
                            continue;
                        }
                        // RESULT: non last element is fixed length 1
                        if (editElement.length != 1) {
                            console.log(`${header}/block#${blockIndex}: kind=textEditGroup edit element length is 1`);
                        } else { matchCount += 1; }
                        const edit = editElement[0];
                        // RESULT: all non empty
                        if (typeof edit.text != 'string' || !edit.text) {
                            console.log(`${header}/block#${blockIndex}: kind=textEditGroup edit.text is empty`);
                        }
                        // RESULT: some, some edits is overwriting
                        if (edit.range.startLineNumber != edit.range.endLineNumber || edit.range.startColumn != edit.range.endColumn) {
                            // console.log(`${header}/block#${blockIndex}: kind=textEditGroup edit.range is not a single position?`, edit);
                        }
                    }
                    // TODO what's the relationship between edits and edit file tools

                } else {
                    // RESULT: none
                    console.log(`${header}/block#${blockIndex}: unknown kind?`, block);
                }
            }
            
            // RESULT: all have value
            if (!request.result) {
                console.log(`${header}: missing result`);
            }
            // RESULT: 3 sessions are response is copilot take too long to get ready
            if (Object.keys(request.result).length == 0) {
                // console.log(`${header} result is empty`);
                continue;
            }

            const resultProperties = Object.keys(request.result).filter(k => k != 'details').sort((a, b) => a.localeCompare(b));
            // RESULT: 1 missing metadata: enable claude sonnet for all clients
            if (resultProperties[0] != 'metadata' || resultProperties[1] != 'timings') {
                console.log(`${header} result object unknown properties`, resultProperties);
                continue;
            }
            // RESULT: all valid
            if (typeof request.result.timings.firstProgress != 'number' || typeof request.result.timings.totalElapsed != 'number') {
                console.log(`${header} timing unknown structure`, request.result.timings);
            } else { matchCount += 1; }

            // RESULT: these values, the property called details is a string? values are consistent with request.modelId
            // GPT-4.1 • 0x
            // GPT-5 mini • 0x
            // GPT-5-Codex (Preview) • 1x
            if (request.result.details && typeof request.result.details != 'string') {
                console.log(`${header} details is not string`, request.result.details);
            }
            // if (request.result.details) { console.log(request.result.details, request.modelId); }

            const metadata = request.result.metadata;
            // RESULT: no unexpected structure
            const metadataProperties = Object.keys(metadata).filter(k =>
                k != 'renderedUserMessage' && k != 'renderedGlobalContext' && k != 'toolCallRounds'
                && k != 'toolCallResults' && k != 'command' && k != 'codeBlocks' && k != 'maxToolCallsExceeded'
            ).sort((a, b) => a.localeCompare(b));
            const expectProperties = [
                'modelMessageId', 'responseId', 'sessionId', 'agentId',
            ].sort((a, b) => a.localeCompare(b));
            if (metadataProperties.length != expectProperties.length || expectProperties.some((e, i) => metadataProperties[i] != e)) {
                console.log(`${header} result metadata unexpected properties, ${metadataProperties}, ${expectProperties}`);
            }

            // RESULT: 1, what does it mean by message.text is @agent Pause: "Continue to iterate?"?
            if (!metadata.modelMessageId) {
                console.log(`${header} result metadata missing model message id`);
            }
            // RESULT: all non empty
            if (metadata.modelMessageId && (typeof metadata.modelMessageId != 'string' || !metadata.modelMessageId)) {
                console.log(`${header} result metadata model message id is not string or is empty`);
            }

            // RESULT: all non empty
            if (typeof metadata.responseId != 'string' || !metadata.responseId) {
                console.log(`${header} result metadata response id is not string or is empty`);
            }
            // RESULT: none is same, completely irrelavent, and this value is not found in any other place in workspacestorage folder, why?
            if (metadata.responseId != request.responseId) {
                // console.log(`${header} request.result.metadata.responseid not same as request.responseid`, metadata.responseId, request.responseId);
            } else { matchCount += 1; }
            // RESULT: all non empty
            if (typeof metadata.sessionId != 'string' || !metadata.sessionId){
                console.log(`${header} result metadata session id is not string`);
            }
            // RESULT: none is same, completely irrelavent, and this value is not found in any other place in workspacestorage folder, why?
            if (metadata.sessionId != session.sessionId) {
                // console.log(`${header} request.result.metadata.sessionId is not same as sessionId`, metadata.sessionId, session.sessionId);
            } else { matchCount += 1; }

            // RESULT: all non empty
            if (typeof metadata.agentId != 'string' || !metadata.agentId) {
                console.log(`${header} missing agent id`);
            } else { matchCount += 1; }
            // RESULT: all same
            if (metadata.agentId != request.agent.id) {
                console.log(`${header} request.result.metadata.agentId not same as request.agent.id`);
            } else { matchCount += 1; }
            // RESULT: none, 2 requests have value, the 2 /explain
            if (metadata.command && metadata.command != 'explain') {
                console.log(`${header} request.result.metadata.command is other than explain`);
            } else { matchCount += 1; }
            // RESULT: none, 2 messages has true
            if (typeof metadata.maxToolCallsExceeded != 'undefined' && !metadata.maxToolCallsExceeded) {
                console.log(`${header} request.result.metadata.maxtoolscallsexceed but not maxtoolcallsexceed`);
            } else { matchCount += 1; }

            if (!metadata.codeBlocks || metadata.codeBlocks.length == 0) {
                // RESULT: many
                // console.log(`${header}: codeblocks is empty`);
            } else {
                // console.log(`${header} code blocks is not empty`);
                // but how is this referenced in response message?
                for (const block of metadata.codeBlocks) {
                    // RESULT: no unexpected structure
                    const actualProperties = Object.keys(block).filter(k => k != 'resource').sort((a, b) => a.localeCompare(b));
                    const expectProperties = [
                        'code', 'language', 'markdownBeforeBlock',
                    ].sort((a, b) => a.localeCompare(b));
                    if (actualProperties.length != expectProperties.length || expectProperties.some((e, i) => actualProperties[i] != e)) {
                        console.log(`${header} codeblock unexpected properties, ${actualProperties}, ${expectProperties}`);
                    }
                    // RESULT: all have value
                    if (typeof block.code != 'string' || !block.code) {
                        console.log(`${header} codeblock.code is not string or is empty`);
                    } else { matchCount += 1; }
                    // RESULT: all string, some is empty
                    if (typeof block.language != 'string') {
                        console.log(`${header} codeblock.language is not string or is empty`);
                    } else { matchCount += 1; }
                    // RESULT: all string, 1 is empty
                    if (typeof block.markdownBeforeBlock != 'string') {
                        console.log(`${header} codeblock.markdownBeforeBlock is not string or is empty`, block);
                    } else { matchCount += 1; }
                    // RESULT: all have path if have .resource
                    if (block.resource && (typeof block.resource.path != 'string' || !block.resource.path)) {
                        console.log(`${header} codeblock.resource.path is not string or is empty`, block);
                    } else { matchCount += 1; }
                }
            }

            // RESULT: 3 request has user no global
            if (metadata.renderedUserMessage && !metadata.renderedGlobalContext) {
                // console.log(`${header} renderedUserMessage and renderedGlobalContext don't appear at the same time`);
            }
            // RESULT: as expected, can I use this as user message?
            // by the way, ephemeral means very short lifetime if you ask
            if (metadata.renderedUserMessage) {
                if (!Array.isArray(metadata.renderedUserMessage)) {
                    console.log(`${header} renderedUserMessage is not array`);
                }
                if (metadata.renderedUserMessage.length != 2) {
                    console.log(`${header} renderedUserMessage is not length 2`);
                } else { matchCount += 1; }
                if (metadata.renderedUserMessage[0].type != 1) {
                    console.log(`${header} renderedUserMessage[0].type is not 1`);
                } else { matchCount += 1; }
                if (typeof metadata.renderedUserMessage[0].text != 'string' || !metadata.renderedUserMessage[0].text) {
                    console.log(`${header} renderedUserMessage[0].text is empty`);
                } else { matchCount += 1; }
                if (metadata.renderedUserMessage[1].type != 3) {
                    console.log(`${header} renderedUserMessage[1].type is not 3`);
                } else { matchCount += 1; }
                if (metadata.renderedUserMessage[1].cacheType != 'ephemeral') {
                    console.log(`${header} renderedUserMessage[1].cacheType is not ephemeral`);
                } else { matchCount += 1; }
            }
            // RESULT: as expected, can I use this as user message or system message?
            if (metadata.renderedGlobalContext) {
                if (!Array.isArray(metadata.renderedGlobalContext)) {
                    console.log(`${header} renderedGlobalContext is not array`);
                }
                if (metadata.renderedGlobalContext.length != 2) {
                    console.log(`${header} renderedGlobalContext is not length 2`);
                } else { matchCount += 1; }
                if (metadata.renderedGlobalContext[0].type != 1) {
                    console.log(`${header} renderedGlobalContext[0].type is not 1`);
                } else { matchCount += 1; }
                if (typeof metadata.renderedGlobalContext[0].text != 'string' || !metadata.renderedGlobalContext[0].text) {
                    console.log(`${header} renderedGlobalContext[0].text is empty`);
                } else { matchCount += 1; }
                if (metadata.renderedGlobalContext[1].type != 3) {
                    console.log(`${header} renderedGlobalContext[1].type is not 3`);
                } else { matchCount += 1; }
                if (metadata.renderedGlobalContext[1].cacheType != 'ephemeral') {
                    console.log(`${header} renderedGlobalContext[1].cacheType is not ephemeral`);
                } else { matchCount += 1; }
            }

            // RESULT: many, irrelavent
            if (!!metadata.toolCallRounds != !!metadata.toolCallResults) {
                // console.log(`${header} toolCallRounds and toolCallResults don't appear at the same time`);
            }
            for (const round of metadata.toolCallRounds ?? []) {
                // RESULT: no unexpected structure
                const actualProperties = Object.keys(round)
                    .filter(k => k != 'statefulMarker' && k != 'thinking').sort((a, b) => a.localeCompare(b));
                const expectProperties = [
                    'id', 'response', 'toolCalls', 'toolInputRetry',
                ].sort((a, b) => a.localeCompare(b));
                if (actualProperties.length != expectProperties.length || expectProperties.some((e, i) => actualProperties[i] != e)) {
                    console.log(`${header} round unexpected properties, ${actualProperties}, ${expectProperties}`);
                } else { matchCount += 1; }

                // RESULT: all have value
                if (typeof round.id != 'string' || !round.id) {
                    console.log(`${header} tool call round id is empty`);
                } else { matchCount += 1; }

                // RESULT: string and non empty
                if (round.statefulMarker && (typeof round.statefulMarker != 'string' || !round.statefulMarker)) {
                    console.log(`${header} tool call round stateful marker is empty`);
                }
                // RESULT: 2 have value, very long base64 string, can decode, but decode result is not ascii
                // stateful marker seems some provider's requirement to continue conversation,
                // I'm not continuing these conversations with original provider so this are meaningless
                // if (round.statefulMarker) { console.log(round.statefulMarker); }

                // RESULT: 2 have value, large chunk of encrypted text,
                // should be closed source model's simplified reasoning content
                if (round.thinking) {
                    // RESULT: no unexpected structure
                    const actualProperties = Object.keys(round.thinking).sort((a, b) => a.localeCompare(b));
                    const expectProperties = [
                        'id', 'text', 'encrypted', 'tokens',
                    ].sort((a, b) => a.localeCompare(b));
                    if (actualProperties.length != expectProperties.length || expectProperties.some((e, i) => actualProperties[i] != e)) {
                        console.log(`${header} round.thinking unexpected properties, ${actualProperties}, ${expectProperties}`);
                    } else { matchCount += 1; }
                    // RESULT: none
                    if (typeof round.thinking.id != 'string' || !round.thinking.id) {
                        console.log(`${header} tool call round thinking.id is empty`);
                    } else { matchCount += 1; }
                    // RESULT: none
                    if (typeof round.thinking.text != 'string' || !round.thinking.text) {
                        console.log(`${header} tool call round thinking.text is empty`);
                    } else { matchCount += 1; }
                    // RESULT: none
                    if (typeof round.thinking.encrypted != 'string' || !round.thinking.encrypted) {
                        console.log(`${header} tool call round thinking.encrypted is empty`);
                    } else { matchCount += 1; }
                    // RESULT: none
                    if (typeof round.thinking.tokens != 'number') {
                        console.log(`${header} tool call round thinking.text is not number`);
                    } else { matchCount += 1; }
                }
                // RESULT: none
                if (round.toolInputRetry) {
                    console.log(round.toolInputRetry);
                }
                if (typeof round.response != 'string') {
                    console.log(`${header} request.result.metadata.toolcallrounds.response is not string`);
                }
                if (!round.response) {
                    // RESULT: many
                    // console.log(`${header} request.result.metadata.toolcallrounds.response is empty`);
                } else {
                    // RESULT: seems very full response text
                    // TODO validate against request.response
                    // console.log(round.response);
                }

                if (!round.toolCalls.length) {
                    // RESULT: many, what does it mean by toolcallrounds.toolcalls is empty?
                    // console.log(`${header} tool call round tool calls is empty?`);
                } else {
                    // finally something looks like tool call in api
                    for (const toolCall of round.toolCalls) {
                        // RESULT: no unexpected structure
                        const actualProperties = Object.keys(toolCall).sort((a, b) => a.localeCompare(b));
                        if (actualProperties.length != 3 || actualProperties[0] != 'arguments'
                            || actualProperties[1] != 'id' || actualProperties[2] != 'name'
                        ) {
                            console.log(`${header} request.result.metadata.toolcallrounds.toolscalls unexpected structure`);
                        }
                        // RESULT: all string
                        if (typeof toolCall.id != 'string' || typeof toolCall.name != 'string' || typeof toolCall.arguments != 'string') {
                            console.log(`${header} request.result.metadata.toolcallrounds.toolscalls unexpected structure`);
                        } else { matchCount += 1; }
                        // RESULT: all non empty
                        if (!toolCall.id || !toolCall.name || !toolCall.arguments) {
                            console.log(`${header} request.result.metadata.toolcallrounds.toolscalls some property is empty?`);
                        } else { matchCount += 1; }
                    }
                }
            }
            if (metadata.toolCallResults) {
                for (const [resultId, result] of Object.entries(metadata.toolCallResults)) {
                    // values are ast! ABSTRACT! SYNTAX! TREE!
                    // tens of thousands of lines ast, and seems for generic text?
                    // WHY DO YOU PUT THIS AMOUNT OF AST NODES ON MY DISK?
                    
                    // try recursive join text together?
                    let text = '';
                    let nodeCount = 0;
                    function visit(node: any) {
                        nodeCount += 1;
                        if (typeof node.text == 'string' && node.text) {
                            text += node.text;
                        }
                        if (Array.isArray(node.children)) {
                            // no need to check recursive because they are deserialized from json
                            node.children.forEach((n: any) => visit(n));
                        }
                    }
                    visit(result.content[0].value.node);
                    // RESULT: looks like local run result?
                    // console.log(resultId, nodeCount, text);
                }
            }
        }

        // RESULT: no unexpected structure
        const actualProperties = Object.keys(sessionFiles.state)
            .filter(k => k != 'pendingSnapshot').sort((a, b) => a.localeCompare(b));
        const expectProperties = [
            'version', 'sessionId', 'linearHistory', 'linearHistoryIndex', 'initialFileContents', 'recentSnapshot',
        ].sort((a, b) => a.localeCompare(b));
        if (actualProperties.length != expectProperties.length || expectProperties.some((e, i) => actualProperties[i] != e)) {
            console.log(`${header} state unexpected properties, ${actualProperties}, ${expectProperties}`);
        } else { matchCount += 1; }

        const state = sessionFiles.state as {
            version: 2,
            sessionId: string,
            linearHistory: {
                requestId: string,
                stops: {
                    entries: {
                        resource: string,
                        language: string,
                        originalHash: string,
                        currentHash: string,
                        state: number,
                        snapshotUri: string,
                        telemetryInfo: any,
                    }[],
                    stopId?: string,
                }[],
                postEdit: any,
            }[],
            linearHistoryIndex: any,
            initialFileContents: any,
            pendingSnapshot?: any,
            recentSnapshot: { entries: any[] },
        };
        // RESULT: all 2
        if (state.version != 2) {
            console.log(`${header}: state.version not 2`);
        }
        // RESULT: none
        if (state.sessionId != session.sessionId) {
            console.log(`${header}: state.sessionId != session.sessionId`);
        }

        // RESULT: all array
        if (!Array.isArray(state.linearHistory)) {
            console.log(`${header}: state.linearHistory not array`);
        }
        // RESULT: some
        if (state.linearHistory.length == 0) {
            // console.log(`${header}: state.linearHistory is empty`);
        }
        for (const entry of state.linearHistory) {
            const properties = Object.keys(entry).filter(k => k != 'postEdit').sort((a, b) => a.localeCompare(b));
            if (properties.length != 2 || properties[0] != 'requestId' || properties[1] != 'stops') {
                console.log(`${header} state.linearHistory unexpected properties, ${properties}`);
            }
            // RESULT: all non empty
            if (typeof entry.requestId != 'string' || !entry.requestId) {
                console.log(`${header} state.linearHistory requestid is not string or is empty`);
            }
            // RESULT: 6 not match, and the not match requestid is not found in any other place in the workspacestorage folder?
            if (!session.requests.some(r => r.requestId == entry.requestId)) {
                // console.log(`${header} state.linearHistory requestid not found in session?`, entry, session.requests.map(r => r.requestId));
            } else { matchCount += 1; }

            // RESULT: all array
            if (!Array.isArray(entry.stops)) {
                console.log(`${header} state.linearHistory stops is not array`);
            }
            // RESULT: 3 is empty, TODO is this special case in previous validations?
            if (entry.stops.length == 0) {
                // console.log(`${header} state.linearHistory stops is empty`);
            }
            for (const stop of entry.stops) {
                // RESULT: no unexpected structure
                const properties = Object.keys(stop).filter(k => k != 'stopId').sort((a, b) => a.localeCompare(b));
                if (properties.length != 1 || properties[0] != 'entries') {
                    console.log(`${header} state.linearHistory entry.stops entry unexpected properties, ${properties}`);
                }
                if (stop.stopId) {
                    if (typeof stop.stopId != 'string') {
                        // RESULT: all string
                        console.log(`${header} state.linearHistory entry.stop entry.stopId not string`);
                    } else {
                        const request = session.requests.find(r => r.requestId == entry.requestId);
                        // RESULT: none
                        if (stop.stopId && !request) {
                            console.log(`${header} state.linearHistory entry.stops entry.stopId is not empty but requestId not found?`);
                        }
                        // RESULT: none
                        if (!request.response.some(r => 'kind' in r && r.kind == 'undoStop' && r.id == stop.stopId)) {
                            console.log(`${header} state.linearHistory entry.stops entry.stopId not found in request response block?`);
                        }
                    }
                }
                // RESULT: some
                if (!!stop.stopId != !!stop.entries.length) {
                    // console.log(`${header} state.linearHistory entry.stops entry.stopId and .entries not same nullness`);
                }
                for (const entry of stop.entries) {
                    // console.log(entry);
                }
            }
        }
        console.log(state.linearHistoryIndex);

        // TODO prepare for write:
        // which are major texts, which are tool call rounds, which additional information to collect?
    }
    console.log(matchCount);
}
await read6();
