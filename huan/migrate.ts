import fs from 'node:fs/promises';

// source#1 was assigned to huan initial test data, but huan yaml schema really change many times so this batch is meaningless
// source#2, huan prototype, taiga test data, collect from raw chat completion streaming data, 1 session

// source#3, mysql-backup-20260319's my old chat app theai/yala, session.csv and message.csv, about 60 sessions
// reference archive/theai/shapes.xml, src/database.sql, server/index.ts
// session.csv:
//   int id, user id (constant 1), name, comment, create time, tags, shared flag, share id, update time
// message.csv:
//   int message id, session id, role, content, create time, input token, output token, parent message id, update time, thinking content
// does old chat app ever thinking? RESULT: no data in thinking column, but one session have manual thinking formating?

function splitCSV1Line(line: string): string[] {
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
function unescapeCSV1(raw: string): string | null {
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

function readCSV1<T>(raw: string, map: (fields: string[]) => T): T[] {

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

        records.push(map(splitCSV1Line(recordLine).map(unescapeCSV1)));
        recordLine = '';
    }

    return records;
}

function source3() {
    const sessions = readCSV1(await fs.readFile('session.csv', 'utf8'), fields => ({
        id: +fields[0],
        userId: +fields[1],
        name: fields[2],
        comment: fields[3],
        createTime: fields[4],
        tags: fields[5],
        shared: fields[6].codePointAt(0) != 0,
        shareId: fields[7],
        updateTime: fields[8],
    }));

    const sessionIds: number[] = [];
    for (const session of sessions) {
        // console.log(session.name, session.createTime);
        // console.log(JSON.stringify(session));
        // RESULT: ok
        if (sessionIds.includes(session.id)) {
            console.log(`duplicate session id ${session.id}`);
        } else {
            sessionIds.push(session.id);
        }
        // RESULT: ok
        if (session.userId != 1) {
            console.log(`session ${session.id} user id not 1?`);
        }
        // RESULT: ok
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
        // RESULT: ok
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
        // RESULT: ok
        if (session.createTime > session.updateTime) {
            console.log(`session ${session.id} create time > update time?`);
        }
        // RESULT: ok, can use this as new session file name
        if (sessions.some(s => s.id != session.id && s.createTime == session.createTime)) {
            console.log(`session ${session.id} duplicate create time ${session.createTime}`);
        }
        // RESULT ok
        if (session.createTime.length != 19 || session.createTime[4] != '-' || session.createTime[7] != '-' || session.createTime[10] != ' ' || session.createTime[13] != ':' || session.createTime[16] != ':') {
            console.log(`session ${session.id} create time ${session.createTime} unexpected format`);
        }
    }

    const messages = readCSV1(await fs.readFile('message.csv', 'utf8'), fields => ({
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
    }));
    for (const message of messages) {
        // console.log(`session ${message.sessionId} ${message.role} ${message.messageId}<-${message.parentMessageId} ${message.createTime},${message.updateTime} content ${message.content.length} chars`);
        // RESULT: ok
        if (isNaN(message.messageId) || message.messageId <= 0) {
            console.log(`invalid message id ${message.messageId}`);
        }
        // RESULT: ok
        if (!sessions.some(s => s.id == message.sessionId)) {
            console.log(`message ${message.messageId} session ${message.sessionId} not found`);
        }
        const messagesOfSession = messages.filter(m => m.sessionId == message.sessionId);
        // RESULT: ok
        if (messagesOfSession.filter(m => m.messageId == message.messageId).length > 1) {
            console.log(`session ${message.sessionId} message id ${message.messageId} duplicate`);
        }
        // RESULT: many, old app allows branch system message, that is multiple system messages
        const systemMessages = messagesOfSession.filter(m => m.role == 'system');
        if (systemMessages.length > 1) {
            // console.log(`session ${message.sessionId} system message count > 1`);
        }
        // RESULT: many
        if (message.parentMessageId) {
            // console.log(`session ${message.sessionId} message ${message.messageId} parent message id ${message.parentMessageId}`);
        }
        // RESULT: ok
        if (message.parentMessageId && !messagesOfSession.some(m => message.parentMessageId == m.messageId)) {
            console.log(`session ${message.sessionId} message ${message.messageId} parent message id ${message.parentMessageId} not found in ${messagesOfSession.map(m => m.messageId)}`);
        }
        const parentMessage = messagesOfSession.find(m => m.messageId == message.parentMessageId);

        // RESULT: ok
        if (!['user', 'assistant', 'system'].includes(message.role)) {
            console.log(`session ${message.sessionId} message ${message.messageId} unexpected role ${message.role}`);
        }
        // 1 error, manually fix
        if (parentMessage && !['assistant-user', 'user-assistant', 'user-system'].includes(`${message.role}-${parentMessage.role}`)) {
            console.log(`session ${message.sessionId} message ${message.messageId} parent message ${message.parentMessageId} unexpected role relationship ${message.role}-${parentMessage.role}`);
        }

        // why do many user message have token count while assistant message don't have token count?
        // answer 2: assistant message token count is erased after edit
        // all these happen at message id migrate to session scope, check old version of source code
        // what is sessionversion, why is token count on this object? I guess that's data migration error when updating database schema, stop investigation
        if (message.role != 'assistant' && (message.inputToken || message.outputToken)) {
            // console.log(`session ${message.sessionId} message ${message.messageId} has token count`);
            // RESULT none
            // cannot answer 1, so assign these token counts to their parent assistant message
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

        // RESULT: none
        if (message.thinkingContent) {
            console.log(`session ${message.sessionId} message ${message.messageId} has thinking content?`);
        }

        // RESULT: ok
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
        // don't forget normal datetime format can compare string
        // RESULT: ok
        if (message.createTime > message.updateTime) {
            console.log(`session ${message.sessionId} message ${message.messageId} create time > update time?`);
        }
    }

    // convert
    for (const session of sessions) {
        let filename = session.createTime.substring(0, 4) + session.createTime.substring(5, 7)
            + session.createTime.substring(8, 10) + '-' + session.createTime.substring(11, 13)
            + session.createTime.substring(14, 16) + session.createTime.substring(17);
        let b = `name: ${session.name}\n`;
        b += 'metadata:\n';
        b += '  source: my chat app 2025/theai/yala\n';
        b += `  source-id: ${session.id}\n`;
        b += `  source-create-time: ${session.createTime}\n`;
        if (session.updateTime != session.createTime) {
        b += `  source-update-time: ${session.updateTime}\n`;
        }
        if (session.comment) {
            if (session.comment.includes('\n')) {
                b += `  source-comment: '${session.comment.replace('\n', '\\n')}'\n`;
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
            b += '\n'
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

        // console.log(`write ${filename}.yml`);
        // await fs.writeFile(`${filename}.yml`, b);
        // if (session.id > 30) { break; }
    }

    // acceptance check:
    console.log(sessions.length, messages.length, messages.reduce((acc, m) => acc + m.content.trim().length, 0));
}

// source#4, old deepseek chat app data migration, it is migrated from f12 api not nowadays formal export function
