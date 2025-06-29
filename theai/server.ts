import fs from 'node:fs/promises';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import mysql from 'mysql2/promise';
import type * as I from './shared.js';

// npx tsc --project tsconfig.json

dayjs.extend(utc);

/*
-- mysql -u root -p
-- GRANT ALL PRIVILEGES ON `MyChat`.* TO 'fine'@'localhost';
-- FLUSH PRIVILEGES;
-- mysql -p

CREATE TABLE `SessionDirectory` (
    `DirectoryId` INT NOT NULL AUTO_INCREMENT,
    `ParentDirectoryId` INT NULL, -- NULL for in root directory
    `Name` VARCHAR(100) NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `PK_SessionDirectory` PRIMARY KEY (`DirectoryId`),
    CONSTRAINT `FK_SessionDirectory_Parent` FOREIGN KEY (`ParentDirectoryId`) REFERENCES `SessionDirectory`(`DirectoryId`)
);
CREATE TABLE `Session` (
    `SessionId` INT NOT NULL AUTO_INCREMENT,
    `UserId` INT NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Comment` TEXT NULL,
    `DirectoryId` INT NULL,  -- NULL for in root directory
    `CreateTime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `PK_Session` PRIMARY KEY (`SessionId`),
    CONSTRAINT `FK_Session_Directory` FOREIGN KEY (`DirectoryId`) REFERENCES `SessionDirectory`(`DirectoryId`)
);
CREATE TABLE `SessionVersion` (
    `SessionId` INT NOT NULL,
    `Version` INT NOT NULL,
    `Comment` TEXT NULL,
    `PromptTokenCount` INT NULL,
    `CompletionTokenCount` INT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `PK_SessionVersion` PRIMARY KEY (`SessionId`, `Version`)
);
CREATE TABLE `Message` (
    `MessageId` INT NOT NULL AUTO_INCREMENT,
    `SessionId` INT NOT NULL,
    `Version` INT NOT NULL,
    `Sequence` INT NOT NULL,
    `Role` VARCHAR(32) NOT NULL,
    `Content` TEXT NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `PK_Message` PRIMARY KEY (`MessageId`),
    CONSTRAINT `FK_Message_Session` FOREIGN KEY (`SessionId`) REFERENCES `Session`(`SessionId`)
);
CREATE TABLE `SharedSession` (
    `ShareId` VARCHAR(36) NOT NULL DEFAULT (UUID()),
    `SessionId` INT NOT NULL,
    `Version` INT NOT NULL,
    `ExpireTime` DATETIME NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `PK_SharedSession` PRIMARY KEY (`ShareId`)
);
*/
const config = (JSON.parse(await fs.readFile('config', 'utf-8')) as {
    aikey: string,
    database: mysql.PoolOptions,
});

const pool = mysql.createPool({
    ...config.database,
    database: 'MyChat',
    typeCast: (field, next) => {
        if (field.type == 'BIT' && field.length == 1) {
            return field.buffer()![0] == 1;
        }
        return next();
    },
});
// query function need RowDataPacket, but this makes 
// the original type cannot be construct if use UserData extends RowDataPacket (missing required property),
// so use this helper generic type alias
type QueryResult<T> = T & mysql.RowDataPacket;
// result of insert/update/delete, which is data Manipulatation language Result
type ManipulateResult = mysql.ResultSetHeader;

namespace D {
    export interface Session {
        SessionId: number,
        UserId: number,
        Name: string,
        Comment: string | null,
        DirectoryId: number,
        CreateTime: string,
    }
    export interface SessionDirectory {
        DirectoryId: number,
        ParentDirectoryId: number | null,
        Name: string,
        CreateTime: string,
    }
    export interface SessionVersion {
        SessionId: number,
        Version: number,
        Comment: string | null,
        PromptTokenCount: number,
        CompletionTokenCount: number,
        CreateTime: string,
    }
    export interface Message {
        MessageId: number,
        SessionId: number,
        Version: number,
        Sequence: number,
        Role: string,
        Content: string,
        CreateTime: string,
    }
    export interface SharedSession {
        ShareId: string,
        SessionId: number,
        Version: number,
        ExpireTime: string,
        CreateTime: string,
    }
}

// GET /sessions return root SessionDirectory
async function getSessions(ax: ActionContext): Promise<I.SessionDirectory> {
    const [sessions] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId`, `Name`, `Comment`, `DirectoryId`, `CreateTime` FROM `Session` WHERE `UserId` = ?', [ax.userId]);
    const [directories] = await pool.query<QueryResult<D.SessionDirectory>[]>(
        'SELECT `DirectoryId`, `ParentDirectoryId`, `Name` FROM `SessionDirectory`;');

    // Map DirectoryId to directory node
    const directoryMap = new Map<number, I.SessionDirectory>();
    // Create all directory nodes
    for (const directory of directories) {
        directoryMap.set(directory.DirectoryId, { id: directory.DirectoryId, name: directory.Name, directories: [], sessions: [] });
    }
    // Add virtual root directory (id: 0)
    directoryMap.set(0, { id: 0, name: '', directories: [], sessions: [] });
    // Build directory tree
    for (const directory of directories) {
        const parentId = directory.ParentDirectoryId ?? 0;
        const parentDirectory = directoryMap.get(parentId);
        if (parentDirectory) {
            parentDirectory.directories.push(directoryMap.get(directory.DirectoryId)!);
        }
    }
    // Assign sessions to directories
    for (const session of sessions) {
        const directory = directoryMap.get(session.DirectoryId ?? 0);
        if (directory) {
            directory.sessions.push({ id: session.SessionId, name: session.Name, comment: session.Comment ?? '', createTime: session.CreateTime });
        }
    }
    return directoryMap.get(0)!;
}
// GET /session/:id return Session
async function getSession(ax: ActionContext, sessionId: number): Promise<I.Session> {

    const [[session]] = await pool.query<QueryResult<D.Session>[]>(
        'SELECT `SessionId`, `Name`, `Comment` FROM `Session` WHERE `SessionId` = ? AND `UserId` = ?', [sessionId, ax.userId]);
    if (!session) {
        throw new FineError('not-found', 'session not found');
    }

    const [dbVersions] = await pool.query<QueryResult<D.SessionVersion>[]>(
        'SELECT `Version`, `Comment`, `CreateTime`, `PromptTokenCount`, '
        + '`CompletionTokenCount` FROM `SessionVersion` WHERE `SessionId` = ? ORDER BY `Version` ASC', [session.SessionId]);

    // Query all messages for this session at once
    const [allMessages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `Role`, `Content`, `Version` FROM `Message` WHERE `SessionId` = ? ORDER BY `Version` ASC, `Sequence` ASC',
        [session.SessionId]
    );

    const versions: I.SessionVersion[] = [];
    for (const dbVersion of dbVersions) {
        const messages = allMessages.filter(m => m.Version === dbVersion.Version);
        versions.push({
            version: dbVersion.Version,
            comment: dbVersion.Comment ?? '',
            createTime: dbVersion.CreateTime,
            promptTokenCount: dbVersion.PromptTokenCount,
            completionTokenCount: dbVersion.CompletionTokenCount,
            messages: messages.map(m => ({
                role: m.Role,
                content: m.Content,
            })),
        });
    }

    return {
        id: session.SessionId,
        name: session.Name,
        comment: session.Comment ?? '',
        versions: versions,
    };
}

// POST /create-session return Session
async function createSession(ax: ActionContext): Promise<I.Session> {
    const [insertResult] = await pool.execute<ManipulateResult>(
        'INSERT INTO `Session` (`UserId`, `Name`) VALUES (?, ?)', [ax.userId, dayjs.utc().format('[s]-YYYYMMDD-HHmmss')]);
    await pool.execute<ManipulateResult>(
        'INSERT INTO `SessionVersion` (`SessionId`, `Version`) VALUES (?, 1)', [insertResult.insertId]);
    await pool.execute<ManipulateResult>(
        "INSERT INTO `Message` (`SessionId`, `Version`, `Sequence`, `Role`, `Content`) VALUES (?, 1, 1, 'system', 'You are a helpful assistant.')", [insertResult.insertId]);

    return await getSession(ax, insertResult.insertId);
}
// POST /update-session/:id body Session update comment
async function updateSession(ax: ActionContext, sessionId: number, session: I.Session) {

}
// POST /delete-session/:id/
async function deleteSession(ax: ActionContext, sessionId: number) {

}

// GET /public/version/:guid return SessionVersion
async function getReadonlySessionVersion(ax: ActionContext, id: string): Promise<I.SessionVersion> {

    const [[shared]] = await pool.query<QueryResult<D.SharedSession>[]>(
        'SELECT `SessionId`, `Version` FROM `SharedSession` WHERE `ShareId` = ? AND `ExpireTime` > NOW()', [id]);
    if (!shared) {
        throw new FineError('not-found', 'shared session not found or expired');
    }

    const [[dbVersion]] = await pool.query<QueryResult<D.SessionVersion>[]>(
        'SELECT `Version`, `Comment`, `CreateTime`, `PromptTokenCount`, `CompletionTokenCount` FROM `SessionVersion` WHERE `SessionId` = ? AND `Version` = ?',
        [shared.SessionId, shared.Version]);
    if (!dbVersion) {
        throw new FineError('not-found', 'session version not found');
    }

    const [dbMessages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `Role`, `Content` FROM `Message` WHERE `SessionId` = ? AND `Version` = ? ORDER BY `Sequence` ASC',
        [shared.SessionId, shared.Version]);

    return {
        version: dbVersion.Version,
        comment: dbVersion.Comment ?? '',
        createTime: dbVersion.CreateTime,
        promptTokenCount: dbVersion.PromptTokenCount,
        completionTokenCount: dbVersion.CompletionTokenCount,
        messages: dbMessages.map(m => ({
            role: m.Role,
            content: m.Content,
        })),
    };
}
// POST /create-version/:id return SessionVersion fork a version
async function createSessionVersion(ax: ActionContext, sessionId: number) {

}
// POST /update-version/:id/:version body SessionVersion update comment
async function updateSessionVersion(ax: ActionContext, sessionId: number, version: number, sessionVersion: I.SessionVersion) {

}
// POST /update-messages/:id/:version body Message[] update replace messages
async function updateMessages(ax: ActionContext, sessionId: number, version: number, messages: I.Message[]) {
    // Fetch existing messages for this session/version
    const [dbMessages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `MessageId`, `Sequence`, `Role`, `Content` FROM `Message` WHERE `SessionId` = ? AND `Version` = ? ORDER BY `Sequence` ASC',
        [sessionId, version]);

    // collect same messages at the beginning,
    const sameMessageIds: number[] = [];
    for (const message of messages) {
        const dbMessage = dbMessages.find(m => m.Role == message.role && m.Content == message.content);
        if (dbMessage) {
            sameMessageIds.push(dbMessage.MessageId);
        } else {
            break;
        }
    }

    let previousSequence = 0;
    for (const messageId of sameMessageIds) {
        const sequence = dbMessages.find(m => m.MessageId == messageId).Sequence;
        if (sequence <= previousSequence) {
            // abort keep some records
            sameMessageIds.splice(0, sameMessageIds.length);
            break;
        }
        previousSequence = sequence;
    }

    // discard other db messages
    const needDeleteMessageIds = dbMessages.filter(m => !sameMessageIds.includes(m.MessageId));
    if (needDeleteMessageIds.length > 0) {
        const placeholders = needDeleteMessageIds.map(() => '?').join(', ');
        await pool.execute(`DELETE FROM \`Message\` WHERE \`MessageId\` IN (${placeholders})`, needDeleteMessageIds);
    }

    if (messages.length > sameMessageIds.length) {
        let maxSequence = dbMessages[sameMessageIds.length - 1].Sequence;
        const values: any[] = [];
        messages.forEach((m, i) => values.push(sessionId, version, maxSequence + i + 1, m.role, m.content));
        const placeholders = messages.map(() => '(?, ?, ?, ?, ?)').join(', ');
        await pool.execute(`INSERT INTO \`Message\` (\`SessionId\`, \`Version\`, \`Sequence\`, \`Role\`, \`Content\`) VALUES ${placeholders}`, values);
    }
}
// POST /delete-version/:id/:version
async function deleteSessionVersion(ax: ActionContext, sessionId: number, version: number) {

}

// POST /completions/:id/:version return new SessionVersion
async function generateCompletion(ax: ActionContext, sessionId: number, version: number): Promise<I.SessionVersion> {

    const [[dbVersion]] = await pool.query<QueryResult<D.SessionVersion>[]>(
        'SELECT `Version`, `Comment`, `CreateTime` FROM `SessionVersion` WHERE `SessionId` = ? AND `Version` = ?',
        [sessionId, version]);
    if (!dbVersion) {
        throw new FineError('not-found', 'session version not found');
    }

    const [dbMessages] = await pool.query<QueryResult<D.Message>[]>(
        'SELECT `Role`, `Content`, `Sequence` FROM `Message` WHERE `SessionId` = ? AND `Version` = ? ORDER BY `Sequence` ASC', [sessionId, version]);
    const messages = dbMessages.map<I.Message>(m => ({ role: m.Role, content: m.Content }));

    if (!Array.isArray(messages) || messages.length == 0) {
        throw new FineError('common', 'messages must be a non-empty array');
    }
    const firstRole = messages[0].role;
    if (firstRole != 'system' && firstRole != 'user') {
        throw new FineError('common', 'conversation must start with a system or user message');
    }
    for (let i = 0; i < messages.length; i++) {
        const { role, content } = messages[i];
        if (typeof content !== 'string' || content.trim().length === 0) {
            throw new FineError('common', `message at index ${i} has empty content`);
        }
        if (i == 0) continue;
        const prevRole = messages[i - 1].role;
        if (role === prevRole) {
            throw new FineError('common', `messages at index ${i - 1} and ${i} have the same role (${role})`);
        }
        // Only allow 'system' as the very first message
        if (role == 'system' && i !== 0) {
            throw new FineError('common', `'system' role can only appear as the first message (error at index ${i})`);
        }
        if (!['user', 'assistant', 'system'].includes(role)) {
            throw new FineError('common', `invalid role "${role}" at index ${i}`);
        }
    }
    if (messages[messages.length - 1].role !== 'user') {
        throw new FineError('common', 'conversation must end with a user message');
    }

    let response: Response;
    try {
        response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.aikey}`,
            },
            body: JSON.stringify({ model: 'deepseek-chat', messages }),
        });
    } catch (error) {
        console.log('request error', error);
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
    const responseMessage = responseBody.choices && responseBody.choices[0] ? responseBody.choices[0].message.content : '(no response)';
    const processedMessage = responseMessage.trim()
        .replace(/\r?\n\r?\n/g, '\n') // remove empty line
        .split('\n').map(v => v.trim()).join('\n') // trim each line
        // additional refinements if need
        .replace(/"([^"]*)"/g, '“$1”') // replace ASCII double quotes with fullwidth quotes
        .replaceAll('...', '……') // replace ... with full width …
        .replaceAll('**', '') // remove markdown bold

    dbVersion.PromptTokenCount = responseBody.usage.prompt_tokens;
    dbVersion.CompletionTokenCount = responseBody.usage.completion_tokens;
    await pool.execute(
        'UPDATE `SessionVersion` SET `PromptTokenCount` = ?, `CompletionTokenCount` = ? WHERE `SessionId` = ? AND `Version` = ?;', 
        [dbVersion.PromptTokenCount, dbVersion.CompletionTokenCount, sessionId, version]);

    messages.push({ role: 'assistant', content: processedMessage });
    messages.push({ role: 'user', content: '' });
    const sequence = dbMessages[messages.length - 3].Sequence;
    await pool.execute(
        'INSERT INTO `Message` (`SessionId`, `Version`, `Sequence`, `Role`, `Content`) VALUES (?, ?, ?, ?, ?)',
        [sessionId, version, sequence, 'assistant', processedMessage]);

    return {
        version: dbVersion.Version,
        comment: dbVersion.Comment ?? '',
        createTime: dbVersion.CreateTime,
        promptTokenCount: dbVersion.PromptTokenCount,
        completionTokenCount: dbVersion.CompletionTokenCount,
        messages,
    };
}

// POST /share-version/:id/:version return ShareResult
async function ShareSessionVersion(ax: ActionContext, sessionId: number, version: number): Promise<I.ShareResult> {
    const [result] = await pool.execute<ManipulateResult>(
        'INSERT INTO `SharedSession` (`SessionId`, `Version`, `ExpireTime`) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))',
        [sessionId, version]
    );
    const [[shared]] = await pool.query<QueryResult<D.SharedSession>[]>(
        'SELECT `ShareId` FROM `SharedSession` WHERE `SessionId` = ? AND `Version` = ? ORDER BY `CreateTime` DESC LIMIT 1',
        [sessionId, version]
    );
    if (!shared) {
        throw new FineError('internal', 'failed to create shared session');
    }
    return { id: shared.ShareId };
}
// POST /unshare-version/:id/:version
async function UnshareSessionVersion(ax: ActionContext, sessionId: number, version: number) {

}

type FineErrorKind =
    | 'common'
    | 'not-found'
    | 'auth'
    | 'unreachable'
    | 'rate-limit'
    | 'method-not-allowed'
    | 'internal'
    | 'bad-gateway'
    | 'service-not-available'
    | 'gateway-timeout';
class FineError {
    public readonly name: string;
    public constructor(
        public readonly kind: FineErrorKind,
        public readonly message?: string,
    ) {
        this.name = 'FineError';
    }
}
interface DispatchContext {
    method: string,
    // GET api.domain.com/app1/v1/something
    //           this part:   ^^^^^^^^^^^^^
    path: string,
    state: { public: boolean, user: { id: number, name: string } },
    body: any,
}
interface DispatchResult {
    status?: number,
    body?: any,
    error?: FineError,
}
interface ActionContext {
    userId: number,
    userName: string,
}
export async function dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const ax: ActionContext = { userId: ctx.state.user.id, userName: ctx.state.user.name };
    const result: DispatchResult = {};
    try {
        let match: RegExpExecArray;
        // TODO change parameters to query!
        if (!ctx.state.public) {
            if (ctx.method == 'GET' && ctx.path == '/v1/sessions') { result.body = await getSessions(ax); return result; }
            match = /\/v1\/session\/(?<id>\d+)/.exec(ctx.path);
            if (ctx.method == 'GET' && match) { result.body = await getSession(ax, parseInt(match.groups.id)); return result; }
            if (ctx.method == 'POST' && ctx.path == '/v1/create-session') { result.body = await createSession(ax); return result; }
            match = /\/v1\/update-messages\/(?<id>\d+)\/(?<version>\d+)/.exec(ctx.path);
            if (ctx.method == 'POST' && match) { result.body = await updateMessages(ax, parseInt(match.groups.id), parseInt(match.groups.version), ctx.body); return result; }
            match = /\/v1\/completions\/(?<id>\d+)\/(?<version>\d+)/.exec(ctx.path);
            if (ctx.method == 'POST' && match) { result.body = await generateCompletion(ax, parseInt(match.groups.id), parseInt(match.groups.version)); return result; }
            match = /\/v1\/share-version\/(?<id>\d+)\/(?<version>\d+)/.exec(ctx.path);
            if (ctx.method == 'POST' && match) { result.body = await ShareSessionVersion(ax, parseInt(match.groups.id), parseInt(match.groups.version)); return result; }
        } else {
            match = /\/v1\/version\/(?<guid>[a-fA-F0-9-]+)/.exec(ctx.path);
            if (ctx.method == 'GET' && match) { result.body = await getReadonlySessionVersion(ax, match.groups.guid); return result; }
        }
    } catch (error) {
        result.error = error;
        return result;
    }
    result.error = new FineError('not-found', 'invalid invocation');
    return result;
}
