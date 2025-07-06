import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

type QueryResult<T> = T & mysql.RowDataPacket;
type ManipulateResult = mysql.ResultSetHeader;
const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
});

// const [sessions] = await pool.query<QueryResult<{
//     SessionId: number,
//     SessionName: string,
// }>[]>('SELECT `SessionId`, `Name` FROM `Session`');
// console.log(sessions);

const chatdata = JSON.parse(await fs.readFile('chat-data8.json', 'utf-8')) as {
    sessions: {
        'prompt-tokens': number,
        'completion-tokens': number,
        messages: { role: string, content: string }[],
    }[],
};
// console.log(chatdata);

const connection = await pool.getConnection();
try {
    await connection.beginTransaction();
    const [insertResult] = await pool.query<ManipulateResult>(
        "INSERT INTO `Session` (`UserId`, `Name`, `Comment`, `Tags`, `Shared`) VALUES"
        + " (1, 'nsf8', 'migrated from old command line tool, it is likely to be created at 2025-06', 'nsfw', 0)",
    );
    const sessionId = insertResult.insertId;

    for (const version of chatdata.sessions) {
        let parentMessageId: number = null;
        for (const message of version.messages) {
            const [insertResult] = await pool.query<ManipulateResult>(
                "INSERT INTO `Message` (`SessionId`, `ParentMessageId`, `Role`, `Content`) VALUES (?, ?, ?, ?)",
                [sessionId, parentMessageId, message.role, message.content],
            );
            parentMessageId = insertResult.insertId;
        }
        await pool.query<ManipulateResult>(
            "UPDATE `Message` SET `PromptTokenCount` = ?, `CompletionTokenCount` = ? WHERE `MessageId` = ?",
            [version['prompt-tokens'], version['completion-tokens'], parentMessageId],
        );
    }
    await connection.commit();
} catch (error) {
    console.log(error);
    await connection.rollback();
}

connection.release();
await pool.end();
