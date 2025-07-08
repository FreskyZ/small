import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

// JSON.parse(localStorage.userToken).value
// const accessToken = process.env.DEEPSEEK_WEB_ACCESSTOKEN;

// # STEP 1 try get sessions api
// let response = await fetch("https://chat.deepseek.com/api/v0/chat_session/fetch_page", { headers: { "Authorization": `Bearer ${accessToken}` } });
// let responseData = (await response.json()).data.biz_data;
// await fs.writeFile('sessions1.json', JSON.stringify(responseData));

// # STEP 2 get all sessions, batch by batch
// let batchIndex = 2;
// let hasMore = true;
// let lastSeqId = 1000583;
// while (hasMore) {
//     const response = await fetch(`https://chat.deepseek.com/api/v0/chat_session/fetch_page?before_seq_id=${lastSeqId}`, { headers: { "Authorization": `Bearer ${accessToken}` } });
//     console.log(response.headers);
//     const responseData = (await response.json()).data.biz_data;
//     await fs.writeFile(`session${batchIndex}.json`, JSON.stringify(responseData));
//     batchIndex += 1;
//     hasMore = responseData.has_more;
//     lastSeqId = responseData.chat_sessions[responseData.chat_sessions.length - 1].seq_id;
// }

// # STEP 3 merge
// const allsessions: FetchPageResult['chat_sessions'] = [];
// for (const i of [1, 2, 3, 4, 5, 6]) {
//     const sessions = JSON.parse(await fs.readFile(`session${i}.json`, 'utf-8')) as FetchPageResult;
//     sessions.chat_sessions.forEach(s => allsessions.push(s));
// }
// await fs.writeFile('sessions.json', JSON.stringify(allsessions));

// # STEP 4 try get messages api
// const sessions = JSON.parse(await fs.readFile('sessions.json', 'utf-8')) as FetchPageResult['chat_sessions'];
// // check seq_id no duplicate so use seq_id to store file
// // if (new Set(sessions.map(s => s.seq_id)).size != sessions.length) {
// //     throw new Error('duplicate seq_id');
// // }
// for (const session of sessions) {
//     if (syncfs.existsSync(`raw/messages${session.seq_id}.json`)) {
//         console.log(`session#${session.seq_id} exist, continue`);
//         continue;
//     }
//     console.log(`processing session#${session.seq_id} ${session.title}`);
//     const response = await fetch(`https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${session.id}`, { headers: { "Authorization": `Bearer ${accessToken}` } });
//     const responseData = (await response.json()).data.biz_data;
//     const serialized = JSON.stringify(responseData);
//     console.log(serialized);
//     await fs.writeFile(`raw/messages${session.seq_id}.json`, serialized);
//     await new Promise(resolve => setTimeout(resolve, 3000));
// }

// # STEP 5 merge

// const fileNames: string[] = [];
// for (const entry of await fs.readdir('raw')) {
//     const match = /^messages(\d+)\.json$/.exec(entry);
//     if (match) { fileNames.push(`raw/${entry}`); }
// }
// const allMessages = await Promise.all(fileNames.map(async n => JSON.parse(await fs.readFile(n, 'utf-8'))));
// await fs.writeFile('messages.json', JSON.stringify(allMessages));

// # STEP 5.5 validate sessions.json is all in messages.json

// const sessions = JSON.parse(await fs.readFile('sessions.json', 'utf-8'));
// const allMessages = JSON.parse(await fs.readFile('messages.json', 'utf-8'));

// // validate all properties all plain number/string
// for (const session of sessions) {
//     for (const [key, value] of Object.entries(session)) {
//         if (typeof value != 'string' && typeof value != 'number' && value !== null) {
//             console.log(`session#${session.seq_id} property ${key} value ${value} neither string nor number`);
//         }
//     }
// }
// // validate messages top level data structure
// for (const messages of allMessages) {
//     const propertyNames = Object.keys(messages);
//     UPDATE this validation is incorrect, more validation later
//     if (propertyNames.length != 2 && propertyNames[0] != 'chat_session' && propertyNames[1] != 'chat_messages') {
//         console.log('unexpected data structure', messages);
//     }
// }
// validate sessions.json is all in messages.json
// for (const session of sessions) {
//     const messages = allMessages.find(m => m.chat_session.id == session.id);
//     if (!messages) { console.log('session not found in messages?', session); continue; }
//     for (const [propertyName, propertyValue] of Object.entries(session)) {
//         if (!(propertyName in messages.chat_session)) {
//             console.log(`session#${session.seq_id} property ${propertyName} not found in messages`, session, messages.chat_session);
//         } else if (propertyValue !== messages.chat_session[propertyName]) {
//             console.log(`session#${session.seq_id} property ${propertyName} not same in messages`, session, messages.chat_session);
//         }
//     }
// }
// RESULT: all passed, so discard sessions.json, rename messages.json to sessions.json, and type definitions

// CREATE TABLE `dsession` (
//    `id` CHAR(36) NOT NULL,
//    `seq_id` INT NOT NULL,
//    `title` VARCHAR(100) NOT NULL, -- title is nullable in api, I use (no title) placeholder for that
//    `title_type` VARCHAR(10) NOT NULL,
//    -- `version` INT NOT NULL, -- add later if this is found to be useful
//    -- `current_message_id` -- add later if this is found to be useful
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
//    -- `ban_edit` BIT NOT NULL, -- add later if this becomes useful
//    -- `ban_regenerate` BIT NOT NULL, -- add later if this becomes useful
//    -- `status` VARCHAR(20) NOT NULL, -- for now discard INCOMPLETE and CONTENT_FILTER sessions
//    `accumulated_token_usage` INT NOT NULL,
//    -- files need (`session_id`, `message_id`, `file_id`) table, for now I don't use files so no for now
//    -- tips and tip_content_risk are not meaningful
//    `inserted_at` DATETIME NOT NULL, -- no update time, deepseek website does not have that
//    -- search result not quite meaningful, to make things worse, they are mainly in Chinese
//    `search_enabled` BIT NOT NULL,
//    CONSTRAINT `pk_dmessage` PRIMARY KEY (`session_id`, `message_id`),
//    CONSTRAINT `fk_dmessage_dsession` FOREIGN KEY (`session_id`) REFERENCES `dsession`(`id`)
// );

// confirmed by current records that all property available in all objects
interface Session {
    id: string, // guid string
    seq_id: number,
    agent: 'chat', // type confirmed by current records
    character: null, // type confirmed by current records
    title: string | null, // note deepseek website don't forbid you from make title empty, this result in title: null
    title_type: 'SYSTEM' | 'USER', // type confirmed by current records
    version: number, // this seems not to be something like data structure version, but a leaf-node-count version
    current_message_id: number,
    inserted_at: number, // timestamp number
    updated_at: number, // timestamp number
}
interface Message {
    message_id: number, // this is inside a ssession
    parent_id: number, // this seems not the same mechanism like I design
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
    files: MessageFile[],
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
    search_results: SearchResult[] | null,
}
interface FetchPageResult {
    chat_sessions: Session[],
    has_more: boolean,
}
interface HistoryMessageResult {
    chat_session: Session,
    chat_messages: Message[],
    cache_valid: false, // type confirmed by current records
    route_id: null, // type confirmed by current records
}

interface MessageFile {
    id: string, // `file-${GUID}`
    status: 'SUCCESS', // according to current few records, only this
    file_name: string,
    file_size: number,
    token_usage: number,
    error_code: null,
    inserted_at: number,
    updated_at: number,
}
interface SearchResult {
    url: string,
    title: string,
    snippet: string,
    cite_index: number | null, // this is simply local cite index, use like [citation:8]
    published_at: number | null,
    site_name: string,
    site_icon: string, // url
}

// by the way, if you'd like to store binary, guid is better stored as [int32; 4]
// function guidToInt32Array(guid: string): number[] {
//     const bytes = guid.replace(/-/g, '').match(/.{2}/g)?.map(b => parseInt(b, 16)) ?? [];
//     const arr: number[] = [];
//     for (let i = 0; i < bytes.length; i += 4) {
//         arr.push(
//             ((bytes[i] ?? 0) << 24) |
//             ((bytes[i + 1] ?? 0) << 16) |
//             ((bytes[i + 2] ?? 0) << 8) |
//             ((bytes[i + 3] ?? 0))
//         );
//     }
//     return arr;
// }

// # STEP 6 download new sessions
// with assumption that I will not generate 100 sessions and goto here to backup

const sessions = JSON.parse(await fs.readFile('sessions.json', 'utf-8')) as HistoryMessageResult[];
console.log(`read ${sessions.length} sessions from sessions.json`);

// const listResponse = await fetch("https://chat.deepseek.com/api/v0/chat_session/fetch_page", { headers: { "Authorization": `Bearer ${accessToken}` } });
// const listResponseData = (await listResponse.json()).data.biz_data as FetchPageResult;

// for (const responseSession of listResponseData.chat_sessions) {
//     if (sessions.some(s => s.chat_session.id == responseSession.id)) {
//         console.log('found record, break at ', responseSession);
//         break;
//     }
//     console.log('downloading session', responseSession);
//     const messagesResponse = await fetch(`https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${responseSession.id}`, { headers: { "Authorization": `Bearer ${accessToken}` } });
//     const messagesResponseData = (await messagesResponse.json()).data.biz_data as HistoryMessageResult;
//     console.log(`received`, messagesResponseData);
//     sessions.push(messagesResponseData);
//     await new Promise(resolve => setTimeout(resolve, 1000));
// }

// fs.writeFile('sessions.json', JSON.stringify(sessions));

// # STEP 7 validate and inspect data structure

// for (const session of sessions) {

    // result: no
    // if (session.cache_valid) {
    //     console.log('cache valid: ', session);
    // }
    // if (session.route_id !== null) {
    //     console.log('has route id: ', session);
    // }
    // result: no
    // if (new Set(sessions.map(s => s.chat_session.seq_id)).size != sessions.length) {
    //     console.log('duplicate seq_id');
    // }

    // const info = session.chat_session;
    // result: no
    // const infoPropertyNames = Object.keys(info);
    // const expectedPropertyNames = ['id', 'seq_id', 'agent', 'character', 'title', 'title_type', 'version', 'current_message_id', 'inserted_at', 'updated_at'];
    // if (infoPropertyNames.some(i => !expectedPropertyNames.includes(i))) {
    //     console.log(`session#${info.seq_id} property mismatch`, infoPropertyNames);
    // } else if (expectedPropertyNames.some(e => !infoPropertyNames.includes(e))) {
    //     console.log(`session#${info.seq_id} property mismatch`, infoPropertyNames);
    // }

    // result: no
    // if (typeof info.id != 'string') {
    //     console.log('id not string', session);
    // }
    // if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(info.id)) {
    //     console.log('id not guid format', info.id, session);
    // }
    // result: no
    // if (typeof info.seq_id != 'number') {
    //     console.log('seq_id not number', session);
    // }

    // result: no
    // if (info.agent != 'chat') {
    //     console.log('agent not chat', session);
    // }
    // if (info.character !== null) {
    //     console.log('character not null', session);
    // }

    // result: 1 error
    // if (!info.title) {
    //     console.log('no title', session);
    // }
    // result: ok
    // if (info.title_type != 'SYSTEM' && info.title_type != 'USER') {
    //     console.log('unknown title type', session);
    // }

    // result: too many
    // if (info.version != 2 && info.version != 3 && info.version != 21 && info.version != 4 && info.version != 6) {
    //     console.log('unknown version', session);
    // }
    // result: ok
    // if (typeof info.version != 'number') {
    //     console.log('unknown version', session);
    // }

    // result: ok
    // if (typeof info.current_message_id != 'number') {
    //     console.log('unknown current message id', session);
    // }
    // result: ok
    // if (typeof info.inserted_at != 'number' || typeof info.updated_at != 'number') {
    //     console.log('unknown time', session);
    // }

    // for (const message of session.chat_messages) {

        // result: optional tip_content_risk property
        // const propertyNames = Object.keys(message);
        // const expectedPropertyNames = [
        //     'message_id', 'parent_id', 'model', 'role', 'content', 'thinking_enabled', 'thinking_content', 'thinking_elapsed_secs',
        //     'ban_edit', 'ban_regenerate', 'status', 'accumulated_token_usage', 'files', 'tips', 'inserted_at', 'search_enabled', 'search_status', 'search_results',
        // ];
        // if (propertyNames.filter(p => p != 'tip_content_risk').some(i => !expectedPropertyNames.includes(i))) {
        //     console.log(`property mismatch`, info, message);
        // } else if (expectedPropertyNames.some(e => !propertyNames.includes(e))) {
        //     console.log(`property mismatch(2)`, info, message);
        // }

        // result: ok
        // if (typeof message.message_id != 'number') {
        //     console.log('invalid message id', info, message);
        // }
        // if (message.parent_id && typeof message.parent_id != 'number') {
        //     console.log('invalid parent id', info, message);
        // }
        // if (message.model !== '') {
        //     console.log('unknown model', info, message);
        // }
        // result: ok
        // if (message.role != 'USER' && message.role != 'ASSISTANT') {
        //     console.log('unknown role', info, message);
        // }

        // result: recorded
        // if (message.thinking_enabled) {
        //     if (message.role == 'USER') {
        //         // why is user thinging?
        //         if (message.thinking_content !== null || message.thinking_elapsed_secs !== null) {
        //             console.log('user is thinking but have thinking content', info, message);
        //         }
        //     } else {
        //         if (typeof message.thinking_content != 'string' || typeof message.thinking_elapsed_secs != 'number') {
        //             if (!message.ban_edit || !message.ban_regenerate) {
        //                 console.log('thinkging content or elapsed secs missing', info, message);
        //             }
        //         }
        //     }
        // }

        // result: 1 record, this is true harmonized
        // if ((message.ban_edit && !message.ban_regenerate) || (!message.ban_edit && message.ban_regenerate)) {
        //     console.log('different ban_edit and ban_regnerate', info, message);
        // }
        // result: recorded
        // if (message.ban_edit) {
        //     if (!message.thinking_enabled) {
        //         console.log('ban edit without thinking enabled', info, message);
        //     }
        // }
        // if (message.thinking_enabled && !message.ban_edit) {
        //     console.log('thinking enabled without ban_edit');
        // }
        // if (message.thinking_enabled && message.ban_edit && message.role == 'USER') {
        //     console.log('user ban_edit', message);
        // }

        // result: no
        // if (message.status != 'FINISHED' && message.status != 'INCOMPLETE' && message.status != 'CONTENT_FILTER') {
        //     console.log('not finished', info, message);
        // }
        // if (message.status == 'CONTENT_FILTER') {
        //     console.log(info, message);
        // }

        // result: no
        // if (typeof message.accumulated_token_usage != 'number') {
        //     console.log('no token usage', info, message);
        // }

        // result: no
        // if (!Array.isArray(message.files)) {
        //     console.log("files not array", info, message);
        // }
        // result: recorded
        // if (message.files.length) {
        //     console.log("have files", info, message);
        // }
        // result: no
        // if (!Array.isArray(message.tips)) {
        //     console.log('tips is not array', info, message);
        // }
        // result: no tips for now
        // if (message.tips.length) {
        //     console.log('have tips', info, message);
        // }

        // result: recorded
        // if (message.tip_content_risk) {
        //     const propertyNames = Object.keys(message.tip_content_risk).sort((a, b) => a.localeCompare(b));
        //     if (propertyNames.length != 2 || propertyNames[0] != 'tip_params' || propertyNames[1] != 'tip_type') {
        //         console.log('unknown tip property', info, message);
        //     }
        //     if (message.tip_content_risk.tip_type != 'CONTENT_RISK') {
        //         console.log('unknown tip type', info, message);
        //     }
        //     if (!message.tip_content_risk.tip_params) {
        //         console.log('unknown tip param', info, message);
        //     }
        //     const propertyNames2 = Object.keys(message.tip_content_risk.tip_params);
        //     if (propertyNames2.length != 1 && propertyNames2[0] != 'category') {
        //         console.log('unknown tip param', info, message);
        //     }
        //     if (message.tip_content_risk.tip_params.category != 'general' && message.tip_content_risk.tip_params.category != 'legal') {
        //         console.log('unknown tip param', info, message);
        //     }
        // }
        // this is a topic about p2p downloading
        // if (message.tip_content_risk?.tip_params?.category == 'legal') {
        //     console.log('legal', info, message);
        // }

        // if (message.search_enabled) {
            // result: no
            // if (message.search_status && message.search_status != 'FINISHED' && message.search_status != 'ANSWER' && message.search_status != 'INIT') {
            //     console.log('unknown search status', message);
            // }
            // result: no
            // if (message.search_status != 'FINISHED' && message.search_results) {
            //     console.log('is not finished but have results', message);
            // }
            // result: no
            // if (message.search_results && !Array.isArray(message.search_results)) {
            //     console.log('search results not array', message);
            // }
            // // result: no
            // if (message.search_status == 'FINISHED' && !message.search_results.length) {
            //     console.log('is finished but no results', message);
            // }
        //    if (message.search_status == 'FINISHED') {
                // console.log('search finished', message);
        //        for (const searchResult of message.search_results) {
                    // interface SearchResult {
                    //     url: string,
                    //     title: string,
                    //     snippet: string,
                    //     cite_index: null,
                    //     published_at: number,
                    //     site_name: string,
                    //     site_icon: string,
                    // }
                    // result: ok
                    // const propertyNames = Object.keys(searchResult);
                    // const expectedPropertyNames = ['url', 'title', 'snippet', 'cite_index', 'published_at', 'site_name', 'site_icon'];
                    // if (propertyNames.filter(p => p != 'tip_content_risk').some(i => !expectedPropertyNames.includes(i))) {
                    //     console.log(`property mismatch`, searchResult);
                    // } else if (expectedPropertyNames.some(e => !propertyNames.includes(e))) {
                    //     console.log(`property mismatch(2)`, searchResult);
                    // }
                    
                    // result: following block ok
                    // const url = new URL(searchResult.url);
                    // const url2 = new URL(searchResult.site_icon);
                    // if (typeof searchResult.title != 'string') {
                    //     console.log('title not string', searchResult);
                    // }
                    // if (typeof searchResult.snippet != 'string') {
                    //     console.log('snippet not string', searchResult);
                    // }
                    // if (typeof searchResult.site_name != 'string') {
                    //     console.log('site name not string', searchResult);
                    // }
                    // if (searchResult.published_at && typeof searchResult.published_at != 'number') {
                    //     console.log('published at not number', searchResult);
                    // }

                    // if (searchResult.cite_index) {
                    //     console.log('have cite index', searchResult);
                    // }
            //    }
                // if (message.search_results.some(r => r.cite_index)) {
                //     console.log('have cite', info, message);
                // }
            // }
        // }
    // }
// }

// TODO investigate message_id, parent_id, version and current_message_id relationship


// # STEP 8 insert into database

const config = JSON.parse(await fs.readFile('config', 'utf-8')) as {
    database: mysql.PoolOptions,
}

type QueryResult<T> = T & mysql.RowDataPacket;
type ManipulateResult = mysql.ResultSetHeader;
const connection = await mysql.createConnection({ ...config.database, database: 'MyChat' });

const [dbSessions] = await connection.query<QueryResult<Session>[]>(
    "SELECT `id` FROM `dsession`;",
);
const dbSessionIds = dbSessions.map(s => s.id);
const [dbMessages] = await connection.query<QueryResult<{ session_id: string, message_id: number }>[]>(
    "SELECT `session_id`, `message_id` FROM `dmessage`;",
);

for (const session of sessions) {

    const info = session.chat_session;
    if (!dbSessionIds.includes(info.id)) {
        await connection.execute(
            "INSERT INTO `dsession` (`id`, `seq_id`, `title`, `title_type`, `inserted_at`, `updated_at`)"
            + " VALUES (?, ?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?));",
            [info.id, info.seq_id, info.title ?? '(no title)', info.title_type, info.inserted_at, info.updated_at],
        );
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
        }
    }
    console.log(`stored session ${info.id}`);
}
await connection.end();

// # STEP 9 formalize incremental data collection process


// TODO furthur steps investigate search by embedding similarity