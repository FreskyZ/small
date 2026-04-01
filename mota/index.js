import fs from 'node:fs/promises';
import pg from 'pg';
import { generate } from 'otplib';
import { getRemainingTime } from '@otplib/totp';
import { crypto } from '@otplib/plugin-crypto-node';

// ATTENTION this code is updated to otplib@13
// but not tested, need setup and test if need to use in future

// use this to export from google authenticator https://github.com/krissrex/google-authenticator-exporter

// CREATE TABLE "secrets" ("name" VARCHAR(100), "value" VARCHAR(100));
const pool = pg.createPool(JSON.parse(await fs.readFile('/etc/fine/config.json', 'utf-8')).database);
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

    const time = getRemainingTime();
    const code = generate({ secret: values[0].Value, crypto });
    return { body: { code, time } };
}
