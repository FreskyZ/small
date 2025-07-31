import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { authenticator } from 'otplib';

// node akari.ts upload yatc/index.pub.html public/yatc.html
// node akari.ts upload yatc/index.app.html static/yatc.html
// node akari.ts upload yatc/indx.js servers/yatc.js

// use this to export from google authenticator https://github.com/krissrex/google-authenticator-exporter

// CREATE TABLE `OneTimes` (`Name` VARCHAR(100), `Value` VARCHAR(100));
const pool = mysql.createPool(JSON.parse(await fs.readFile('config', 'utf-8')).database);
class MyError extends Error {
    // fine error middleware need this to know this is known error type
    name = 'FineError';
    constructor(kind, message) { super(message); this.kind = kind; this.message = message; }
}
export async function dispatch(ctx) {
    const { pathname, searchParams } = new URL(ctx.path, 'https://example.com');
    if (pathname != '/v1/value') { return { error: new MyError('not-found', 'invalid-invocation') }; }
    const name = searchParams.get('name');
    if (!name) { return { error: new MyError('common', `missing required parameter name`) }; }

    const [values] = await pool.query("SELECT `Value` FROM `OneTimes` WHERE `Name` = ?", [name]);
    if (!values || values.length == 0) { return { error: new MyError('common', `invalid name`) }; }

    const time = authenticator.timeRemaining();
    const code = authenticator.generate(values[0].Value);
    return { body: { code, time } };
}
