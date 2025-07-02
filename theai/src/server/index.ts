// TODO try validate runtime 3rd party dependency is same as core module, also package.json
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
const pool = mysql.createPool({ ...config.database, database: 'MyChat' });

// GET /sessions return root SessionDirectory
async function getSessions(ax: ActionContext): Promise<I.Session[]> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId`, `Name`, `Comment`, `Tags`, `CreateTime` FROM `Session` WHERE `UserId` = ?',
        [ax.userId],
    );
    return sessions.map<I.Session>(s => ({
        id: s.SessionId,
        name: s.Name,
        comment: s.Comment,
        createTime: s.CreateTime,
        tags: s.Tags?.split(',') ?? [],
        messages: [], // get list api does not include messages
    }));
}
async function getSessionMessages(ax: ActionContext, sessionId: number): Promise<I.Message[]> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId`, `Name`, `Comment`, `Tags`, `CreateTime` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    const session = sessions[0];
    const [messages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `MessageId`, `ParentMessageId`, `Role`, `Content`, `PromptTokenCount`, `CompletionTokenCount` FROM `Message` WHERE `SessionId` = ?',
        [session.SessionId],
    );

    return messages.map<I.Message>(m => ({
        id: m.MessageId,
        parentId: m.ParentMessageId,
        role: m.Role,
        content: m.Content,
        promptTokenCount: m.PromptTokenCount,
        completionTokenCount: m.CompletionTokenCount,
    }));
}

// NOTE no user info for public api, this ax parameter should never be used
async function publicGetSession(_ax: ActionContext, shareId: string): Promise<I.Session> {

    const [sharedSessions] = await pool.query<QueryResult<D.SharedSession>[]>(
        'SELECT `SessionId` FROM `SharedSession` WHERE `ShareId` = ? AND `ExpireTime` > NOW()',
        [shareId],
    );
    if (!Array.isArray(sharedSessions) || sharedSessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }
    
    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId`, `Name`, `Comment`, `Tags`, `CreateTime` FROM `Session` WHERE `SessionId` = ?',
        [sharedSessions[0].SessionId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    const session = sessions[0];
    const [messages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `MessageId`, `ParentMessageId`, `Role`, `Content`, `PromptTokenCount`, `CompletionTokenCount` FROM `Message` WHERE `SessionId` = ?',
        [session.SessionId],
    );

    return {
        id: session.SessionId,
        name: session.Name,
        comment: session.Comment,
        createTime: session.CreateTime,
        tags: session.Tags?.split(',') ?? [],
        messages: messages.map<I.Message>(m => ({
            id: m.MessageId,
            parentId: m.ParentMessageId,
            role: m.Role,
            content: m.Content,
            promptTokenCount: m.PromptTokenCount,
            completionTokenCount: m.CompletionTokenCount,
        })),
    };
}

// POST /create-session return Session
async function addSession(ax: ActionContext, withName: I.Session): Promise<I.Session> {

    const newName = withName.name ?? dayjs.utc().format('[s]-YYYYMMDD-HHmmss');
    const [existingSessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `UserId` = ? AND `Name` = ?',
        [ax.userId, newName],
    );
    if (existingSessions.length > 0) {
        throw new MyError('common', 'session name already exists');
    }

    const [insertResult] = await pool.execute<ManipulateResult>(
        "INSERT INTO `Session` (`UserId`, `Name`, `Tags`) VALUES (?, ?, '')",
        [ax.userId, newName],
    );
    const [insertResult2] = await pool.execute<ManipulateResult>(
        "INSERT INTO `Message` (`SessionId`, `Role`, `Content`) VALUES (?, 'system', 'You are a helpful assistant.')",
        [insertResult.insertId],
    );

    return {
        id: insertResult.insertId,
        name: newName,
        createTime: dayjs.utc().toISOString(),
        tags: [],
        messages: [{
            id: insertResult2.insertId,
            role: 'system',
            content: 'You are a helpful assistant.',
        }],
    };
}
async function updateSession(ax: ActionContext, session: I.Session): Promise<I.Session> {

    if (!session.id || typeof session.name != 'string') {
        throw new MyError('common', 'invalid session data');
    }

    // validate session belongs to user
    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [session.id, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    const [existingSessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `UserId` = ? AND `Name` = ? AND `SessionId` != ?',
        [ax.userId, session.name, session.id],
    );
    if (existingSessions.length > 0) {
        throw new MyError('common', 'session name already exists');
    }

    await pool.execute(
        'UPDATE `Session` SET `Name` = ?, `Comment` = ? WHERE `SessionId` = ?',
        [session.name, session.comment, session.id],
    );
    return session;
}
async function removeSession(ax: ActionContext, sessionId: number) {
    
    // validate session belongs to user
    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    await pool.execute('DELETE FROM `SharedSession` WHERE `SessionId` = ?', [sessionId]);
    await pool.execute('DELETE FROM `Message` WHERE `SessionId` = ?', [sessionId]);
    await pool.execute('DELETE FROM `Session` WHERE `SessionId` = ?', [sessionId]);
}

async function addMessage(ax: ActionContext, sessionId: number, message: I.Message): Promise<I.Message> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    if (message.parentId) {
        const [parentMessages] = await pool.query<QueryResult<D.Message>[]>(
            'SELECT `Role` FROM `Message` WHERE `MessageId` = ?',
            [message.parentId],
        );
        if (!Array.isArray(parentMessages) || parentMessages.length == 0) {
            throw new MyError('common', 'invalid parent id');
        }
        if ((parentMessages[0].Role == 'system' || parentMessages[0].Role == 'assistant') && message.role != 'user') {
            throw new MyError('common', 'invalid relationship');
        } else if (parentMessages[0].Role == 'user' && message.role != 'assistant') {
            throw new MyError('common', 'invalid relationship');
        }
    } else if (message.role != 'assistant' && message.role != 'system') {
        throw new MyError('common', 'invalid relationship');
    }

    const [insertResult] = await pool.execute<ManipulateResult>(
        'INSERT INTO `Message` (`SessionId`, `ParentMessageId`, `Role`, `Content`) VALUES (?, ?, ?, ?)',
        [sessionId, message.parentId, message.role, message.content],
    );
    return {
        id: insertResult.insertId,
        parentId: message.parentId,
        role: message.role,
        content: message.content,
    };
}

async function updateMessage(ax: ActionContext, message: I.Message): Promise<I.Message> {

    if (!message.id || typeof message.content != 'string') {
        throw new MyError('common', 'invalid message data');
    }

    const [results] = await pool.query<QueryResult<{ MessageId: number }>[]>(
        'SELECT `Message`.`MessageId` FROM `Message`'
        + ' JOIN `Session` s ON `Message`.`SessionId` = `Session`.`SessionId` WHERE `Message`.`MessageId` = ? AND s.UserId = ?',
        [message.id, ax.userId],
    );
    if (!Array.isArray(results) || results.length == 0) {
        throw new MyError('not-found', 'invalid message id');
    }

    await pool.execute(
        'UPDATE `Message` SET `Content` = ?, `PromptTokenCount` = NULL, `CompletionTokenCount` = NULL WHERE `MessageId` = ?',
        [message.content, message.id],
    );
    return message;
}

async function removeMessageTree(ax: ActionContext, sessionId: number, messageId: number) {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    const [messages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `MessageId`, `ParentMessageId` FROM `Message` WHERE `SessionId` = ?',
        [sessionId],
    );

    // Build a map of parent -> children
    const childrenMap = new Map<number, number[]>();
    for (const message of messages) {
        if (!childrenMap.has(message.ParentMessageId)) {
            childrenMap.set(message.ParentMessageId, []);
        }
        childrenMap.get(message.ParentMessageId).push(message.MessageId);
    }

    // Collect all descendant messageIds to delete using BFS
    const toDelete = new Set<number>();
    const queue = [messageId];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!toDelete.has(current)) {
            toDelete.add(current);
            const children = childrenMap.get(current) || [];
            queue.push(...children);
        }
    }

    await pool.execute(
        `DELETE FROM \`Message\` WHERE \`SessionId\` = ? AND \`MessageId\` IN (${[...toDelete].map(() => '?').join(',')})`,
        [sessionId, ...toDelete],
    );
}

async function completeMessage(ax: ActionContext, sessionId: number, messageId: number): Promise<I.Message> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    const [messageRelationships] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `MessageId`, `ParentMessageId` FROM `Message` WHERE `SessionId` = ?',
        [sessionId],
    );
    if (!Array.isArray(messageRelationships) || !messageRelationships.some(r => r.MessageId == messageId)) {
        throw new MyError('not-found', 'invalid message id');
    }

    const messages: D.Message[] = [];
    let currentMessage = messageRelationships.find(r => r.MessageId == messageId);
    while (currentMessage.ParentMessageId) {
        messages.push(currentMessage);
        currentMessage = messageRelationships.find(r => r.MessageId == currentMessage.ParentMessageId);
    }
    messages.push(currentMessage);
    messages.reverse();

    const firstRole = messages[0].Role;
    if (firstRole != 'system' && firstRole != 'user') {
        throw new MyError('common', 'conversation must start with a system or user message');
    }
    for (let i = 0; i < messages.length; i++) {
        const { Role, Content } = messages[i];
        if (typeof Content != 'string' || Content.trim().length === 0) {
            throw new MyError('common', `message at index ${i} has empty content`);
        }
        if (i == 0) continue;
        const prevRole = messages[i - 1].Role;
        if (Role == prevRole) {
            throw new MyError('common', `messages at index ${i - 1} and ${i} have the same role (${Role})`);
        }
        // Only allow 'system' as the very first message
        if (Role == 'system' && i != 0) {
            throw new MyError('common', `'system' role can only appear as the first message (error at index ${i})`);
        }
        if (!['user', 'assistant', 'system'].includes(Role)) {
            throw new MyError('common', `invalid role "${Role}" at index ${i}`);
        }
    }
    if (messages[messages.length - 1].Role != 'user') {
        throw new MyError('common', 'conversation must end with a user message');
    }

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.aikey}`,
        },
        body: JSON.stringify({ model: 'deepseek-chat', messages }),
    });
    if (response.status != 200) {
        throw new MyError('internal', 'failed to get response');
    }

    const responseBody = await response.json() as {
        choices: {
            index: number,
            message: {
                role: string,
                content: string,
            },
            finish_reason: string,
        }[],
        usage: {
            prompt_tokens: number,
            completion_tokens: number,
            total_tokens: number,
        };
    };
    const responseContent = responseBody.choices && responseBody.choices[0] ? responseBody.choices[0].message.content : '(no response)';
    const processedContent = responseContent.trim()
        .replace(/\r?\n\r?\n/g, '\n') // remove empty line
        .split('\n').map(v => v.trim()).join('\n') // trim each line
        // additional refinements if need
        .replace(/"([^"]*)"/g, '“$1”') // replace ASCII double quotes with fullwidth quotes
        .replaceAll('...', '……') // replace ... with full width …
        .replaceAll('**', '') // remove markdown bold

    const promptTokenCount =  responseBody.usage.prompt_tokens;
    const completionTokenCount = responseBody.usage.completion_tokens;
    const [insertResult] = await pool.execute<ManipulateResult>(
        'INSERT INTO `Message` (`SessionId`, `Role`, `Content`, `PromptTokenCount`, `CompletionTokenCount`) VALUES (?, ?, ?, ?, ?)',
        [sessionId, 'assistant', processedContent, promptTokenCount, completionTokenCount]);

    return {
        id: insertResult.insertId,
        parentId: messageId,
        role: 'assistant',
        content: processedContent,
        promptTokenCount,
        completionTokenCount,
    };
}

async function shareSession(ax: ActionContext, sessionId: number): Promise<I.SharedSession> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    // Check if a shared session already exists for this session/version
    const [existingSharedSessions] = await pool.query<QueryResult<D.SharedSession>[]>(
        'SELECT `ShareId`, `ExpireTime` FROM `SharedSession` WHERE `SessionId` = ?',
        [sessionId],
    );
    if (Array.isArray(existingSharedSessions) && existingSharedSessions.length > 0) {
        if (dayjs(existingSharedSessions[0].ExpireTime).isAfter(dayjs.utc())) {
            return { id: existingSharedSessions[0].ShareId };
        } else {
            await pool.execute('DELETE FROM `SharedSession` WHERE `ShareId` = ?', [existingSharedSessions[0].ShareId]);
            // and goes to create new
        }
    }

    await pool.execute<ManipulateResult>(
        "INSERT INTO `SharedSession` (`SessionId`, `ExpireTime`) VALUES (?, '2100-12-31')",
        [sessionId],
    );
    // insertResult.insertId is number, seems cannot get guid from that
    const [newSharedSessions] = await pool.query<QueryResult<D.SharedSession>[]>(
        'SELECT `ShareId` FROM `SharedSession` WHERE `SessionId` = ?',
        [sessionId],
    );
    return { id: newSharedSessions[0].ShareId };
}
async function unshareSession(ax: ActionContext, sessionId: number) {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
        [sessionId, ax.userId],
    );
    if (!Array.isArray(sessions) || sessions.length == 0) {
        throw new MyError('not-found', 'invalid session id');
    }

    await pool.execute('DELETE FROM `SharedSession` WHERE `SessionId` = ?', [sessionId]);
}

async function getBalance(ax: ActionContext): Promise<I.AccountBalance> {
    let response: Response;
    try {
        response = await fetch('https://api.deepseek.com/user/balance', {
            headers: { 'Authorization': `Bearer ${config.aikey}` },
        });
    } catch (error) {
        console.log('request error', error);
    }

    const body: any = await response.json();
    return { balance: body.balance_infos[0].total_balance };
}

// AUTOGEN
// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------
class MyError extends Error {
    // file error middleware need this to know this is known error type
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
    public id(name: string) { return this.validate(name, false, parseInt, v => isNaN(v) || v <= 0); }
    // public idopt(name: string) { return this.validate(name, true, parseInt, v => isNaN(v) || v <= 0); }
    public string(name: string) { return this.validate(name, false, v => v, v => !!v); }
}
export async function dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const { pathname, searchParams } = new URL(ctx.path, 'https://example.com');
    const v = new ParameterValidator(searchParams);
    const ax: ActionContext = { userId: ctx.state.user.id, userName: ctx.state.user.name };
    const action = ({
        'GET /v1/sessions': () => getSessions(ax),
        'GET /v1/session-messages': () => getSessionMessages(ax, v.id('sessionId')),
        'GET /public/v1/session': () => publicGetSession(ax, v.string('shareId')),
        'PUT /v1/add-session': () => addSession(ax, ctx.body),
        'POST /v1/update-session': () => updateSession(ax, ctx.body),
        'DELETE /v1/remove-session': () => removeSession(ax, v.id('sessionId')),
        'PUT /v1/add-message': () => addMessage(ax, v.id('sessionId'), ctx.body),
        'POST /v1/update-message': () => updateMessage(ax, ctx.body),
        'DELETE /v1/remove-message-tree': () => removeMessageTree(ax, v.id('sessionId'), v.id('messageId')),
        'POST /v1/complete-message': () => completeMessage(ax, v.id('sessionId'), v.id('messageId')),
        'POST /v1/share-session': () => shareSession(ax, v.id('sessionId')),
        'POST /v1/unshare-session': () => unshareSession(ax, v.id('sessionId')),
        'GET /v1/balance': () => getBalance(ax),
    })[`${ctx.method} ${pathname}`];
    return action ? { body: await action() } : { error: new MyError('not-found', 'invalid-invocation') };
}
