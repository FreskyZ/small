// TODO try validate runtime 3rd party dependency is same as core module, also package.json
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
const pool = mysql.createPool({ ...config.database, database: 'MyChat', typeCast: (field, next) => {
    return field.type == 'BIT' && field.length == 1 ? field.buffer()[0] == 1 : next();
} });

// GET /sessions return root SessionDirectory
async function getSessions(ax: ActionContext): Promise<I.Session[]> {

    const [sessions] = await pool.query<QueryResult<D.Session & { ShareId: string | null }>[]>(
        'SELECT `SessionId`, `Name`, `Comment`, `Tags`, `CreateTime`, `Shared`, `ShareId` FROM `Session` WHERE `UserId` = ? ORDER BY `CreateTime` DESC',
        [ax.userId],
    );
    return sessions.map<I.Session>(s => ({
        id: s.SessionId,
        name: s.Name,
        comment: s.Comment,
        createTime: s.CreateTime,
        tags: s.Tags?.split(',') ?? [],
        shareId: s.Shared ? s.ShareId : null,
        messages: [], // get list api does not include messages
    }));
}
async function getSessionMessages(ax: ActionContext, sessionId: number): Promise<I.Message[]> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?',
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
    messages.sort((a, b) => a.MessageId - b.MessageId);

    return messages.map<I.Message>(m => ({
        id: m.MessageId,
        parentId: m.ParentMessageId,
        role: m.Role,
        content: m.Content,
        promptTokenCount: m.PromptTokenCount,
        completionTokenCount: m.CompletionTokenCount,
    }));
}

// ATTENTION no user info for public api, this ax parameter should never be used
async function publicGetSession(_ax: ActionContext, shareId: string): Promise<I.Session> {

    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId`, `Name`, `Comment`, `Tags`, `Shared`, `CreateTime` FROM `Session` WHERE `ShareId` = ?',
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
        'SELECT `MessageId`, `ParentMessageId`, `Role`, `Content`, `PromptTokenCount`, `CompletionTokenCount` FROM `Message` WHERE `SessionId` = ?',
        [session.SessionId],
    );

    return {
        id: session.SessionId,
        name: session.Name,
        comment: session.Comment,
        tags: [],
        createTime: '',
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

async function addSession(ax: ActionContext, withName: I.Session): Promise<I.Session> {
    const newName = withName.name ?? ax.now.format('[s]-YYYYMMDD-HHmmss');

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
    const [insertResult2] = await pool.execute<ManipulateResult>(
        "INSERT INTO `Message` (`SessionId`, `Role`, `Content`) VALUES (?, 'system', 'You are a helpful assistant.')",
        [insertResult.insertId],
    );

    return {
        id: insertResult.insertId,
        name: newName,
        createTime: ax.now.toISOString(),
        tags: [],
        messages: [{
            id: insertResult2.insertId,
            role: 'system',
            content: 'You are a helpful assistant.',
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
        'UPDATE `Session` SET `Name` = ?, `Comment` = ?, `Tags` = ? WHERE `SessionId` = ?',
        [session.name, session.comment, session.tags.join(','), session.id],
    );
    return session;
}
async function removeSession(ax: ActionContext, sessionId: number) {
    await validateSessionUser(ax, sessionId);

    const [messages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `MessageId` FROM `Message` WHERE `SessionId` = ?',
        [sessionId],
    );
    if (messages.length <= 1) {
        throw new MyError('common', 'cannot delete last message');
    }

    await pool.execute('DELETE FROM `Message` WHERE `SessionId` = ?', [sessionId]);
    await pool.execute('DELETE FROM `Session` WHERE `SessionId` = ?', [sessionId]);
}

async function addMessage(ax: ActionContext, sessionId: number, message: I.Message): Promise<I.Message> {
    await validateSessionUser(ax, sessionId);

    if (message.parentId) {
        const [parentMessages] = await pool.query<QueryResult<D.Message>[]>(
            'SELECT `Role` FROM `Message` WHERE `MessageId` = ?',
            [message.parentId],
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

async function updateMessage(ax: ActionContext, sessionId: number, message: I.Message): Promise<I.Message> {
    await validateSessionUser(ax, sessionId);

    await pool.execute(
        'UPDATE `Message` SET `Content` = ?, `PromptTokenCount` = NULL, `CompletionTokenCount` = NULL WHERE `MessageId` = ?',
        [message.content, message.id],
    );
    return message;
}

async function removeMessageTree(ax: ActionContext, sessionId: number, messageId: number) {
    await validateSessionUser(ax, sessionId);

    const [messageRelationships] = await pool.query<QueryResult<Pick<D.Message, 'MessageId' | 'ParentMessageId'>>[]>(
        'SELECT `MessageId`, `ParentMessageId` FROM `Message` WHERE `SessionId` = ?',
        [sessionId],
    );

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
        `SELECT \`MessageId\`, \`Role\`, \`Content\` FROM \`Message\` WHERE \`MessageId\` IN (${messageIds.map(() => '?').join(',')}) ORDER BY \`MessageId\``,
        messageIds,
    );

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

    interface CompletionAPIResponse {
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
    }
    const responseBody = await response.json() as CompletionAPIResponse;
    const responseContent = responseBody.choices && responseBody.choices[0] ? responseBody.choices[0].message.content : '(no response)';
    const processedContent = responseContent.trim()
        // .replace(/\r?\n\r?\n/g, '\n') // remove empty line
        // .split('\n').map(v => v.trim()).join('\n') // trim each line
        // additional refinements if need
        // .replace(/"([^"]*)"/g, '“$1”') // replace ASCII double quotes with fullwidth quotes
        // .replaceAll('...', '……') // replace ... with full width …
        // .replaceAll('**', '') // remove markdown bold

    const promptTokenCount =  responseBody.usage.prompt_tokens;
    const completionTokenCount = responseBody.usage.completion_tokens;

    // complete message works as external service is adding message
    const [insertResult] = await pool.execute<ManipulateResult>(
        "INSERT INTO `Message` (`SessionId`, `ParentMessageId`, `Role`, `Content`, `PromptTokenCount`, `CompletionTokenCount`) VALUES (?, ?, 'assistant', ?, ?, ?)",
        [sessionId, messageId, processedContent, promptTokenCount, completionTokenCount],
    );

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
    // public idopt(name: string) { return this.validate(name, true, parseInt, v => !isNaN(v) && v > 0); }
    public string(name: string) { return this.validate(name, false, v => v, v => !!v); }
}
export async function dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const { pathname, searchParams } = new URL(ctx.path, 'https://example.com');
    const v = new ParameterValidator(searchParams);
    const ax: ActionContext = { now: ctx.state.now, userId: ctx.state.user?.id, userName: ctx.state.user?.name };
    const action = ({
        'GET /v1/sessions': () => getSessions(ax),
        'GET /v1/session-messages': () => getSessionMessages(ax, v.id('sessionId')),
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
    } as Record<string, () => Promise<any>>)[`${ctx.method} ${pathname}`];
    return action ? { body: await action() } : { error: new MyError('not-found', 'invalid-invocation') };
}
