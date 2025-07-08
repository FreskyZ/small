import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

// NOTE to collect deepseek website new sessions
// - provide access token
// - run this script, check dssr-new.json content, maybe diff dssr.json dssr-new.json, replace dssr.json by dssr-new.json
// - check database inserted records

// JSON.parse(localStorage.userToken).value
const accessToken = process.env.DEEPSEEK_WEB_ACCESSTOKEN;

// CREATE TABLE `dsession` (
//    `id` CHAR(36) NOT NULL,
//    `seq_id` INT NOT NULL,
//    `title` VARCHAR(100) NOT NULL, -- title is nullable in api, I use (no title) placeholder for that
//    -- `title_type` VARCHAR(10) NOT NULL, -- not meaningful
//    -- `version` INT NOT NULL, -- not meaningful for now
//    -- `current_message_id` -- this is always max message id so no need
//    `inserted_at` DATETIME NOT NULL,
//    `updated_at` DATETIME NOT NULL,
//    CONSTRAINT `pk_dession` PRIMARY KEY (`id`)
// );
// CREATE TABLE `dmessage` (
//    `session_id` CHAR(36) NOT NULL,
//    `message_id` INT NOT NULL,
//    `parent_id` INT NULL,
//    `role` VARCHAR(20) NOT NULL,
//    `content` TEXT NOT NULL,
//    `thinking_enabled` BIT NOT NULL,
//    `thinking_content` TEXT NULL,
//    -- `thinking_elapsed_secs` INT NULL, -- not meaningful
//    -- search result not quite meaningful, to make things worse, they are mainly in Chinese
//    `search_enabled` BIT NOT NULL,
//    -- `ban_edit` BIT NOT NULL, -- add later if this becomes useful
//    -- `ban_regenerate` BIT NOT NULL, -- add later if this becomes useful
//    -- `status` VARCHAR(20) NOT NULL, -- for now discard INCOMPLETE and CONTENT_FILTER sessions
//    `accumulated_token_usage` INT NOT NULL,
//    -- files need (`session_id`, `message_id`, `file_id`) table, for now I don't use files so no for now
//    -- tips and tip_content_risk are not meaningful
//    `inserted_at` DATETIME NOT NULL, -- no update time, deepseek website does not have that
//    CONSTRAINT `pk_dmessage` PRIMARY KEY (`session_id`, `message_id`),
//    CONSTRAINT `fk_dmessage_dsession` FOREIGN KEY (`session_id`) REFERENCES `dsession`(`id`)
// );

interface ChatMessageFile {
    id: string, // `file-${GUID}`
    status: 'SUCCESS', // according to current few records, only this
    file_name: string,
    file_size: number,
    token_usage: number,
    error_code: null,
    inserted_at: number,
    updated_at: number,
}
interface ChatMessageSearchResult {
    url: string,
    title: string,
    snippet: string,
    cite_index: number | null, // this is simply local cite index, use like [citation:8]
    published_at: number | null,
    site_name: string,
    site_icon: string, // url
}

// confirmed by current records that all property available in all objects
interface ChatSessionInfo {
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
interface ChatMessage {
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
    files: ChatMessageFile[],
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
    search_results: ChatMessageSearchResult[] | null,
}
interface ChatSession {
    chat_session: ChatSessionInfo,
    chat_messages: ChatMessage[],
    cache_valid: false, // type confirmed by current records
    route_id: null, // type confirmed by current records
}
interface ListChatSessionResult {
    chat_sessions: ChatSessionInfo[],
    has_more: boolean,
}

const rawSessionStorage = JSON.parse(await fs.readFile('dssr.json', 'utf-8')) as ChatSession[];

const headers = { "Authorization": `Bearer ${accessToken}` };
const listResponse = await fetch("https://chat.deepseek.com/api/v0/chat_session/fetch_page", { headers });
const listResponseData = (await listResponse.json()).data.biz_data as ListChatSessionResult;

const newSessions: ChatSession[] = [];
for (const responseSession of listResponseData.chat_sessions) {
    if (rawSessionStorage.some(s => s.chat_session.id == responseSession.id)) {
        // console.log(`skip raw stored session ${responseSession.id}`);
        continue;
    }

    console.log(`downloading session ${responseSession.id}`);
    const fullResponse = await fetch(`https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${responseSession.id}`, { headers });
    const fullResponseData = (await fullResponse.json()).data.biz_data as ChatSession;
    console.log(`received session`, fullResponseData);
    newSessions.push(fullResponseData);
    await new Promise(resolve => setTimeout(resolve, 1000)); // delay 1s should be fully safe
}

// validate
const validateResult: string[] = [];
if (new Set(newSessions.map(s => s.chat_session.id)).size != newSessions.length) {
    validateResult.push(`duplicate session id in new data`);
}
if (new Set(newSessions.map(s => s.chat_session.seq_id)).size != newSessions.length) {
    validateResult.push(`duplicate session seq_id in new data`);
}
for (const session of newSessions) {
    if (!session.chat_session || typeof session.chat_session != 'object') {
        validateResult.push('session missing chat_session?'); continue;
    }
    const info = session.chat_session;

    // newSessions is determined by id same, if you quickly forget
    if (rawSessionStorage.some(r => r.chat_session.seq_id == info.seq_id)) {
        validateResult.push(`session ${info.seq_id} already exist in raw data`);
    }

    const infoPropertyNames = Object.keys(info).sort((a, b) => a.localeCompare(b));
    const expectedPropertyNames = ['id', 'seq_id', 'agent', 'character',
        'title', 'title_type', 'version', 'current_message_id', 'inserted_at', 'updated_at'].sort((a, b) => a.localeCompare(b));
    if (infoPropertyNames.length != expectedPropertyNames.length || infoPropertyNames.map((n, i) => expectedPropertyNames[i] != n)) {
        validateResult.push(`session ${info.seq_id} property name mismatch`);
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
    if (typeof info.title != 'string') {
        validateResult.push(`session ${info.seq_id} missing title, you'd better add one on the website`);
    }
    if (typeof info.inserted_at != 'number' || typeof info.updated_at != 'number') {
        validateResult.push(`session ${info.seq_id} inserted_at or updated_at is not number`);
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
            if (messagePropertyNames.length != expectedPropertyNames.length || messagePropertyNames.map((n, i) => expectedPropertyNames[i] != n)) {
                validateResult.push(`session ${info.seq_id} message ${message.message_id} property name mismatch`);
            }

            if (message.parent_id && typeof message.parent_id != 'number') {
                validateResult.push(`session ${info.seq_id} message ${message.message_id} invalid parent_id`);
            }
            if (message.role != 'USER' && message.role != 'ASSISTANT') {
                validateResult.push(`session ${info.seq_id} message ${message.message_id} invalid role`);
            }
            if (message.thinking_enabled) {
                if (message.role == 'USER' && message.thinking_content) {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} user should not have thinking_content`);
                // NOTE thinking content can still be null when assistant is thinking enabled
                } else if (message.role == 'ASSISTANT' && message.thinking_content && typeof message.thinking_content != 'string') {
                    validateResult.push(`session ${info.seq_id} message ${message.message_id} thinking_content is not string`);
                }
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
        }
    }
}

if (validateResult.length) {
    validateResult.forEach(v => console.log(v));
    console.log('there are real validation errors? when will this happen?');
    process.exit(1);
}
newSessions.forEach(s => rawSessionStorage.push(s));
fs.writeFile('dssr-new.json', JSON.stringify(rawSessionStorage));

const config = JSON.parse(await fs.readFile('../config', 'utf-8')) as {
    database: mysql.PoolOptions,
}

type QueryResult<T> = T & mysql.RowDataPacket;
type ManipulateResult = mysql.ResultSetHeader;
const connection = await mysql.createConnection({ ...config.database, database: 'MyChat' });

// no transaction here, so should check both sessionid and messageid existance
const [dbSessions] = await connection.query<QueryResult<{ id: string }>[]>(
    "SELECT `id` FROM `dsession`;",
);
const [dbMessages] = await connection.query<QueryResult<{ session_id: string, message_id: number }>[]>(
    "SELECT `session_id`, `message_id` FROM `dmessage`;",
);

for (const session of rawSessionStorage) {

    const info = session.chat_session;
    const indatabase = dbSessions.some(d => d.id == info.id);
    if (!indatabase) {
        await connection.execute(
            "INSERT INTO `dsession` (`id`, `seq_id`, `title`, `title_type`, `inserted_at`, `updated_at`)"
            + " VALUES (?, ?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?));",
            [info.id, info.seq_id, info.title, info.title_type, info.inserted_at, info.updated_at],
        );
        console.log(`database insert session ${info.id}`);
    }
    for (const message of session.chat_messages) {
        if (!dbMessages.some(m => m.session_id == info.id && m.message_id == message.message_id)) {
            await connection.execute(
                "INSERT INTO `dmessage` (`session_id`, `message_id`, `parent_id`, `role`, `content`,"
                + " `thinking_enabled`, `thinking_content`, `accumulated_token_usage`, `inserted_at`, `search_enabled`)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), ?)",
                [
                    info.id, message.message_id, message.parent_id, message.role, message.content,
                    message.thinking_enabled, message.thinking_content, message.accumulated_token_usage, message.inserted_at, message.search_enabled,
                ],
            );
            if (indatabase) {
                console.log(`database insert existing session missing message ${info.id} ${message.message_id}, when will this happen?`);
            }
        }
    }
}
await connection.end();

// TODO furthur steps investigate search by embedding similarity
