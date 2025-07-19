import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import mysql from 'mysql2/promise';
import * as I from '../shared/api.js';
import * as D from './database.js';
import type { MyErrorKind, ActionContext, DispatchContext, DispatchResult } from './dispatch.js';

dayjs.extend(utc);

// this is the same config file as core module
const config = (JSON.parse(await fs.readFile('config', 'utf-8')) as {
    aikey: string,
    // so this is the connection options to connect to core module database
    database: mysql.PoolOptions,
});

type QueryResult<T> = T & mysql.RowDataPacket;
type ManipulateResult = mysql.ResultSetHeader;
// so need to change database name to connect to this app's database
const pool = mysql.createPool({ ...config.database, database: 'YALA', typeCast: (field, next) =>
    field.type == 'BIT' && field.length == 1 ? field.buffer()[0] == 1
    : field.type == 'DATETIME' ? dayjs.utc(field.string(), 'YYYY-MM-DD hh:mm:ss') 
    : next(),
});

function formatDateTime(value: dayjs.Dayjs) {
    return value.format('YYYY-MM-DDTHH:mm:ss[Z]');
}

// TODO multiple models, I need small models to answer small questions
// add a model selection ui,
// add model parameter to complete api
// add model and api key configuration to servers/yala.json
// add a model column to message

// GET /sessions return root SessionDirectory
async function getSessions(ax: ActionContext): Promise<I.Session[]> {

    const [sessions] = await pool.query<QueryResult<D.Session & { ShareId: string | null }>[]>(
        'SELECT `SessionId`, `Name`, `Comment`, `Tags`, `CreateTime`, `UpdateTime`, `Shared`, `ShareId` FROM `Session` WHERE `UserId` = ? ORDER BY `CreateTime` DESC',
        [ax.userId],
    );
    return sessions.map<I.Session>(s => ({
        id: s.SessionId,
        name: s.Name,
        comment: s.Comment ?? '',
        tags: s.Tags?.split(',')?.filter(x => x) ?? [],
        shareId: s.Shared ? s.ShareId : null,
        createTime: formatDateTime(s.CreateTime),
        updateTime: formatDateTime(s.UpdateTime),
        messages: [], // get list api does not include messages
    }));
}
async function getSession(ax: ActionContext, sessionId: number): Promise<I.Session> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId`, `Name`, `Comment`, `Tags`, `CreateTime`, `UpdateTime`, `Shared`, `ShareId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    const session = sessions[0];
    const [messages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `MessageId`, `ParentMessageId`, `Role`, `Content`, `ThinkingContent`, `PromptTokenCount`, `CompletionTokenCount`, `CreateTime`, `UpdateTime` FROM `Message` WHERE `SessionId` = ?',
        [session.SessionId],
    );
    messages.sort((a, b) => a.MessageId - b.MessageId);

    return {
        id: sessionId,
        name: session.Name,
        comment: session.Comment ?? '',
        tags: session.Tags?.split(',')?.filter(x => x) ?? [],
        shareId: session.Shared ? session.ShareId : null,
        createTime: formatDateTime(session.CreateTime),
        updateTime: formatDateTime(session.UpdateTime),
        messages: messages.map<I.Message>(m => ({
            id: m.MessageId,
            parentId: m.ParentMessageId,
            role: m.Role,
            content: m.Content,
            thinkingContent: m.ThinkingContent,
            promptTokenCount: m.PromptTokenCount,
            completionTokenCount: m.CompletionTokenCount,
            createTime: formatDateTime(m.CreateTime),
            updateTime: formatDateTime(m.UpdateTime),
        })),
    };
}

// ATTENTION no user info for public api, this ax parameter should never be used
async function publicGetSession(_ax: ActionContext, shareId: string): Promise<I.Session> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId`, `Name`, `Comment`, `Tags`, `Shared` FROM `Session` WHERE `ShareId` = ?',
        [shareId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }
    const session = sessions[0];
    if (!session.Shared) {
        throw new MyError('not-found', 'invalid session id');
    }

    const [messages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `MessageId`, `ParentMessageId`, `Role`, `Content`, `ThinkingContent` FROM `Message` WHERE `SessionId` = ?',
        [session.SessionId],
    );

    // the public api does not return createtime, updatetime, tags, shareid and tokencount
    return {
        id: session.SessionId,
        name: session.Name,
        comment: session.Comment ?? '',
        tags: [],
        messages: messages.map<I.Message>(m => ({
            id: m.MessageId,
            parentId: m.ParentMessageId,
            role: m.Role,
            content: m.Content,
            thinkingContent: m.ThinkingContent,
        })),
    };
}

async function addSession(ax: ActionContext, session: I.Session): Promise<I.Session> {

    if (session.messages.length != 1) {
        throw new MyError('common', 'missing initial message');
    }
    if (session.messages[0].role != 'system' && session.messages[0].role != 'user') {
        throw new MyError('common', 'invalid role');
    }
    if (!session.messages[0].content || !session.messages[0].content.length) {
        throw new MyError('common', 'invalid content');
    }

    const newName = session.name ?? ax.now.format('YYYYMMDD-HHmmss');
    // NOTE session name should not duplicate in userid (can duplicate in different users)
    const [existingSessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `UserId` = ? AND `Name` = ?',
        [ax.userId, newName],
    );
    if (existingSessions.length > 0) {
        throw new MyError('common', 'duplicate session name');
    }

    const [insertResult] = await pool.execute<ManipulateResult>(
        "INSERT INTO `Session` (`UserId`, `Name`, `Tags`, `Shared`) VALUES (?, ?, '', 0)",
        [ax.userId, newName],
    );
    await pool.execute<ManipulateResult>(
        "INSERT INTO `Message` (`SessionId`, `MessageId`, `Role`, `Content`) VALUES (?, 1, ?, ?)",
        [insertResult.insertId, session.messages[0].role, session.messages[0].content],
    );

    return {
        id: insertResult.insertId,
        name: newName,
        createTime: formatDateTime(ax.now),
        updateTime: formatDateTime(ax.now),
        tags: [],
        messages: [{
            id: 1,
            role: session.messages[0].role,
            content: session.messages[0].content,
            createTime: formatDateTime(ax.now),
            updateTime: formatDateTime(ax.now),
        }],
    };
}

// validate session belongs to user
async function validateSessionUser(ax: ActionContext, sessionId: number) {
    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }
}

// update session name, comment and tags
async function updateSession(ax: ActionContext, session: I.Session): Promise<I.Session> {
    await validateSessionUser(ax, session.id);

    // NOTE session name should not duplicate in userid (can duplicate in different users)
    const [existingSessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `UserId` = ? AND `Name` = ? AND `SessionId` != ?',
        [ax.userId, session.name, session.id],
    );
    if (existingSessions.length > 0) {
        throw new MyError('common', 'duplicate session name');
    }

    await pool.execute(
        'UPDATE `Session` SET `Name` = ?, `Comment` = ?, `Tags` = ?, `UpdateTime` = ? WHERE `SessionId` = ?',
        [session.name, session.comment ?? null, session.tags.join(','), ax.now.format('YYYY-MM-DD HH:mm:ss'), session.id],
    );
    session.updateTime = formatDateTime(ax.now);
    return session;
}
async function removeSession(ax: ActionContext, sessionId: number) {
    // TODO if indexed, cannot remove
    await validateSessionUser(ax, sessionId);
    await pool.execute('DELETE FROM `Message` WHERE `SessionId` = ?', [sessionId]);
    await pool.execute('DELETE FROM `Session` WHERE `SessionId` = ?', [sessionId]);
}

async function addMessage(ax: ActionContext, sessionId: number, message: I.Message): Promise<I.Message> {
    await validateSessionUser(ax, sessionId);

    if (message.parentId) {
        const [parentMessages] = await pool.query<QueryResult<D.Message>[]>(
            'SELECT `Role` FROM `Message` WHERE `SessionId` = ? AND `MessageId` = ?',
            [sessionId, message.parentId],
        );
        if (!Array.isArray(parentMessages) || parentMessages.length == 0) {
            throw new MyError('not-found', 'invalid parent message id');
        }
        const parentMessage = parentMessages[0];

        if ((parentMessage.Role == 'system' || parentMessage.Role == 'assistant') && message.role != 'user') {
            throw new MyError('common', 'invalid role');
        } else if (parentMessage.Role == 'user' && message.role != 'assistant') {
            throw new MyError('common', 'invalid role');
        }
    } else if (message.role != 'system' && message.role != 'user') {
        throw new MyError('common', 'invalid role');
    }

    const [maxMessages] = await pool.query<QueryResult<{ MaxMessageId: number }>[]>(
        "SELECT MAX(`MessageId`) `MaxMessageId` FROM `Message` GROUP BY `SessionId` HAVING `SessionId` = ?",
        [sessionId],
    );
    const newMessageId = maxMessages[0].MaxMessageId + 1;
    await pool.execute<ManipulateResult>(
        'INSERT INTO `Message` (`SessionId`, `MessageId`, `ParentMessageId`, `Role`, `Content`) VALUES (?, ?, ?, ?, ?)',
        [sessionId, newMessageId, message.parentId, message.role, message.content],
    );
    return {
        id: newMessageId,
        parentId: message.parentId,
        role: message.role,
        content: message.content,
        createTime: formatDateTime(ax.now),
        updateTime: formatDateTime(ax.now),
    };
}

async function updateMessage(ax: ActionContext, sessionId: number, message: I.Message): Promise<I.Message> {
    await validateSessionUser(ax, sessionId);

    await pool.execute(
        'UPDATE `Message` SET `Content` = ?, `PromptTokenCount` = NULL, `CompletionTokenCount` = NULL, `UpdateTime` = ? WHERE `MessageId` = ? AND `SessionId` = ?',
        [message.content, ax.now.format('YYYY-MM-DD HH:mm:ss'), message.id, sessionId],
    );
    message.updateTime = formatDateTime(ax.now);
    return message;
}

async function removeMessageTree(ax: ActionContext, sessionId: number, messageId: number) {
    await validateSessionUser(ax, sessionId);
    // TODO should not remove when any of the message is indexes

    const [messageRelationships] = await pool.query<QueryResult<Pick<D.Message, 'MessageId' | 'ParentMessageId'>>[]>(
        'SELECT `MessageId`, `ParentMessageId` FROM `Message` WHERE `SessionId` = ?',
        [sessionId],
    );
    if (messageRelationships.length <= 1) {
        throw new MyError('common', 'cannot delete last message');
    }

    const remainingIds = [messageId];
    const shouldDeleteIds = [] as number[];
    while (remainingIds.length > 0) {
        const currentId = remainingIds.shift();
        if (!shouldDeleteIds.includes(currentId)) {
            shouldDeleteIds.push(currentId);
            messageRelationships.filter(m => m.ParentMessageId == currentId).map(m => m.MessageId).forEach(id => remainingIds.push(id));
        }
    }

    await pool.execute(
        `DELETE FROM \`Message\` WHERE \`SessionId\` = ? AND \`MessageId\` IN (${shouldDeleteIds.map(() => '?').join(',')})`,
        [sessionId, ...shouldDeleteIds],
    );
}

// TODO streaming
// the original request handler only receives data and store in database and memory
// use another http endpoint to get data from memory, in case of multiple connection and break and restart from middle
// new connections will receive all current data and continue receive new content if connection keeps,
// ui also ends after sending request, but connection to other http endpoint to load new contents
// see https://medium.com/trabe/server-sent-events-sse-streams-with-node-and-koa-d9330677f0bf,
// note that I don't have to SSE, note that I'm directly assigning ctx.body in forward.ts, and in dispatch function, which is very ok to this
// client side https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams

// import { PassThrough } from 'node:stream';

const fakeComplete = false;
async function completeMessage(ax: ActionContext, sessionId: number, messageId: number): Promise<I.Message> {
    await validateSessionUser(ax, sessionId);

    const [messageRelationships] = await pool.query<QueryResult<Pick<D.Message, 'MessageId' | 'ParentMessageId'>>[]>(
        'SELECT `MessageId`, `ParentMessageId` FROM `Message` WHERE `SessionId` = ?',
        [sessionId],
    );
    if (!Array.isArray(messageRelationships) || !messageRelationships.some(r => r.MessageId == messageId)) {
        throw new MyError('not-found', 'invalid message id');
    }

    let currentMessageId = messageId;
    const messageIds: number[] = [];
    do {
        messageIds.push(currentMessageId);
        currentMessageId = messageRelationships.find(r => r.MessageId == currentMessageId).ParentMessageId;
    } while (currentMessageId);
    // console.log('completeMessage, loaded message ids', messageIds);

    // order by messageid: a message cannot be added before its parentid, so order by parentid is enough
    const [messages] = await pool.execute<QueryResult<D.Message>[]>(
        `SELECT \`MessageId\`, \`Role\`, \`Content\` FROM \`Message\` WHERE \`SessionId\` = ? AND \`MessageId\` IN (${messageIds.map(() => '?').join(',')}) ORDER BY \`MessageId\``,
        [sessionId, ...messageIds],
    );
    // console.log('completeMessage, loaded messages', messages);

    const firstRole = messages[0].Role;
    if (firstRole != 'system' && firstRole != 'user') {
        throw new MyError('common', 'conversation must start with a system or user message');
    }
    for (let i = 0; i < messages.length; i++) {
        const { Role: role, Content: content } = messages[i];
        if (typeof content != 'string' || content.trim().length === 0) {
            throw new MyError('common', `message at index ${i + 1} has empty content`);
        }
        if (!['user', 'assistant', 'system'].includes(role)) {
            throw new MyError('common', `message at index ${i + 1} has invalid role`);
        }
        // following validations validates on role relationship which don't applies to first message
        if (i == 0) { continue; }

        const parentRole = messages[i - 1].Role;
        if ((parentRole == 'system' || parentRole == 'assistant') && role != 'user') {
            throw new MyError('common', `message at index ${i + 1} has invalid role`);
        } else if (parentRole == 'user' && role != 'assistant') {
            throw new MyError('common', `message at index ${i + 1} has invalid role`);
        }
    }
    if (messages[messages.length - 1].Role != 'user') {
        throw new MyError('common', 'conversation must end with a user message');
    }

    let responseContent: string;
    let responseReasoningContent: string;
    let promptTokenCount: number;
    let completionTokenCount: number;
    if (fakeComplete) {
        await new Promise<void>(resolve => setTimeout(resolve, 10_000));
        responseContent = "for debug " + messages.map(m => m.Content).join("\n");
        responseReasoningContent = null;
        const veryRawWordCount = messages.filter(m => m.Role != 'assistant').reduce((acc, m) => acc + m.Content.split(' ').length, 0);
        promptTokenCount = Math.round(veryRawWordCount * 0.2);
        completionTokenCount = Math.round(veryRawWordCount * 0.8);
    } else {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.aikey}`,
            },
            body: JSON.stringify({ model: 'deepseek-chat', messages: messages.map(m => ({ role: m.Role, content: m.Content })) }),
        });
        if (response.status != 200) {
            // TMD there is no log here
            console.log(response);
            throw new MyError('internal', 'failed to get response');
        }
        
        // const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        // while (true) {
        //     const { value, done } = await reader.read();

        // }

        interface CompletionAPIResponse {
            choices: {
                index: number,
                message: {
                    role: string,
                    content: string,
                    reasoning_content: string,
                },
                finish_reason: string,
            }[],
            usage: {
                prompt_tokens: number,
                completion_tokens: number,
                total_tokens: number,
            };
        }
        const responseData = await response.json() as CompletionAPIResponse;
        const responseOriginalContent = responseData.choices && responseData.choices[0] ? responseData.choices[0].message.content : '(no response)';
        responseReasoningContent = responseData.choices && responseData.choices[0] ? responseData.choices[0].message.reasoning_content : '(no response)';
        responseContent = responseOriginalContent.trim()
            // .replace(/\r?\n\r?\n/g, '\n') // remove empty line
            // .split('\n').map(v => v.trim()).join('\n') // trim each line
            // additional refinements if need
            // .replace(/"([^"]*)"/g, '“$1”') // replace ASCII double quotes with fullwidth quotes
            // .replaceAll('...', '……') // replace ... with full width …
            // .replaceAll('**', '') // remove markdown bold

        promptTokenCount =  responseData.usage.prompt_tokens;
        completionTokenCount = responseData.usage.completion_tokens;
    }

    // complete message works as external service is adding message
    const newMessageId = messageRelationships.reduce((acc, r) => Math.max(acc, r.MessageId), 0) + 1;
    await pool.execute<ManipulateResult>(
        "INSERT INTO `Message` (`SessionId`, `MessageId`, `ParentMessageId`, `Role`, `Content`, `ThinkingContent`, `PromptTokenCount`, `CompletionTokenCount`) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)",
        [sessionId, newMessageId, messageId, responseContent, responseReasoningContent ?? null, promptTokenCount, completionTokenCount],
    );

    return {
        id: newMessageId,
        parentId: messageId,
        role: 'assistant',
        content: responseContent,
        promptTokenCount,
        completionTokenCount,
        createTime: formatDateTime(ax.now),
        updateTime: formatDateTime(ax.now),
    };
}

async function shareSession(ax: ActionContext, sessionId: number): Promise<I.ShareSessionResult> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId`, `Shared`, `ShareId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }
    const session = sessions[0];

    if (session.Shared) {
        return { id: session.ShareId };
    }
    
    if (!session.ShareId) {
        session.ShareId = crypto.randomUUID();
        await pool.execute(
            'UPDATE `Session` SET `Shared` = 1, `ShareId` = ? WHERE `SessionId` = ?',
            [session.ShareId, sessionId],
        );
    } else {
        await pool.execute('UPDATE `Session` SET `Shared` = 1 WHERE `SessionId` = ?', [sessionId]);
    }
    return { id: session.ShareId };
}
async function unshareSession(ax: ActionContext, sessionId: number) {
    await validateSessionUser(ax, sessionId);
    await pool.execute('UPDATE `Session` SET `Shared` = 0 WHERE `SessionId` = ?', [sessionId]);
}

async function getAccountBalance(_ax: ActionContext): Promise<I.AccountBalance> {

    let response: Response;
    try {
        response = await fetch('https://api.deepseek.com/user/balance', {
            headers: { 'Authorization': `Bearer ${config.aikey}` },
        });
    } catch (error) {
        console.log('request error', error);
        return { balance: -1 };
    }
    if (!response.ok) {
        console.log('request not ok', response);
        return { balance: -1 };
    }

    const body: any = await response.json();
    return { balance: body.balance_infos[0].total_balance };
}

async function getDSessions(_ax: ActionContext): Promise<I.dsession[]> {
    const [sessions] = await pool.query<QueryResult<I.dsession>[]>(
        "SELECT `id`, `seq_id`, `title`, `inserted_at`, `updated_at` FROM `dsession`;",
    )
    return sessions.map(s => ({
        ...s,
        inserted_at: formatDateTime(s.inserted_at as unknown as dayjs.Dayjs),  
        updated_at: formatDateTime(s.updated_at as unknown as dayjs.Dayjs),  
    }));
}
async function getDMessages(_ax: ActionContext, sessionId: string): Promise<I.dmessage[]> {
    const [messages] = await pool.query<QueryResult<I.dmessage>[]>(
        "SELECT `message_id`, `parent_id`, `role`, `content`, `thinking_content`, `accumulated_token_usage`, `inserted_at` FROM `dmessage` WHERE `session_id` = ?",
        [sessionId],
    );
    return messages.map(m => ({
        ...m,
        inserted_at: formatDateTime(m.inserted_at as unknown as dayjs.Dayjs),
    }));
}

// AUTOGEN
// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

class MyError extends Error {
    // fine error middleware need this to know this is known error type
    public readonly name: string = 'FineError';
    public constructor(public readonly kind: MyErrorKind, message?: string) { super(message); }
}
class ParameterValidator {
    public constructor(private readonly parameters: URLSearchParams) {}
    private validate<T>(name: string, optional: boolean, convert: (raw: string) => T, validate: (value: T) => boolean): T {
        if (!this.parameters.has(name)) {
            if (optional) { return null; } else { throw new MyError('common', `missing required parameter ${name}`); }
        }
        const raw = this.parameters.get(name);
        const result = convert(raw);
        if (validate(result)) { return result; } else { throw new MyError('common', `invalid parameter ${name} value ${raw}`); }
    }
    public id(name: string) { return this.validate(name, false, parseInt, v => !isNaN(v) && v > 0); }
    public string(name: string) { return this.validate(name, false, v => v, v => !!v); }
}
export async function dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const { pathname, searchParams } = new URL(ctx.path, 'https://example.com');
    const v = new ParameterValidator(searchParams);
    const ax: ActionContext = { now: ctx.state.now, userId: ctx.state.user?.id, userName: ctx.state.user?.name };
    const action = ({
        'GET /v1/sessions': () => getSessions(ax),
        'GET /v1/session': () => getSession(ax, v.id('sessionId')),
        'GET /public/v1/session': () => publicGetSession(ax, v.string('shareId')),
        'PUT /v1/add-session': () => addSession(ax, ctx.body),
        'POST /v1/update-session': () => updateSession(ax, ctx.body),
        'DELETE /v1/remove-session': () => removeSession(ax, v.id('sessionId')),
        'PUT /v1/add-message': () => addMessage(ax, v.id('sessionId'), ctx.body),
        'POST /v1/update-message': () => updateMessage(ax, v.id('sessionId'), ctx.body),
        'DELETE /v1/remove-message-tree': () => removeMessageTree(ax, v.id('sessionId'), v.id('messageId')),
        'POST /v1/complete-message': () => completeMessage(ax, v.id('sessionId'), v.id('messageId')),
        'POST /v1/share-session': () => shareSession(ax, v.id('sessionId')),
        'POST /v1/unshare-session': () => unshareSession(ax, v.id('sessionId')),
        'GET /v1/account-balance': () => getAccountBalance(ax),
        'GET /v1/dsessions': () => getDSessions(ax),
        'GET /v1/dmessages': () => getDMessages(ax, v.string('id')),
    } as Record<string, () => Promise<any>>)[`${ctx.method} ${pathname}`];
    return action ? { body: await action() } : { error: new MyError('not-found', 'invalid-invocation') };
}
