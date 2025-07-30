import readline from 'node:readline/promises';
// END IMPORT
// components: codegen, minify, mypack, sftp, typescript, eslint, messenger, common
// BEGIN LIBRARY
import crypto, { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Interface } from 'node:readline/promises';
import tls from 'node:tls';
import { zstdCompress, zstdCompressSync } from 'node:zlib';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import chalkNotTemplate from 'chalk';
import chalk from 'chalk-template';
import dayjs from 'dayjs';
import { ESLint } from 'eslint';
import { XMLParser } from 'fast-xml-parser';
import SFTPClient from 'ssh2-sftp-client';
import { minify } from 'terser';
import ts from 'typescript';
import tseslint from 'typescript-eslint';

// -----------------------------------------
// ------ script/components/common.ts ------ 
// -------- ATTENTION AUTO GENERATED -------
// -----------------------------------------

function logInfo(header: string, message: string, error?: any): void {
    if (error) {
        console.log(chalk`[{green ${dayjs().format('HH:mm:ss.SSS')}} {gray ${header}}] ${message}`, error);
    } else {
        console.log(chalk`[{green ${dayjs().format('HH:mm:ss.SSS')}} {gray ${header}}] ${message}`);
    }
}
function logError(header: string, message: string, error?: any): void {
    if (error) {
        console.log(chalk`[{green ${dayjs().format('HH:mm:ss.SSS')}} {red ${header}}] ${message}`, error);
    } else {
        console.log(chalk`[{green ${dayjs().format('HH:mm:ss.SSS')}} {red ${header}}] ${message}`);
    }
}
function logCritical(header: string, message: string): never {
    console.log(chalk`[{green ${dayjs().format('HH:mm:ss.SSS')}} {red ${header}}] ${message}`);
    return process.exit(1);
}

// build script's config (akari.json), or config for code in 'script' folder,
// to be distinguished with codegen config (api.xml and database.xml) and core config (/webroot/config)
interface ScriptConfig {
    domain: string,
    webroot: string,
    certificate: string,
    ssh: { user: string, identity: string, passphrase: string },
}
const scriptconfig: ScriptConfig = JSON.parse(await fs.readFile('akari.json', 'utf-8'));

// ------------------------------------------
// ------ script/components/codegen.ts ------ 
// -------- ATTENTION AUTO GENERATED --------
// ------------------------------------------

interface DatabaseModelField {
    name: string,
    type: 'id' | 'int' | 'string' | 'datetime' | 'guid' | 'text',
    nullable: boolean,
    size: number, // string size
}
interface DatabaseModelForeignKey {
    table: string, // foreign table
    field: string,
}
interface DatabaseModelTable {
    name: string,
    primaryKey: string[], // primary key field name, pk is required for now
    foreignKeys: DatabaseModelForeignKey[],
    fields: DatabaseModelField[],
}

interface WebInterfaceActionParameter {
    name: string,
    type: 'id' | 'guid', // for now only this
    optional: boolean,
}
interface WebInterfaceAction {
    // finally you need something to group actions
    // for now =main is main, =share is for share page
    // for now =temp is temporary investigating actions
    key: string,
    name: string,
    public: boolean,
    // method is not in config but comes from name
    // GetXXX => GET, AddXXX => PUT, RemoveXXX => DELETE, other => POST
    method: string,
    // path is not in config but comes from name
    // for GetXXX, remove the Get prefix, remaining part change from camel case to snake case
    path: string,
    parameters: WebInterfaceActionParameter[],
    body?: string, // body type name
    return?: string, // return type name
}
interface WebInterfaceActionTypeField {
    name: string,
    // primitive type or custom type
    type: 'id' | 'int' | 'string' | 'datetime' | string,
    nullable: boolean,
}
interface WebInterfaceActionType {
    name: string,
    fields: WebInterfaceActionTypeField[],
}

interface CodeGenerationConfig {
    options: CodeGenerationOptions,
    dbname: string,
    tables: DatabaseModelTable[],
    appname: string,
    actions: WebInterfaceAction[],
    actionTypes: WebInterfaceActionType[],
}

// currently input files are at fixed path
// return null for read error
async function readCodeGenerationConfig(options: CodeGenerationOptions): Promise<CodeGenerationConfig> {
    let hasError = false;

    const parser = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: true,
    });
    // the result of preserveOrder: boolean is too complex and not that worthy to type
    const rawDatabaseModel = parser.parse(await fs.readFile('src/server/database.xml'));
    // console.log(JSON.stringify(rawDatabaseModel, undefined, 2));

    const databaseName = rawDatabaseModel[1][':@'].name;
    const databaseTables = (rawDatabaseModel[1].database as any[]).map<DatabaseModelTable>(c => {
        if (!c.table) {
            hasError = true;
            logError('codegen', 'database.xml: unknown element tag, expect table');
            return null;
        }
        return {
            name: c[':@'].name,
            primaryKey: c.table.find((f: any) => 'primary-key' in f)[':@'].field.split(','),
            foreignKeys: c.table.filter((f: any) => 'foreign-key' in f).map((f: any) => f[':@']),
            fields: c.table.filter((f: any) => 'field' in f).map((f: any) => ({
                name: f[':@'].name,
                type: f[':@'].type.endsWith('?') ? f[':@'].type.substring(0, f[':@'].type.length - 1) : f[':@'].type,
                nullable: f[':@'].type.endsWith('?'),
                size: f[':@'].size ? parseInt(f[':@'].size) : null,
            })),
        };
    });
    // console.log(JSON.stringify(databaseModel, undefined, 2));

    const rawWebInterfaces = parser.parse(await fs.readFile('src/shared/api.xml'));
    // console.log(JSON.stringify(rawWebInterfaces, undefined, 2));

    const actions: WebInterfaceAction[] = [];
    const actionTypes: WebInterfaceActionType[] = [];
    const applicationName = rawWebInterfaces[1][':@'].name;
    rawWebInterfaces[1].api.forEach((c: any) => {
        if ('type' in c) {
            actionTypes.push({
                name: c[':@'].name,
                fields: c.type.map((f: any) => ({
                    name: f[':@'].name,
                    type: f[':@'].type.endsWith('?') ? f[':@'].type.substring(0, f[':@'].type.length - 1) : f[':@'].type,
                    nullable: f[':@'].type.endsWith('?'),
                })),
            });
        } else {
            const key = c[':@'].key;
            const name = c[':@'].name;
            const $public = !!c[':@'].public;
            const nameWithoutPublic = $public ? name.substring(6) : name;
            const method = nameWithoutPublic.startsWith('Get') ? 'GET'
                : nameWithoutPublic.startsWith('Add') ? 'PUT'
                : nameWithoutPublic.startsWith('Remove') ? 'DELETE' : 'POST';
            const nameWithoutGet = nameWithoutPublic.startsWith('Get') ? nameWithoutPublic.substring(3) : nameWithoutPublic;
            const path = nameWithoutGet.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
            const body = c[':@'].body;
            const $return = c[':@'].return;
            const parameters = [1, 2, 3, 4].map(i => c[':@'][`a${i}`]).filter(x => x).map(r => {
                // NOTE for now only support these
                if (r.includes(':')) {
                    const name = r.substring(0, r.indexOf(':'));
                    const type = r.substring(r.indexOf(':') + 1);
                    return { name, type, optional: false };
                } else {
                    return { name: r, type: 'id', optional: false };
                }
            });
            actions.push({ key, name, public: $public, method, path, body, return: $return, parameters });
        }
    });
    // console.log(JSON.stringify(actionTypes, undefined, 2), actions);

    return hasError ? null : { options, dbname: databaseName, tables: databaseTables, appname: applicationName, actions, actionTypes };
}

// database.d.ts, return null for not ok
function generateDatabaseTypes(config: CodeGenerationConfig): string {
    let sb = '';
    sb += '// --------------------------------------\n';
    sb += '// ------ ATTENTION AUTO GENERATED ------\n';
    sb += '// --------------------------------------\n';
    sb += '\n';
    sb += `import type { Dayjs } from 'dayjs';\n`;
    sb += '\n';
    for (const table of config.tables) {
        sb += `export interface ${table.name} {\n`;
        for (const field of table.fields) {
            const type = {
                'id': 'number',
                'int': 'number',
                'datetime': 'Dayjs',
                'guid': 'string',
                'text': 'string',
                'string': 'string',
                'bool': 'boolean',
            }[field.type];
            sb += `    ${field.name}${field.nullable ? '?' : ''}: ${type},\n`;
        }
        sb += `    CreateTime: Dayjs,\n`;
        sb += `    UpdateTime: Dayjs,\n`;
        sb += `}\n`;
    }
    return sb;
}
// database.sql, return null for not ok
function generateDatabaseSchema(config: CodeGenerationConfig): string {
    let hasError = false;

    let sb = '';
    sb += '--------------------------------------\n';
    sb += '------ ATTENTION AUTO GENERATED ------\n';
    sb += '--------------------------------------\n';
    sb += '\n';
    sb += '-- -- first, mysql -u root -p:\n';
    sb += `-- CREATE DATABASE \`${config.dbname}\`;\n`;
    sb += `-- GRANT ALL PRIVILEGES ON \`${config.dbname}\`.* TO 'fine'@'localhost';\n`;
    sb += '-- FLUSH PRIVILEGES;\n';
    sb += '-- -- then, mysql -p\n';
    sb += '\n';
    for (const table of config.tables) {
        sb += `CREATE TABLE \`${table.name}\` (\n`;
        for (const field of table.fields) {
            const type = {
                'id': 'INT',
                'int': 'INT',
                'datetime': 'DATETIME',
                'guid': 'VARCHAR(36)',
                'text': 'TEXT',
                'string': `VARCHAR(${field.size})`,
                'bool': 'BIT',
            }[field.type];
            const autoIncrement = table.primaryKey.length == 1 && table.primaryKey[0] == field.name && field.type == 'id' ? ' AUTO_INCREMENT' : '';
            const newGuid = table.primaryKey.length == 1 && table.primaryKey[0] == field.name && field.type == 'guid' ? ' DEFAULT (UUID())' : '';
            sb += `    \`${field.name}\` ${type} ${field.nullable ? 'NULL' : 'NOT NULL'}${autoIncrement}${newGuid},\n`;
        }
        sb += '    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),\n';
        sb += '    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),\n';
        sb += `    CONSTRAINT \`PK_${table.name}\` PRIMARY KEY (${table.primaryKey.map(k => `\`${k}\``).join(',')}),\n`;
        for (const fk of table.foreignKeys) {
            const foreignTable = config.tables.find(t => t.name == fk.table);
            if (foreignTable.primaryKey.length > 1) {
                hasError = true;
                logError('codegen', `table ${table.name} foreign key ${fk.field} cannot reference table ${fk.table} with composite primary key`);
            }
            const foreignTablePrimaryKey = foreignTable.primaryKey[0];
            sb += `    CONSTRAINT \`FK_${table.name}_${fk.table}\``;
            sb += ` FOREIGN KEY (\`${fk.field}\`) REFERENCES \`${fk.table}\`(\`${foreignTablePrimaryKey}\`),\n`;
        }
        sb = sb.substring(0, sb.length - 2) + '\n';
        sb += `);\n`;
    }
    return hasError ? null : sb;
}
// api.d.ts, return null for not ok
function generateWebInterfaceTypes(config: CodeGenerationConfig): string {

    let sb = '';
    sb += '// --------------------------------------\n';
    sb += '// ------ ATTENTION AUTO GENERATED ------\n';
    sb += '// --------------------------------------\n';
    sb += '\n';
    for (const type of config.actionTypes) {
        sb += `export interface ${type.name} {\n`;
        for (const field of type.fields) {
            const type = {
                'id': 'number',
                'int': 'number',
                'datetime': 'string',
                'string': 'string',
                'bool': 'boolean',
            }[field.type] ?? field.type;
            sb += `    ${field.name}${field.nullable ? '?' : ''}: ${type},\n`;
        }
        sb += '}\n';
    }
    return sb;
}

// return original manual content (content before mark), return null for have error
function checkPartialGeneratedContentHash(config: CodeGenerationConfig, taskName: string, originalContent: string): string {
    const markIndex = originalContent.indexOf('// AUTOGEN');
    const markEndIndex = originalContent.indexOf('\n', markIndex);
    const expectHash = originalContent.substring(markIndex + 11, markEndIndex);
    const actualHash = crypto.hash('sha256', originalContent.substring(markEndIndex + 1));
    if (expectHash != actualHash) {
        const expectShortHash = expectHash.substring(0, 6);
        const actualShortHash = actualHash.substring(0, 6);
        if (actualShortHash != expectShortHash) {
            logError('codegen', `${taskName}: hash mismatch expect ${expectShortHash} actual ${actualShortHash}`);
        } else {
            logError('codegen', `${taskName}: hash mismatch expect ${expectHash} actual ${actualHash}`);
        }
        if (!config.options.ignoreHashMismatch) {
            logError('codegen', `${taskName}: generated content seems unexpectedly changed, use ignorehash to ignore and overwrite`);
            return null;
        }
    }
    return originalContent.substring(0, markIndex);
}

// index.ts, return null for not ok
function generateWebInterfaceServer(config: CodeGenerationConfig, originalContent: string): string {

    const manualContent = checkPartialGeneratedContentHash(config, 'actions-server', originalContent);
    if (!manualContent) { return null; }
    let sb = '';
    sb += '// --------------------------------------\n';
    sb += '// ------ ATTENTION AUTO GENERATED ------\n';
    sb += '// --------------------------------------\n';
    sb += '/* eslint-disable @stylistic/lines-between-class-members */\n';
    sb += '\n';
    sb += `class MyError extends Error {
    // fine error middleware need this to know this is known error type
    public readonly name: string = 'FineError';
    public constructor(public readonly kind: MyErrorKind, message?: string) { super(message); }
}\n`;
    sb += `class ParameterValidator {
    public constructor(private readonly parameters: URLSearchParams) {}
    private validate<T>(name: string, optional: boolean, convert: (raw: string) => T, validate: (value: T) => boolean): T {
        if (!this.parameters.has(name)) {
            if (optional) { return null; } else { throw new MyError('common', \`missing required parameter \${name}\`); }
        }
        const raw = this.parameters.get(name);
        const result = convert(raw);
        if (validate(result)) { return result; } else { throw new MyError('common', \`invalid parameter \${name} value \${raw}\`); }
    }
    public id(name: string) { return this.validate(name, false, parseInt, v => !isNaN(v) && v > 0); }
    public idopt(name: string) { return this.validate(name, true, parseInt, v => !isNaN(v) && v > 0); }
    public string(name: string) { return this.validate(name, false, v => v, v => !!v); }
}\n`;

    sb += 'export async function dispatch(ctx: DispatchContext): Promise<DispatchResult> {\n';
    // NOTE no need to wrap try in this function because it correctly throws into overall request error handler
    sb += `    const { pathname, searchParams } = new URL(ctx.path, 'https://example.com');\n`;
    sb += `    const v = new ParameterValidator(searchParams);\n`;
    sb += `    const ax: ActionContext = { now: ctx.state.now, userId: ctx.state.user?.id, userName: ctx.state.user?.name };\n`;
    sb += `    const action = ({\n`;
    for (const action of config.actions) {
        const functionName = action.name.charAt(0).toLowerCase() + action.name.substring(1);
        sb += `        '${action.method} ${action.public ? '/public' : ''}/v1/${action.path}': () => ${functionName}(ax, `;
        for (const parameter of action.parameters) {
            const optional = parameter.name.endsWith('?');
            const parameterName = optional ? parameter.name.substring(0, parameter.name.length - 1) : parameter.name;
            const method = parameter.type == 'id' ? 'id' : 'string';
            sb += `v.${method}${optional ? 'opt' : ''}('${parameterName}'), `;
        }
        if (action.body) {
            sb += 'ctx.body, ';
        }
        sb = sb.substring(0, sb.length - 2) + '),\n';
    }
    sb += `    } as Record<string, () => Promise<any>>)[\`\${ctx.method} \${pathname}\`];\n`;
    sb += `    return action ? { body: await action() } : { error: new MyError('not-found', 'invalid-invocation') };\n`;
    sb += `}\n`;

    const hash = crypto.hash('sha256', sb);
    return `${manualContent}// AUTOGEN ${hash}\n${sb}`;
}
// index.tsx, return null for not ok
function generateWebInterfaceClient(config: CodeGenerationConfig, originalContent: string): string {

    const manualContent = checkPartialGeneratedContentHash(config, 'actions-client', originalContent);
    if (!manualContent) { return null; }
    let sb = '';
    sb += '// --------------------------------------\n';
    sb += '// ------ ATTENTION AUTO GENERATED ------\n';
    sb += '// --------------------------------------\n';

    // NOTE this is hardcode replaced in make-akari.ts
    sb += `
let notificationTimer: any;
let notificationElement: HTMLSpanElement;
function notification(message: string) {
    if (!notificationElement) {
        const container = document.createElement('div');
        container.style = 'position:fixed;inset:0;text-align:center;cursor:default;pointer-events:none';
        notificationElement = document.createElement('span');
        notificationElement.style = 'padding:8px;background-color:white;margin-top:4em;'
            + 'display:none;border-radius:4px;box-shadow:3px 3px 10px 4px rgba(0,0,0,0.15);max-width:320px';
        container.appendChild(notificationElement);
        document.body.appendChild(container);
    }
    if (notificationTimer) {
        clearTimeout(notificationTimer);
    }
    notificationElement.style.display = 'inline-block';
    notificationElement.innerText = message;
    notificationTimer = setTimeout(() => { notificationElement.style.display = 'none'; }, 10_000);
}

function EmptyPage({ handleContinue }: {
    handleContinue: () => void,
}) {
    const styles = {
        app: css({ maxWidth: '360px', margin: '32vh auto' }),
        fakeText: css({ fontSize: '14px' }),
        mainText: css({ fontSize: '10px', color: '#666', marginTop: '8px' }),
        button: css({ border: 'none', outline: 'none', background: 'transparent', cursor: 'pointer', fontSize: '14px', borderRadius: '4px', '&:hover': { background: '#ccc' } }),
    };
    return <div css={styles.app}>
        <div css={styles.fakeText}>{emptytext}</div>
        <div css={styles.mainText}>
            I mean, access token not found, if you are me, click <button css={styles.button} onClick={handleContinue}>CONTINUE</button>, or else you seems to be here by accident or curious, you may leave here because there is no content for you, or you may continue your curiosity by finding my contact information.
        </div>
    </div>;
}

let accessToken: string;
(window as any)['setaccesstoken'] = (v: string) => accessToken = v; // test access token expiration

function gotoIdentityProvider() {
    if (window.location.pathname.length > 1) {
        localStorage['return-pathname'] = window.location.pathname;
        localStorage['return-searchparams'] = window.location.search;
    }
    window.location.assign(\`https://id.example.com?return=https://\${window.location.host}\`);
}

async function startup(render: () => void) {
    const localStorageAccessToken = localStorage['access-token'];
    const authorizationCode = new URLSearchParams(window.location.search).get('code');

    if (localStorageAccessToken) {
        const response = await fetch('https://api.example.com/user-credential', { headers: { authorization: 'Bearer ' + localStorageAccessToken } });
        if (response.ok) { accessToken = localStorageAccessToken; render(); return; } // else goto signin
    } else if (!authorizationCode && window.location.pathname.length == 1) { // only display emptyapp when no code and no path
        await new Promise<void>(resolve => root.render(<EmptyPage handleContinue={resolve} />));
    }
    if (!authorizationCode) {
        gotoIdentityProvider();
    } else {
        const url = new URL(window.location.toString());
        url.searchParams.delete('code');
        if (localStorage['return-pathname']) { url.pathname = localStorage['return-pathname']; localStorage.removeItem('return-pathname'); }
        if (localStorage['return-searchparams']) { url.search = localStorage['return-searchparams']; localStorage.removeItem('return-searchparams'); }
        window.history.replaceState(null, '', url.toString());
        const response = await fetch('https://api.example.com/signin', { method: 'POST', headers: { authorization: 'Bearer ' + authorizationCode } });
        if (response.status != 200) { notification('Failed to sign in, how does that happen?'); }
        else { accessToken = localStorage['access-token'] = (await response.json()).accessToken; render(); }
    }
}

let gotoIdModalMaskElement: HTMLDivElement;
let gotoIdModalContainerElement: HTMLDivElement;
let gotoIdModalOKButton: HTMLButtonElement;
let gotoIdModalCancelButton: HTMLButtonElement;
function confirmGotoIdentityProvider() {
    if (!gotoIdModalMaskElement) {
        gotoIdModalMaskElement = document.createElement('div');
        gotoIdModalMaskElement.style = 'position:fixed;inset:0;background-color:#7777;display:none';
        gotoIdModalContainerElement = document.createElement('div');
        gotoIdModalContainerElement.style = 'z-index:100;position:relative;margin:60px auto;padding:12px;'
            + 'border-radius:8px;background-color:white;max-width:320px;box-shadow:3px 3px 10px 4px rgba(0,0,0,0.15);';
        const titleElement = document.createElement('div');
        titleElement.style = 'font-weight:bold;margin-bottom:8px';
        titleElement.innerText = 'CONFIRM';
        const contentElement = document.createElement('div');
        contentElement.innerText = 'Authentication failed, click OK to authenticate again, it is likely to lose unsaved changes, click CANCEL to try again later.';
        const buttonContainerElement = document.createElement('div');
        buttonContainerElement.style = 'display:flex;flex-flow:row-reverse;gap:12px;margin-top:12px';
        gotoIdModalOKButton = document.createElement('button');
        gotoIdModalOKButton.style = 'font-size:14px;border:none;outline:none;cursor:pointer;background:transparent;float:right';
        gotoIdModalOKButton.innerText = 'OK';
        gotoIdModalCancelButton = document.createElement('button');
        gotoIdModalCancelButton.style = 'font-size:14px;border:none;outline:none;cursor:pointer;background:transparent;float:right';
        gotoIdModalCancelButton.innerText = 'CANCEL';
        buttonContainerElement.appendChild(gotoIdModalOKButton);
        buttonContainerElement.appendChild(gotoIdModalCancelButton);
        gotoIdModalContainerElement.appendChild(titleElement);
        gotoIdModalContainerElement.appendChild(contentElement);
        gotoIdModalContainerElement.appendChild(buttonContainerElement);
        document.body.appendChild(gotoIdModalMaskElement);
        document.body.appendChild(gotoIdModalContainerElement);
    }
    const handleCancel = () => {
        gotoIdModalCancelButton.removeEventListener('click', handleCancel);
        gotoIdModalMaskElement.style.display = 'none';
        gotoIdModalContainerElement.style.display = 'none';
    };
    gotoIdModalCancelButton.addEventListener('click', handleCancel);
    const handleOk = () => {
        gotoIdModalOKButton.removeEventListener('click', handleOk);
        localStorage.removeItem('access-token');
        gotoIdentityProvider();
    };
    gotoIdModalOKButton.addEventListener('click', handleOk);
    gotoIdModalMaskElement.style.display = 'block';
    gotoIdModalContainerElement.style.display = 'block';
}

async function sendRequest(method: string, path: string, parameters?: any, data?: any): Promise<any> {
    const url = new URL(\`https://api.example.com/example\${path}\`);
    Object.entries(parameters || {}).forEach(p => url.searchParams.append(p[0], p[1].toString()));
    const response = await fetch(url.toString(), data ? {
        method,
        body: JSON.stringify(data),
        headers: { 'authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' },
    } : { method, headers: { 'authorization': 'Bearer ' + accessToken } });
    if (response.status == 401) { confirmGotoIdentityProvider(); return Promise.reject('Authentication failed.'); }
    // normal/error both return json body, but void do not
    const hasJsonBody = response.headers.has('content-Type') && response.headers.get('content-Type').includes('application/json');
    const responseData = hasJsonBody ? await response.json() : {};
    return response.ok ? Promise.resolve(responseData)
        : response.status >= 400 && response.status < 500 ? Promise.reject(responseData)
        : response.status >= 500 ? Promise.reject({ message: 'internal error' })
        : Promise.reject({ message: 'unknown error' });
}
`.replaceAll('api.example.com/example', `api.example.com/${config.appname}`);

    sb += 'const api = {\n';
    // for now now action.key only used here
    for (const action of config.actions.filter(a => a.key == 'main')) {
        const functionName = action.name.charAt(0).toLowerCase() + action.name.substring(1);
        sb += `    ${functionName}: (`;
        for (const parameter of action.parameters) {
            const optional = parameter.name.endsWith('?');
            const parameterName = optional ? parameter.name.substring(0, parameter.name.length - 1) : parameter.name;
            const type = parameter.type == 'id' ? 'number' : 'string';
            // use `T | undefined` for optional parameter, or else notnullable body cannot be after optional parameter
            sb += `${parameterName}: ${type}${optional ? ' | undefined' : ''}, `;
        }
        if (action.body) {
            sb += `data: I.${action.body}, `;
        }
        if (sb.endsWith(', ')) {
            sb = sb.substring(0, sb.length - 2);
        }
        sb += `): Promise<${action.return ? `I.${action.return}` : 'void'}> => `;

        sb += `sendRequest('${action.method}', '${action.public ? '/public' : ''}/v1/${action.path}', `;
        if (action.parameters.length) {
            sb += `{ `;
            for (const parameter of action.parameters) {
                const optional = parameter.name.endsWith('?');
                const parameterName = optional ? parameter.name.substring(0, parameter.name.length - 1) : parameter.name;
                sb += `${parameterName}, `;
            }
            sb = sb.substring(0, sb.length - 2);
            sb += ` }, `;
        } else if (action.body) {
            sb += `{}, `;
        }
        if (action.body) {
            sb += `data, `;
        }
        sb = sb.substring(0, sb.length - 2) + '),\n';
    }
    sb += '};\n';

    const hash = crypto.hash('sha256', sb);
    return `${manualContent}// AUTOGEN ${hash}\n${sb}`;
}

interface CodeGenerationOptions {
    emit: boolean, // actually write file
    client: boolean, // include client side targets
    server: boolean, // include server side targets
    ignoreHashMismatch: boolean,
}
// return true for ok, false for not ok
async function generateCode(config: CodeGenerationConfig): Promise<boolean> {
    logInfo('codegen', 'code generation');
    let hasError = false;

    const createTask = (path: string, generate: (config: CodeGenerationConfig) => string) => async () => {
        const generatedContent = generate(config);
        if (!generatedContent) {
            hasError = true;
        }
        if (config.options.emit && generatedContent) {
            // write file may throw error, but actually you don't need to care about that
            logInfo('codegen', chalk`write {yellow ${path}}`);
            await fs.writeFile(path, generatedContent);
        }
    };
    const createPartialTask = (path: string, generate: (config: CodeGenerationConfig, originalContent: string) => string) => async () => {
        const originalContent = await fs.readFile(path, 'utf-8');
        const generatedContent = generate(config, originalContent);
        if (!generatedContent) {
            hasError = true;
        }
        if (config.options.emit && generatedContent) {
            // write file may throw error, but actually you don't need to care about that
            logInfo('codegen', chalk`write {yellow ${path}}`);
            await fs.writeFile(path, generatedContent);
        }
    };

    const tasks = [
        { kind: 'server', name: 'database.d.ts', run: createTask('src/server/database.d.ts', generateDatabaseTypes) },
        { kind: 'server', name: 'database.sql', run: createTask('src/server/database.sql', generateDatabaseSchema) },
        { kind: 'client,server', name: 'api.d.ts', run: createTask('src/shared/api.d.ts', generateWebInterfaceTypes) },
        { kind: 'server', name: 'index.ts', run: createPartialTask('src/server/index.ts', generateWebInterfaceServer) },
        { kind: 'client', name: 'index.tsx', run: createPartialTask('src/client/index.tsx', generateWebInterfaceClient) },
    ].filter(t => (config.options.client && t.kind.includes('client')) || (config.options.server && t.kind.includes('server')));
    // console.log('scheduled tasks', tasks);
    await Promise.all(tasks.map(t => t.run()));

    if (hasError) { logError('codegen', 'code generation completed with error'); } else { logInfo('codegen', 'code generation complete'); }
    return !hasError;
}

// ---------------------------------------------
// ------ script/components/typescript.ts ------ 
// ---------- ATTENTION AUTO GENERATED ---------
// ---------------------------------------------

interface TypeScriptContext {
    entry: string | string[],
    // not confused with ts.ScriptTarget
    // for now this add lib.dom.d.ts to lib, add jsx: ReactJSX
    target: 'browser' | 'node',
    // should come from process.env.AKARIN_STRICT
    // in old days I enabled this and meet huge amount of false positives,
    // so instead of always on/off, occassionally use this to check for potential issues
    strict?: boolean,
    additionalOptions?: ts.CompilerOptions,
    additionalLogHeader?: string,
    program?: ts.Program,
    // transpile success
    success?: boolean,
    // transpile result files
    files?: Record<string, string>,
}

// extract SHARED TYPE xxx from source file and target file and compare they are same
// although this works on string, still put it here because it logically work on type definition
// return false for not ok
async function validateSharedTypeDefinition(sourceFile: string, targetFile: string, typename: string): Promise<boolean> {

    const sourceContent = await fs.readFile(sourceFile, 'utf-8');
    const expectLines = getSharedTypeDefinition(sourceFile, sourceContent, typename);
    if (!expectLines) { return false; }

    const targetContent = await fs.readFile(targetFile, 'utf-8');
    const actualLines = getSharedTypeDefinition(targetFile, targetContent, typename);
    if (!actualLines) { return false; }

    // console.log(expectLines, actualLines);
    if (expectLines.length != actualLines.length) {
        logError('share-type', `mismatched SHARED TYPE ${typename} between ${sourceFile} and ${targetFile}, expect ${expectLines.length} lines, actual ${actualLines.length} lines`);
        return false;
    }
    for (const [i, expect] of expectLines.map((r, i) => [i, r] as const)) {
        if (expect != actualLines[i]) {
            logError('share-type', `mismatched SHARED TYPE ${typename} between ${sourceFile} and ${targetFile}, line ${i + 1}:`);
            console.log('   expect: ', expect);
            console.log('   actual: ', actualLines[i]);
            return false;
        }
    }
    return true;

    function getSharedTypeDefinition(filename: string, originalContent: string, name: string): string[] {
        let state: 'before' | 'inside' | 'after' = 'before';
        const result: string[] = [];
        for (const line of originalContent.split('\n')) {
            if (state == 'before' && line == `// BEGIN SHARED TYPE ${name}`) {
                state = 'inside';
            } else if (state == 'inside' && line == `// END SHARED TYPE ${name}`) {
                state = 'after';
            } else if (state == 'inside') {
                result.push(line);
            }
        }
        if (state == 'before') {
            logError('share-type', `${filename}: missing shared type ${name}`);
            return null;
        } else if (state == 'inside') {
            logError('share-type', `${filename}: unexpected EOF in shared type ${name}`);
            return null;
        }
        return result;
    }
}

function transpile(tcx: TypeScriptContext): TypeScriptContext {
    const logheader = `tsc${tcx.additionalLogHeader ?? ''}`;
    logInfo(logheader, 'transpiling');

    // design considerations
    // - the original tool distinguishes ecma module and commonjs, now everything is esm!
    //   the target: esnext, module: nodenext, moduleres: nodenext seems suitable for all usage
    // - no source map
    //   the original core module include source map and do complex error logs,
    //   but that work really should not be put in core module and that's now removed
    //   currently the minify option to split result in 160 char wide lines is very enough
    //   the result backend bundle file and front end js files is currently actually very human readable
    // - jsx, I was providing my own jsx implementation,
    //   but that's now handled by /** @jsxImportSource @emotion/react */, so no work for me
    // - watch is not used in current remote command center architecture
    //
    // NOTE check https://www.typescriptlang.org/tsconfig/ for new features and options
    tcx.program = ts.createProgram(Array.isArray(tcx.entry) ? tcx.entry : [tcx.entry], {
        lib: ['lib.esnext.d.ts'].concat(tcx.target == 'browser' ? ['lib.dom.d.ts'] : []),
        jsx: tcx.target == 'browser' ? ts.JsxEmit.ReactJSX : undefined,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
        noEmitOnError: true,
        strict: tcx.strict,
        allowUnreachableCode: false,
        allowUnusedLabels: false,
        alwaysStrict: true,
        exactOptionalPropertyTypes: tcx.strict,
        noFallthroughCaseInSwitch: true,
        noImplicitAny: true,
        noImplicitReturns: true,
        noImplicitThis: true,
        noPropertyAccessFromIndexSignature: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        strictNullChecks: tcx.strict,
        strictFunctionTypes: true,
        strictBindCallApply: true,
        strictBuiltinIteratorReturn: true,
        strictPropertyInitialization: tcx.strict,
        removeComments: true,
        outDir: '/vbuild',
        ...tcx.additionalOptions,
    });

    tcx.files ??= {};
    const emitResult = tcx.program.emit(undefined, (fileName, data) => {
        if (data) { tcx.files[fileName] = data; }
    });

    // TODO the typescript level top level item tree shaking is nearly completed by the unusedvariable, etc. check
    // the only gap is an item is declared as export but not used by other modules
    // the complexity of this check is even reduced by named imports in ecma module compare to commonjs module,
    // although default import and namespace import still exists, soyou still need typescript type information
    // to find top level item usages, so still need something to be collected here?

    const diagnostics = tcx.additionalOptions?.noEmit ? [
        // why are there so many kinds of diagnostics? do I need all of them?
        tcx.program.getGlobalDiagnostics(),
        tcx.program.getOptionsDiagnostics(),
        tcx.program.getSemanticDiagnostics(),
        tcx.program.getSyntacticDiagnostics(),
        tcx.program.getDeclarationDiagnostics(),
        tcx.program.getConfigFileParsingDiagnostics(),
    ].flat() : emitResult.diagnostics;

    const errorCount = diagnostics.filter(d => d.category == ts.DiagnosticCategory.Error || ts.DiagnosticCategory.Warning).length;
    const normalCount = diagnostics.length - errorCount;

    let message: string;
    if (normalCount == 0 && errorCount == 0) {
        message = 'no diagnostic';
    } else if (normalCount != 0 && errorCount == 0) {
        message = chalk`{yellow ${normalCount}} infos`;
    } else if (normalCount == 0 /* && errorCount != 0 */) {
        message = chalk`{yellow ${errorCount}} errors`;
    } else /* normalCount != 0 && errorCount != 0 */ {
        message = chalk`{yellow ${errorCount}} errors and {yellow ${normalCount}} infos`;
    }

    tcx.success = diagnostics.length == 0;
    (diagnostics.length ? logError : logInfo)(logheader, `completed with ${message}`);
    for (const { category, code, messageText, file, start } of diagnostics) {
        const displayColor = {
            [ts.DiagnosticCategory.Warning]: chalkNotTemplate.red,
            [ts.DiagnosticCategory.Error]: chalkNotTemplate.red,
            [ts.DiagnosticCategory.Suggestion]: chalkNotTemplate.green,
            [ts.DiagnosticCategory.Message]: chalkNotTemplate.cyan,
        }[category];
        const displayCode = displayColor(`  TS${code} `);

        let fileAndPosition = '';
        if (file && start) {
            const { line, character: column } = ts.getLineAndCharacterOfPosition(file, start);
            fileAndPosition = chalk`{yellow ${file.fileName}:${line + 1}:${column + 1}} `;
        }

        let flattenedMessage = ts.flattenDiagnosticMessageText(messageText, '\n');
        if (flattenedMessage.includes('\n')) {
            flattenedMessage = '\n' + flattenedMessage;
        }
        console.log(displayCode + fileAndPosition + flattenedMessage);
    }
    return tcx;
}

// -----------------------------------------
// ------ script/components/eslint.ts ------ 
// -------- ATTENTION AUTO GENERATED -------
// -----------------------------------------

interface ESLintOptions {
    files: string | string[], // pattern
    ignore?: string[], // pattern
    falsyRules?: boolean, // enable falsy rules to check for postential true positives
    additionalLogHeader?: string,
}
// return false for has issues, but build scripts may not fail on this
async function eslint(options: ESLintOptions): Promise<boolean> {
    const eslint = new ESLint({
        ignorePatterns: options.ignore,
        overrideConfigFile: true,
        plugins: {
            tseslint: tseslint.plugin as any,
            stylistic,
        },
        overrideConfig: [
            js.configs.recommended,
            stylistic.configs.recommended,
            ...tseslint.configs.recommended as any,
            {
                linterOptions: {
                    reportUnusedDisableDirectives: true,
                },
                rules: {
                    // when-I-use-I-really-need-to-use
                    '@typescript-eslint/no-explicit-any': 'off',
                    // when-I-use-I-really-need-to-use
                    // why do I need to expecting error? I ts-ignore because ts is not clever enough, I do not expect error
                    '@typescript-eslint/ban-ts-comment': 'off',
                    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
                    // not interested
                    '@stylistic/arrow-parens': 'off',
                    // document says default 1tbs but errors say not
                    '@stylistic/brace-style': options.falsyRules ? ['error', '1tbs', { 'allowSingleLine': true }] : 'off',
                    // document says default 4 but errors say default 2, UPDATE: too many false positive on nested ternery expression
                    '@stylistic/indent': options.falsyRules ? ['error', 4] : 'off',
                    // why is this a separate rule with 2 space idention?
                    '@stylistic/indent-binary-ops': 'off',
                    // not sufficient option to follow my convention
                    '@stylistic/jsx-closing-bracket-location': 'off',
                    // not sufficient option to follow my convention, who invented the very strange default value?
                    '@stylistic/jsx-closing-tag-location': 'off',
                    // not sufficient option to follow my convention
                    '@stylistic/jsx-first-prop-new-line': 'off',
                    // no, fragment already looks like newline
                    '@stylistic/jsx-function-call-newline': 'off',
                    // I'm tired of indenting props according to formatting rules
                    '@stylistic/jsx-indent-props': 'off',
                    // when-I-use-I-really-need-to-use
                    '@stylistic/jsx-one-expression-per-line': 'off',
                    // I need negative rule
                    '@stylistic/jsx-wrap-multilines': 'off',
                    // it's meaningless to move properties to next line and fight with idention rules
                    '@stylistic/jsx-max-props-per-line': 'off',
                    '@stylistic/jsx-quotes': 'off',
                    // when-I-use-I-really-need-to-use
                    '@stylistic/max-statements-per-line': 'off',
                    '@stylistic/member-delimiter-style': ['error', {
                        'multiline': {
                            'delimiter': 'comma',
                            'requireLast': true,
                        },
                        'singleline': {
                            'delimiter': 'comma',
                            'requireLast': false,
                        },
                    }],
                    // I'm tired of indenting/spacing ternary expressions according formatting rules
                    '@stylistic/multiline-ternary': 'off',
                    '@stylistic/no-multi-spaces': ['error', { ignoreEOLComments: true }],
                    // not interested
                    '@stylistic/padded-blocks': 'off',
                    // in old days I say it's not possible to enable on existing code base
                    // now I say it's not possible to enforcing overall code base
                    '@stylistic/quotes': 'off',
                    '@stylistic/quote-props': ['error', 'consistent'],
                    '@stylistic/semi': ['error', 'always'],
                },
            },
        ],
    });

    const lintResults = await eslint.lintFiles(options.files);

    let hasIssue = false;
    // // the default formatter is extremely bad when one message is long, so have to implement on your own
    // const formattedResults = (await eslint.loadFormatter('stylish')).format(lintResults);
    // if (formattedResults) { console.log(formattedResults); }
    for (const fileResult of lintResults) {
        if (fileResult.errorCount == 0) { continue; }
        hasIssue = true;
        const relativePath = path.relative(process.cwd(), fileResult.filePath);
        console.log(chalk`\n${relativePath} {yellow ${fileResult.errorCount}} errors`);
        for (const message of fileResult.messages) {
            console.log(chalk`{gray ${message.line}:${message.column}} ${message.message} {gray ${message.ruleId}}`);
        }
    }

    if (!hasIssue) { logInfo(`eslint${options.additionalLogHeader ?? ''}`, 'clear'); }
    return !hasIssue;
}

// -----------------------------------------
// ------ script/components/minify.ts ------ 
// -------- ATTENTION AUTO GENERATED -------
// -----------------------------------------

// the try catch structure of minify is hard to use, return null for not ok
async function tryminify(input: string) {
    try {
        const minifyResult = await minify(input, {
            module: true,
            compress: { ecma: 2022 as any },
            format: { max_line_len: 160 },
        });
        return minifyResult.code;
    } catch (err) {
        logError('terser', `minify error`, { err, input });
        return null;
    }
}

// ---------------------------------------
// ------ script/components/sftp.ts ------ 
// ------- ATTENTION AUTO GENERATED ------
// ---------------------------------------

interface UploadAsset {
    data: string | Buffer,
    remote: string, // relative path to webroot
}

// return false for not ok
// nearly every text file need replace example.com to real domain,
// so change this function to 'deploy' to make it reasonable to do the substitution,
// use buffer or Buffer.from(string) to skip that
async function deploy(assets: UploadAsset[]): Promise<boolean> {
    const client = new SFTPClient();
    try {
        await client.connect({
            host: scriptconfig.domain,
            username: scriptconfig.ssh.user,
            privateKey: await fs.readFile(scriptconfig.ssh.identity),
            passphrase: scriptconfig.ssh.passphrase,
        });
        for (const asset of assets) {
            const fullpath = path.join(scriptconfig.webroot, asset.remote);
            await client.mkdir(path.dirname(fullpath), true);
            if (!Buffer.isBuffer(asset.data)) {
                asset.data = Buffer.from(asset.data.replaceAll('example.com', scriptconfig.domain));
            }
            await client.put(asset.data, fullpath);
        }
        logInfo('sftp', chalk`upload {yellow ${assets.length}} files ${assets.map(a => chalkNotTemplate.yellow(path.basename(a.remote)))}`);
        return true;
    } catch (error) {
        logError('sftp', 'failed to upload', error);
        return false;
    } finally {
        await client.end();
    }
}

// -----------------------------------------
// ------ script/components/mypack.ts ------ 
// -------- ATTENTION AUTO GENERATED -------
// -----------------------------------------

interface MyPackContext {
    program?: ts.Program,
    // transpile result,
    // file name here normally starts with /vbuild,
    // and should be kind of short and easy to read so no more module name concept
    files?: Record<string, string>,
    // entry path as a key in mcx.files
    entry: string,
    // change external references to cdn, this is also module resolution so is here
    cdnfy?: boolean,
    // if logheader does not starts with 'mypack', it is prepended
    logheader?: string,
    // the major module list to work on
    modules?: MyPackModule[],
    // all external references
    externalRequests?: MyPackModuleRequest[],
    // pack result
    success?: boolean,
    resultJs?: string,
    // assign result hash in input mcx to compare last result
    resultHash?: string,
    resultModules?: { path: string, hash: string }[],
}

interface MyPackModule {
    path: string, // this comes from transpile result, which should start with /vbuild
    content: string, // full original content
    requests: MyPackModuleRequest[],
}

// syntax:
//    import a from 'module'; // default import
//    import { b, c, d } from 'module'; // named import
//    import * as e from 'module'; // namespace import
//    import f, { g, h } from 'module'; // default import + named import
//    import i, * as j from 'module'; // default import + namespace import
//    // import i, * as j, { k, l, m } from 'module'; // not allow namespace import and named import at the same time
//    import {} from 'module'; // throw error on this as an lint error
//    import 'module'; // side effect import, will this be used?
// naming:
//    modulerequest comes from old implementation,
//    it is a little shorter than importdeclaration,
//    although it fits more with original 'require' syntax, it is still an ok name
interface MyPackModuleRequest {
    moduleName: string, // the original specifier part in original content
    defaultName?: string, // default import name, the `a` in `import a from 'module'`
    namespaceName?: string, // the `a` in `import * as a from 'module'`
    // // named import names, name is original name, alias is same as name for normal named import
    // // e.g. `import { b, c, d as e } from 'module'` result in [{name:b,alias: b},{name:c,alias:c},{name:d,alias:e}]
    namedNames?: { name: string, alias: string }[],
    cdn?: string, // cdn url for external references if options.cdnfy
    relativeModule?: MyPackModule, // resolved relative import
}

// validate no duplicate top level names, return false for not ok
// NOTE this reads mcx.program
function validateTopLevelNames(mcx: MyPackContext): boolean {
    let hasError = false;
    const allNames: Record<string, string[]> = {}; // module name (absolute path) => names
    const sourceFiles = mcx.program.getSourceFiles().filter(sf => !sf.fileName.includes('node_modules'));
    for (const sourceFile of sourceFiles) {
        const names: string[] = [];
        ts.forEachChild(sourceFile, node => {
            if (ts.isVariableStatement(node)) {
                if (node.declarationList.declarations.length > 1) {
                    hasError = true;
                    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, node.pos);
                    const position = `${sourceFile.fileName}:${line + 1}${character + 1}`;
                    logError(mcx.logheader, `${position} not support multiple declarations in variable declaration, I will not do that, when will that happen?`);
                    return;
                }
                const declaration = node.declarationList.declarations[0];
                if (ts.isIdentifier(declaration.name)) {
                    names.push(declaration.name.text);
                } else if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) {
                    // recursively extract names from nested binding patterns
                    const extractNames = (bindingPattern: ts.ObjectBindingPattern | ts.ArrayBindingPattern) => {
                        for (const element of bindingPattern.elements) {
                            // array binding pattern only have an additional omitexpression in elements, which is not interested here, so a isBindingElement can handle both
                            // if you want to omit the if and use .filter, typescript currently still don't understand for element in elements.filter(ts.isBindingElement)
                            if (ts.isBindingElement(element)) {
                                if (ts.isIdentifier(element.name)) {
                                    names.push(element.name.text);
                                } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
                                    extractNames(element.name);
                                }
                            }
                        }
                    };
                    extractNames(declaration.name);
                }
            } else if (ts.isFunctionDeclaration(node)) {
                if (ts.isIdentifier(node.name)) {
                    names.push(node.name.text);
                }
            } else if (ts.isImportDeclaration(node)) {
                // NOTE collect import is not here, this include types, which is more inconvenient to exclude
            } else if (ts.isExportDeclaration(node)) {
                // this looks like dedicated export statement `export { a, b as c };`,
                // export const and export function is normal variable statement or function definition statement
                hasError = true;
                const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.pos);
                logError(mcx.logheader, `${sourceFile.fileName}:${line + 1}:${character + 1}: not support dedicated export statement for now`); // , node);
            } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
                // not relavent to js
            } else if (ts.isClassDeclaration(node)) {
                if (ts.isIdentifier(node.name)) {
                    names.push(node.name.text);
                }
            } else if (ts.isExpressionStatement(node) || ts.isForOfStatement(node) || ts.isIfStatement(node)) {
                // top level expression and normal statements will not define new name
            } else if (node.kind == 1) {
                // this is the EOF token
            } else {
                hasError = true;
                const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.pos);
                logError(mcx.logheader, `${sourceFile.fileName}:${line + 1}:${character + 1}: unknown top level node kind: ${ts.SyntaxKind[node.kind]}`); // , node);
            }
        });
        allNames[sourceFile.fileName] = names;
    }
    for (const [fileName, names] of Object.entries(allNames)) {
        for (const name of names) {
            const previousFileName = Object.entries(allNames).find(file => file[0] != fileName && file[1].includes(name))?.[0];
            if (previousFileName) {
                hasError = true;
                logError(mcx.logheader, `${fileName} top level name ${name} has appeared in previous file ${previousFileName}`);
            }
        }
    }

    // for (const [fileName, names] of Object.entries(result)) {
    //     console.log(`${fileName}: ${names.join(',')}`)
    // }
    return !hasError;
}

// collect modules by resolve import declarations, return false for not ok
// NOTE this reads mcx.files, creates mcx.modules
// NOTE current implementation does not allow multiline import declarations,
// NOTE in current implementation, if multiple requests from same module in same module,
//      it results in multiple module.requests records, but later the merge correctly merge that
function resolveModuleDependencies(mcx: MyPackContext): boolean {
    let hasError = false;

    mcx.modules = [];
    for (const [fileName, fileContent] of Object.entries(mcx.files)) {
        const module: MyPackModule = { path: fileName, content: fileContent, requests: [] };

        fileContent.split('\n').map((r, i) => [r, i + 1] as const).forEach(([line, rowNumber]) => {
            const raw = line.trim();
            if (!raw.startsWith('import ')) { return; }
            const request = { namedNames: [] } as MyPackModuleRequest;

            // use plain string operation because regex does not fully handle this
            line = line.substring(7).trimStart(); // consume 'import '
            let match = /^(?<name>\w+\s)/.exec(line);
            if (match) {
                request.defaultName = match.groups['name'].trim();
                line = line.substring(request.defaultName.length + 1).trimStart(); // consume default name
            }
            // consume comma if exist, it's ok to not handle trailing comma because tsc will syntax check that
            if (line.startsWith(',')) { line = line.substring(1).trimStart(); }

            if (line.startsWith('*')) {
                line = line.substring(1).trimStart(); // consume *
                if (!line.startsWith('as')) {
                    hasError = true;
                    logError(mcx.logheader, `${fileName}:${rowNumber}: ${raw}: invalid syntax, when will this happen? (1)`);
                    return;
                }
                line = line.substring(2).trimStart(); // consume 'as'
                match = /^(?<name>\w+\s)/.exec(line);
                if (!match) {
                    hasError = true;
                    logError(mcx.logheader, `${fileName}:${rowNumber}: ${raw}: invalid syntax, when will this happen? (2)`);
                    return;
                }
                request.namespaceName = match.groups['name'].trim();
                line = line.substring(request.namespaceName.length + 1).trimStart(); // consume namespace name
            }

            if (line.startsWith('{')) {
                line = line.substring(1).trimStart(); // consume left brace
                while (true) {
                    match = /^(?<name>\w+)\s?(\s*as\s+(?<alias>\w+))?/.exec(line);
                    if (!match) {
                        break; // this is end of name list, not error
                    }
                    request.namedNames.push({ name: match.groups['name'], alias: match.groups['alias'] ?? match.groups['name'] });
                    line = line.substring(match[0].length).trimStart(); // consume name and alias
                    if (line.startsWith(',')) { line = line.substring(1).trimStart(); }// consume comma if exist
                }
                if (!line.startsWith('}')) {
                    hasError = true;
                    logError(mcx.logheader, `${fileName}:${rowNumber}: ${raw}: invalid syntax, when will this happen? (4)`);
                    return;
                }
                line = line.substring(1).trimStart(); // consume right brace
            }
            if (!line.startsWith('from ')) {
                hasError = true;
                logError(mcx.logheader, `${fileName}:${rowNumber}: ${raw}: invalid syntax, when will this happen? (5)`);
                return;
            }
            line = line.substring(5).trimStart(); // consume 'from '

            match = /^['"](?<name>.+)['"]/.exec(line);
            if (!match) {
                hasError = true;
                logError(mcx.logheader, `${fileName}:${rowNumber}: ${raw}: invalid syntax, when will this happen? (6)`);
                return;
            }
            request.moduleName = match.groups['name'];

            if (request.moduleName.startsWith('.')) {
                const name = request.namedNames.find(n => n.name != n.alias);
                if (name) {
                    hasError = true;
                    logError(mcx.logheader, `${fileName}:${rowNumber}: ${raw}: not allow import alias in relative import for now`);
                    return;
                }
            }
            module.requests.push(request);
        });
        mcx.modules.push(module);
    }

    // for (const module of modules) {
    //     console.log(`${module.path}: `);
    //     for (const request of module.requests) {
    //         console.log(`   from: ${request.moduleName}, default: ${request.defaultName
    //             || ''}, namespace: ${request.namespaceName || ''}, names: ${request.namedNames.join(',')}`);
    //     }
    // }
    return !hasError;
}

// resolve relative imports, check recursive reference, sort modules
// validate external references use same defualt name, same namespace name and same alias, merge into one external request list
// return false for not ok
// NOTE this reads mcx.modules, creates mcx.externalRequests, sorts mcx.modules
// NOTE allow same name to be imported as different alias
// NOTE sort external references by 'node:' first, then name, sort named import by alias
// NOTE if namespace import and named import are used at the same time,
//      they become one entry in mcx.externalRequests, but will generate 2 import statements in result
function validateModuleDependencies(mcx: MyPackContext): boolean {
    let hasError = false;

    mcx.externalRequests = [];
    for (const module of mcx.modules) {
        for (const moduleImport of module.requests.filter(d => !d.moduleName.startsWith('.'))) {
            const mergedImport = mcx.externalRequests.find(m => m.moduleName == moduleImport.moduleName);
            if (!mergedImport) {
                // deep clone, currently modify original object does not cause error, but don't do that
                mcx.externalRequests.push({ ...moduleImport, namedNames: [...moduleImport.namedNames] });
                continue;
            }
            /* eslint-disable @stylistic/indent-binary-ops, @stylistic/comma-dangle -- lazy to find correct formatting rules for following complex conditions */
            if (moduleImport.defaultName) {
                if (mergedImport.defaultName && mergedImport.defaultName != moduleImport.defaultName) {
                    hasError = true;
                    logError(mcx.logheader, `${module.path}: inconsistent default import from '${moduleImport.moduleName}', previous use ${mergedImport.defaultName}, here use ${moduleImport.defaultName}`);
                } else if (mcx.externalRequests.some(o => o.moduleName != moduleImport.moduleName
                    && (o.defaultName == moduleImport.defaultName || o.namespaceName == moduleImport.defaultName || o.namedNames.some(n => n.alias == moduleImport.defaultName))
                )) {
                    hasError = true;
                    logError(mcx.logheader, `${module.path}: default import ${moduleImport.defaultName} from '${moduleImport.moduleName}' has appeared in other import declarations from other modules`);
                } else if (mergedImport.namedNames.some(n => n.alias == moduleImport.defaultName)) {
                    hasError = true;
                    logError(mcx.logheader, `${module.path}: default import ${moduleImport.defaultName} from '${moduleImport.moduleName}' has appeared previous named imports from this module, when will this happen?`);
                } else if (!moduleImport.defaultName) {
                    mergedImport.defaultName = moduleImport.defaultName;
                }
            }
            if (moduleImport.namespaceName) {
                if (mergedImport.namespaceName && mergedImport.namespaceName != moduleImport.namespaceName) {
                    hasError = true;
                    logError(mcx.logheader, `${module.path}: inconsistent namespace import from '${moduleImport.moduleName}', previous use ${mergedImport.namespaceName}, here use ${moduleImport.namespaceName}`);
                } else if (mcx.externalRequests.some(o => o.moduleName != moduleImport.moduleName
                    && (o.namespaceName == moduleImport.namespaceName || o.namespaceName == moduleImport.namespaceName || o.namedNames.some(n => n.alias == moduleImport.namespaceName))
                )) {
                    hasError = true;
                    logError(mcx.logheader, `${module.path}: namespace import ${moduleImport.namespaceName} from '${moduleImport.moduleName}' has appeared in other import declarations from other modules`);
                } else if (mergedImport.namedNames.some(n => n.alias == moduleImport.namespaceName)) {
                    hasError = true;
                    logError(mcx.logheader, `${module.path}: namespace import ${moduleImport.namespaceName} from '${moduleImport.moduleName}' has appeared previous named imports from this module, when will this happen?`);
                } else if (!moduleImport.namespaceName) {
                    mergedImport.namespaceName = moduleImport.namespaceName;
                }
            }
            for (const namedName of moduleImport.namedNames) {
                if (mcx.externalRequests.some(o => o.moduleName != moduleImport.moduleName
                    && (o.defaultName == namedName.alias || o.namespaceName == namedName.alias || o.namedNames.some(n => n.alias == namedName.alias))
                )) {
                    hasError = true;
                    logError(mcx.logheader, `${module.path}: import ${namedName.alias} from '${moduleImport.moduleName}' has appeared in other import declarations`);
                } else if (mergedImport.namespaceName == namedName.alias || mergedImport.defaultName == namedName.alias) {
                    hasError = true;
                    logError(mcx.logheader, `${module.path}: import ${namedName.alias} from '${moduleImport.moduleName}' has appeared previous namespace import or default import from this module, when will this happen?`);
                } else if (mergedImport.namedNames.some(e => e.name != namedName.name && e.alias == namedName.alias)) {
                    hasError = true;
                    const previous = mergedImport.namedNames.find(e => e.name != namedName.name && e.alias == namedName.alias);
                    logError(mcx.logheader, `${module.path}: inconsistant import ${namedName.name} as ${namedName.alias} from '${moduleImport.moduleName}, previous is ${previous.name} as ${previous.alias}'`);
                }
                // name != name and alias != alias: normal different name
                // name != name and alias == alias: already reported name conflict
                // name == name and alias != alias: same name can be imported as different alias
                // name == name and alias == alias: normal same name import
                // so add record by finding alias is enough
                if (!mergedImport.namedNames.some(e => e.alias != namedName.alias)) {
                    mergedImport.namedNames.push(namedName);
                }
            }
            /* eslint-enable @stylistic/indent-binary-ops, @stylistic/comma-dangle */
        }
    }

    // sort named names by alias
    mcx.externalRequests.forEach(r => r.namedNames.sort((lhs, rhs) => lhs.alias.localeCompare(rhs.alias)));
    // sort by module name, first by starts with 'node:' first, then by name
    mcx.externalRequests.sort((lhs, rhs) => {
        const leftIsNode = lhs.moduleName.startsWith('node:');
        const rightIsNode = rhs.moduleName.startsWith('node:');
        if (leftIsNode && !rightIsNode) { return -1; }
        if (!leftIsNode && rightIsNode) { return 1; }
        // this correctly handles rest part after node: and non node module names
        return lhs.moduleName.localeCompare(rhs.moduleName);
    });

    // console.log('final external references: ');
    // for (const declaration of externalRequests) {
    //     console.log(`   from: ${declaration.moduleName}, default: ${declaration.defaultName
    //         || ''}, namespace: ${declaration.namespaceName || ''}, names: ${declaration.names.join(',')}`);
    // }

    // https://nodejs.org/api/esm.html#resolution-algorithm
    for (const module of mcx.modules) {
        for (const request of module.requests.filter(d => d.moduleName.startsWith('.'))) {
            const resolvedModuleName = [
                path.resolve(path.dirname(module.path), request.moduleName),
                path.resolve(path.dirname(module.path), request.moduleName, './index.js'),
            ].find(p => mcx.modules.some(m => m.path == p));
            if (!resolvedModuleName) {
                hasError = true;
                logError(mcx.logheader, `${module.path}: import '${request.moduleName}' not found, when will this happen?`);
                continue;
            }
            request.relativeModule = mcx.modules.find(m => m.path == resolvedModuleName);
        }
    }

    const sortedModules: MyPackModule[] = [];
    let remainingModules = [...mcx.modules];
    let remainingRelationships = mcx.modules.reduce((acc, m) => acc.concat(m.requests.filter(d => d.relativeModule)
        .map(d => ({ dependency: d.relativeModule, dependent: m }))), [] as { dependency: MyPackModule, dependent: MyPackModule }[]);
    let depth = 0;
    while (true) {
        // not importing other module
        const noDependencyModules = remainingModules.filter(m => !remainingRelationships.some(r => r.dependent === m));
        sortedModules.push(...noDependencyModules);
        remainingRelationships = remainingRelationships.filter(r => !noDependencyModules.includes(r.dependency));
        remainingModules = remainingModules.filter(m => !noDependencyModules.includes(m));
        if (remainingModules.length == 0) {
            break;
        }
        depth += 1;
        if (depth >= 10) {
            hasError = true;
            logError(mcx.logheader, `too deep dependency or recursive dependency`, remainingRelationships);
            break;
        }
    }
    // entry must be in last batch of modules, but may not be last module, you need to explicitly do that
    mcx.modules = sortedModules.filter(m => m.path != mcx.entry).concat(mcx.modules.find(m => m.path == mcx.entry));

    return !hasError;
}

// convert external references to cdn url, return false for not ok
// NOTE this reads mcx.externalRequests, sets externalRequest.cdn
async function cdnfy(mcx: MyPackContext): Promise<boolean> {
    if (!mcx.cdnfy) { return true; }
    let hasError = false;

    let projectConfig: {
        dependencies: Record<string, string>,
        devDependencies: Record<string, string>,
    };
    try {
        projectConfig = JSON.parse(await fs.readFile('package.json', 'utf-8'));
    } catch (error) {
        logError(mcx.logheader, 'failed to read package.json in cdnfy', error);
        return false;
    }
    const projectDependencies = Object
        .entries(projectConfig.dependencies)
        .concat(Object.entries(projectConfig.devDependencies))
        // substring(1): remove the '^'
        .map(([name, version]) => ({ name, version: version.substring(1) }));

    for (const request of mcx.externalRequests) {
        // find package by begin with
        // for react and react-dom/client, multiple results should select longer package name
        const packages = projectDependencies
            .filter(d => request.moduleName.startsWith(d.name))
            .sort((d1, d2) => d2.name.length - d1.name.length);
        if (packages.length == 0) {
            hasError = true;
            logError(mcx.logheader, `external reference ${request.moduleName} not found package in package.json`);
            continue;
        }
        const $package = packages[0];
        const pathname = request.moduleName.substring($package.name.length);
        request.cdn = `https://esm.sh/${$package.name}@${$package.version}${pathname}`;
    }

    return !hasError;
}

// combine into one file, return false for not ok, currently no expected error
// NOTE this reads mcx.modules, mcx.externalRequests, assign to mcx.resultJs
function combineModules(mcx: MyPackContext): boolean {

    let resultJs = '';
    for (const request of mcx.externalRequests) {
        resultJs += 'import ';
        if (request.defaultName) { resultJs += `${request.defaultName}, `; }
        if (request.namespaceName) { resultJs += `* as ${request.namespaceName}, `; }
        if (request.namespaceName && request.namedNames.length) {
            resultJs = resultJs.slice(0, -2) + ` from '${request.moduleName}'\nimport `;
        }
        if (request.namedNames.length) {
            resultJs += `{ `;
            for (const { name, alias } of request.namedNames) {
                resultJs += name == alias ? `${name}, ` : `${name} as ${alias}, `;
            }
            resultJs = resultJs.slice(0, -2) + ' }, ';
        }
        resultJs = resultJs.slice(0, -2) + ` from '${request.cdn ?? request.moduleName}'\n`;
    }
    for (const module of mcx.modules) {
        resultJs += '\n';
        for (let line of module.content.split('\n').filter(r => !r.trim().startsWith('import'))) {
            // avoid export except entry, or else terser will keep the name
            line = module.path != mcx.entry && line.startsWith('export ') ? line.substring(7) : line;
            resultJs += line + '\n';
        }
    }
    mcx.resultJs = resultJs;
    return true;
}

function filesize(size: number) {
    return size < 1024 ? `${size}b` : `${Math.round(size / 1024 * 100) / 100}kb`;
}
// if tcx is provided, it overwrites some input properties of mcx
// if you need to avoid that, avoid tcx or some of tcx properties, when do I need that?
async function mypack(mcx: MyPackContext, tcx?: TypeScriptContext, lastmcx?: MyPackContext): Promise<MyPackContext> {
    if (tcx) {
        mcx.program = tcx.program;
        mcx.files = tcx.files;
        // ATTENTION entry is not same
        // if (!Array.isArray(tcx.entry)) { mcx.entry = tcx.entry; }
        if (tcx.target == 'browser') { mcx.cdnfy = true; }
        if (tcx.additionalLogHeader) { mcx.logheader = 'mypack' + tcx.additionalLogHeader; } else { mcx.logheader = 'mypack'; }
    } else {
        mcx.logheader = mcx.logheader ? (mcx.logheader.startsWith('mypack') ? mcx.logheader : 'mypack' + mcx.logheader) : 'mypack';
    }
    if (lastmcx) {
        // not sure whether mcx can reuse, so create new
        mcx.resultHash = lastmcx.resultHash;
        mcx.resultModules = lastmcx.resultModules;
    }
    logInfo(mcx.logheader, `pack ${mcx.entry}`);

    if (!validateTopLevelNames(mcx)) { mcx.success = false; return mcx; }
    if (!resolveModuleDependencies(mcx)) { mcx.success = false; return mcx; }
    if (!validateModuleDependencies(mcx)) { mcx.success = false; return mcx; }
    if (!await cdnfy(mcx)) { mcx.success = false; return mcx; }
    if (!combineModules(mcx)) { mcx.success = false; return mcx; }

    mcx.resultJs = await tryminify(mcx.resultJs);
    if (!mcx.resultJs) { mcx.success = false; return mcx; }

    mcx.success = true;
    const newResultHash = createHash('sha256').update(mcx.resultJs).digest('hex');
    if (newResultHash == mcx.resultHash) {
        logInfo(mcx.logheader, chalk`completed with {gray no change}`);
    } else {
        mcx.resultHash = newResultHash;
        // TODO compress result should use in uploadwithremoteconnection
        const compressSize = ` (${filesize(zstdCompressSync(mcx.resultJs).length)})`;
        logInfo(mcx.logheader, chalk`completed with {yellow 1} asset {yellow ${filesize(mcx.resultJs.length)}}${compressSize}`);
        const newResultModules = mcx.modules
            .map(m => ({ path: m.path, size: m.content.length, hash: createHash('sha256').update(m.content).digest('hex') }));
        if (mcx.resultModules) {
            for (const addedModule of newResultModules.filter(n => !mcx.resultModules.some(p => p.path == n.path))) {
                console.log(chalk`  {gray +} ${addedModule.path} ${filesize(addedModule.size)}`);
            }
            for (const [updatedModule] of newResultModules
                .map(n => [n, mcx.resultModules.find(p => p.path == n.path)] as const)
                .filter(([currentModule, previousModule]) => previousModule && currentModule.hash != previousModule.hash)) {
                console.log(chalk`  {gray *} ${updatedModule.path} ${filesize(updatedModule.size)}`);
            }
            for (const removedModule of mcx.resultModules.filter(p => !newResultModules.some(n => n.path == p.path))) {
                console.log(chalk`  {gray -} ${removedModule.path}`);
            }
        } else {
            for (const { path, size } of newResultModules) {
                console.log(chalk`   {gray +} {greenBright ${path}} ${filesize(size)}`);
            }
        }
        mcx.resultModules = newResultModules;
    }
    return mcx;
}

// --------------------------------------------
// ------ script/components/messenger.ts ------ 
// --------- ATTENTION AUTO GENERATED ---------
// --------------------------------------------

// messenger: message sender abbreviated as messenger

// use this to avoid global variables because currently no other major global variables used
/* eslint-disable @stylistic/quote-props -- ? */
interface MessengerContext {
    '?'?: boolean, // ?
    readline: Interface,
    connection?: WebSocket,
    // id to waker (the promise resolver)
    wakers?: Record<number, (data: BuildScriptMessageResponse) => void>,
    nextMessageId?: number,
    reconnectCount?: number,
    // store last mcx for report
    lastmcxStorage?: Record<string, MyPackContext>,
}

// return true for connected
async function connectRemote(ecx: MessengerContext) {
    if (!ecx['?']) {
        // ???
        const myCertificate = await fs.readFile(scriptconfig.certificate, 'utf-8');
        const originalCreateSecureContext = tls.createSecureContext;
        tls.createSecureContext = options => {
            const originalResult = originalCreateSecureContext(options);
            if (!options.ca) {
                originalResult.context.addCACert(myCertificate);
            }
            return originalResult;
        };
        ecx['?'] = true;
        // this place exactly can use to initialize member fields
        ecx.reconnectCount = 0;
        ecx.nextMessageId = 1;
        ecx.wakers = {};
        ecx.lastmcxStorage = {};
    }
    if (ecx.reconnectCount >= 3) {
        ecx.reconnectCount = 0;
        logError('tunnel', 'connect retry time >= 3, you may manually reconnect later');
        return false;
    }

    return new Promise<boolean>(resolve => {
        const websocket = new WebSocket(`wss://${scriptconfig.domain}:8001`, 'akari');

        // the close event may not be called after error event is called
        // but normally will, use this to avoid duplicate invocation of reconnect
        // https://stackoverflow.com/questions/38181156/websockets-is-an-error-event-always-followed-by-a-close-event
        let reconnectInvoked = false;

        websocket.addEventListener('open', async () => {
            ecx.reconnectCount = 0;
            logInfo('tunnel', `connected, you'd better complete authentication quickly`);
            const token = await ecx.readline.question('> ');
            websocket.send(token);
        });
        websocket.addEventListener('close', async () => {
            logInfo('tunnel', `websocket disconnected`);
            if (!reconnectInvoked) {
                ecx.reconnectCount += 1;
                resolve(await connectRemote(ecx));
            }
        });
        websocket.addEventListener('error', async () => {
            // this event have error parameter, but that does not have any meaningful property, so omit
            logError('tunnel', `websocket error`);
            reconnectInvoked = true;
            ecx.reconnectCount += 1;
            resolve(await connectRemote(ecx));
        });

        websocket.addEventListener('message', async event => {
            if (event.data == 'authenticated') {
                ecx.connection = websocket;
                logInfo('tunnel', 'websocket received authenticated');
                // this resolve should be most normal case
                resolve(true);
            } else {
                logInfo('tunnel', 'websocket received', event.data);
                try {
                    const response = JSON.parse(event.data);
                    if (!response.id) {
                        logError('tunnel', `received response without id, when will this happen?`);
                    } else if (!(response.id in ecx.wakers)) {
                        logError('tunnel', `no waker found for received response, when will this happen?`);
                    } else {
                        ecx.wakers[response.id](response);
                        delete ecx.wakers[response.id];
                    }
                } catch (error) {
                    logError('tunnel', `received data failed to parse json`, error);
                }
            }
        });
    });
}

/* eslint-disable @stylistic/operator-linebreak -- false positive for type X =\n| Variant1\n| Variant2 */
// BEGIN SHARED TYPE BuildScriptMessage
interface HasId {
    id: number,
}

// received packet format
// - magic: NIRA, packet id: u16le, kind: u8
// - kind: 1 (file), file name length: u8, filename: not zero terminated, buffer length: u32le, buffer
// - kind: 2 (admin), command kind: u8
//   - command kind: 1 (static-content:reload), key length: u8, key: not zero terminated
//   - command kind: 2 (app:reload-server), app length: u8, app: not zero terminated
// - kind: 3 (reload-browser)
interface BuildScriptMessageUploadFile {
    kind: 'file',
    filename: string,
    content: Buffer, // this is compressed
}
interface BuildScriptMessageAdminInterfaceCommand {
    kind: 'admin',
    command:
        // remote-akari knows AdminInterfaceCommand type, local akari don't
        // this also explicitly limit local admin command range, which is ok
        | { kind: 'static-content:reload', key: string }
        | { kind: 'app:reload-server', name: string },
}
interface BuildScriptMessageReloadBrowser {
    kind: 'reload-browser',
}
type BuildScriptMessage =
    | BuildScriptMessageUploadFile
    | BuildScriptMessageAdminInterfaceCommand
    | BuildScriptMessageReloadBrowser;

// response packet format
// - magic: NIRA, packet id: u16le, kind: u8
// - kind: 1 (file), status: u8
// - kind: 2 (admin)
// - kind: 3 (reload-browser)
interface BuildScriptMessageResponseUploadFile {
    kind: 'file',
    // filename path is not in returned data but assigned at local side
    filename?: string,
    // no error message in response, it is displayed here
    status: 'ok' | 'error' | 'nodiff',
}
interface BuildScriptMessageResponseAdminInterfaceCommand {
    kind: 'admin',
    // command is not in returned data but assigned at local side
    command?: BuildScriptMessageAdminInterfaceCommand['command'],
    // response is not in returned data but displayed here
}
interface BuildScriptMessageResponseReloadBrowser {
    kind: 'reload-browser',
}
type BuildScriptMessageResponse =
    | BuildScriptMessageResponseUploadFile
    | BuildScriptMessageResponseAdminInterfaceCommand
    | BuildScriptMessageResponseReloadBrowser;
// END SHARED TYPE BuildScriptMessage

async function sendRemoteMessage(ecx: MessengerContext, message: BuildScriptMessageUploadFile): Promise<BuildScriptMessageResponseUploadFile>;
async function sendRemoteMessage(ecx: MessengerContext, message: BuildScriptMessageAdminInterfaceCommand): Promise<BuildScriptMessageResponseAdminInterfaceCommand>;
async function sendRemoteMessage(ecx: MessengerContext, message: BuildScriptMessageReloadBrowser): Promise<BuildScriptMessageResponseReloadBrowser>;
async function sendRemoteMessage(ecx: MessengerContext, message: BuildScriptMessage): Promise<BuildScriptMessageResponse> {
    if (!ecx.connection) {
        logError('tunnel', "not connected, type 'connect remote' to reconnect");
        return null;
    }

    const messageId = ecx.nextMessageId;
    ecx.nextMessageId += 1;

    let buffer: Buffer;
    if (message.kind == 'file') {
        buffer = Buffer.alloc(12 + message.filename.length + message.content.length);
        buffer.write('NIRA', 0); // magic size 4
        buffer.writeUInt16LE(messageId, 4); // packet id size 2
        buffer.writeUInt8(1, 6); // kind size 1
        buffer.writeUInt8(message.filename.length, 7); // file name length size 1
        buffer.write(message.filename, 8);
        buffer.writeUInt32LE(message.content.length, message.filename.length + 8); // content length size 4
        message.content.copy(buffer, 12 + message.filename.length, 0);
        logInfo('tunnel', `send #${messageId} file ${message.filename} compress size ${message.content.length}`);
    } else if (message.kind == 'admin') {
        if (message.command.kind == 'static-content:reload') {
            buffer = Buffer.alloc(9 + message.command.key.length);
            buffer.write('NIRA', 0); // magic size 4
            buffer.writeUInt16LE(messageId, 4); // packet id size 2
            buffer.writeUInt8(2, 6); // kind size 1
            buffer.writeUInt8(1, 7); // command kind size 1
            buffer.writeUInt8(message.command.key.length, 8); // key length size 1
            buffer.write(message.command.key, 9);
            logInfo('tunnel', `send #${messageId} static-content:reload ${message.command.key}`);
        } else if (message.command.kind == 'app:reload-server') {
            buffer = Buffer.alloc(9 + message.command.name.length);
            buffer.write('NIRA', 0); // magic size 4
            buffer.writeUInt16LE(messageId, 4); // packet id size 2
            buffer.writeUInt8(2, 6); // kind size 1
            buffer.writeUInt8(2, 7); // command kind size 1
            buffer.writeUInt8(message.command.name.length, 8); // name length size 1
            buffer.write(message.command.name, 9);
            logInfo('tunnel', `send #${messageId} app:reload-server ${message.command.name}`);
        }
    } else if (message.kind == 'reload-browser') {
        buffer = Buffer.alloc(7);
        buffer.write('NIRA', 0); // magic size 4
        buffer.writeUInt16LE(messageId, 4); // packet id size 2
        buffer.writeUInt8(3, 6); // kind size 1
        logInfo('tunnel', `send #${messageId} reload-browser`);
    }

    ecx.connection.send(buffer);
    let timeout: any;
    const received = new Promise<BuildScriptMessageResponse>(resolve => {
        ecx.wakers[messageId] = response => {
            if (timeout) { clearTimeout(timeout); }
            if (message.kind == 'file' && response.kind == 'file') {
                response.filename = message.filename;
            } else if (message.kind == 'admin' && response.kind == 'admin') {
                response.command = message.command;
            }
            resolve(response);
        };
    });

    return await Promise.any([
        received,
        new Promise<BuildScriptMessageResponse>(resolve => {
            timeout = setTimeout(() => {
                delete ecx.wakers[messageId];
                logError('tunnel', `message ${messageId} timeout`);
                resolve(null);
            }, 30_000);
        }),
    ]);
}

// upload through websocket connection eliminate the time to establish tls connection and ssh connection
// this also have centralized handling of example.com replacement
// return item is null for not ok
async function deployWithRemoteConnect(ecx: MessengerContext, assets: UploadAsset[]): Promise<BuildScriptMessageResponseUploadFile[]> {
    // compare to the not know whether can parallel sftp, this is designed to be parallel
    return await Promise.all(assets.map(async asset => {
        // webroot base path and parent path mkdir is handled in remote akari
        if (!Buffer.isBuffer(asset.data)) {
            asset.data = Buffer.from(asset.data.replaceAll('example.com', scriptconfig.domain));
        }
        const data = await new Promise<Buffer>(resolve => zstdCompress(asset.data, (error, data) => {
            if (error) {
                logError('messenger-upload', `failed to compress ${asset.remote}`, error);
                resolve(null);
            } else {
                resolve(data);
            }
        }));
        if (data) {
            return await sendRemoteMessage(ecx, { kind: 'file', filename: asset.remote, content: data });
        } else {
            return null;
        }
    }));
}
// END LIBRARY dd4698e6bb3ab46d61a6cce565e15f2f1cc2b39318943d27fbcf60b47c23b76b

async function build(ecx: MessengerContext, options: CodeGenerationOptions) {
    if (!options.client && !options.server) { return; }
    const targetName = [options.client ? 'client' : '', options.server ? 'server' : ''].filter(x => x).join(' + ');
    logInfo('akari', chalk`build {cyan ${targetName}}`);

    const codeGenerationConfig = await readCodeGenerationConfig(options);
    if (!codeGenerationConfig) { logError('akari', 'failed at read codegen config'); return; }
    const codeGenerationResult = await generateCode(codeGenerationConfig, )
    if (!codeGenerationResult) { logError('akari', 'failed at code generation'); return; }

    const assets: UploadAsset[] = [];
    const lastmcx = ecx?.lastmcxStorage ?? {};

    if (options.client) {
        const tcx1 = transpile({ entry: 'src/client/index.tsx', target: 'browser', additionalLogHeader: '-mainclient' });
        if (!tcx1.success) { logError('akari', 'failed at transpile mainclient' ); return; }
        // TODO why is the /vbuild/client/index.js part missing?
        const mcx1 = await mypack({ entry: '/vbuild/index.js' }, tcx1, lastmcx[tcx1.additionalLogHeader]);
        if (!mcx1.success) { logError('akari', 'failed at pack mainclient'); return; }

        lastmcx[tcx1.additionalLogHeader] = mcx1;
        assets.push({ data: mcx1.resultJs, remote: 'static/yama/index.js' });
        assets.push({ data: await fs.readFile('src/client/index.html', 'utf-8'), remote: 'static/yama/index.html' });

        // const tcx2 = transpile({ entry: 'src/client/share.tsx', target: 'browser', additionalLogHeader: '-shareclient' });
        // if (!tcx2.success) { logError('akari', 'failed at transpile shareclient' ); return; }
        // const mcx2 = await mypack({ entry: '/vbuild/share.js' }, tcx2, lastmcx[tcx2.additionalLogHeader]);
        // if (!mcx2.success) { logError('akari', 'failed at pack shareclient'); return; }

        // lastmcx[tcx2.additionalLogHeader] = mcx2;
        // assets.push({ data: mcx2.resultJs, remote: 'static/yama/share.js' });
        // assets.push({ data: await fs.readFile('src/client/share.html', 'utf-8'), remote: 'static/yama/share.html' });

        // if (!await eslint({ files: 'src/client/*.tsx', additionalLogHeader: '-client' })) { /* return; */ }
    }

    if (options.server) {
        const tcx = transpile({ entry: 'src/server/index.ts', target: 'node', additionalLogHeader: '-server', additionalOptions: { noUnusedLocals: false, noUnusedParameters: false } });
        if (!tcx.success) { logError('akari', 'failed at transpile server' ); return; }
        const mcx = await mypack({ entry: '/vbuild/index.js' }, tcx, lastmcx[tcx.additionalLogHeader]);
        if (!mcx.success) { logError('akari', 'failed at pack server'); return; }

        lastmcx[tcx.additionalLogHeader] = mcx;
        assets.push({ data: mcx.resultJs, remote: 'servers/yama.js' });

        // if (!await eslint({ files: 'src/server/index.ts', additionalLogHeader: '-server' })) { /* return; */ }
    }

    if (ecx) {
        const uploadResults = await deployWithRemoteConnect(ecx, assets);
        if (uploadResults.some(r => !r || r.status == 'error')) {
            logError('akari', chalk`{cyan ${targetName}} failed at upload`); return;
        } else if (!uploadResults.some(r => r.status == 'ok')) {
            logInfo('akari', chalk`build {cyan ${targetName}} completed with no change`); return;
        } else {
            const reloadRequests: BuildScriptMessageAdminInterfaceCommand['command'][] = [];
            if (uploadResults.some(r => r.filename.startsWith('static/yama') && r.status == 'ok')) {
                reloadRequests.push({ kind: 'static-content:reload', key: 'yama' });
            }
            if (uploadResults.some(r => r.filename.startsWith('servers/yama') && r.status == 'ok')) {
                reloadRequests.push({ kind: 'app:reload-server', name: 'yama' });
            }
            await Promise.all(reloadRequests.map(r => sendRemoteMessage(ecx, { kind: 'admin', command: r })));
            // TODO now you really need admin command ok to skip reload browser
            await sendRemoteMessage(ecx, { kind: 'reload-browser' });
        }
    } else {
        const uploadResult = await deploy(assets);
        if (!uploadResult) { logError('akari', 'failed at upload'); return; }
    }

    logInfo('akari', chalk`build {cyan ${targetName}} completed successfully`); return;
}

async function dispatch(command: string[]) {
    if (typeof command[0] == 'undefined') {
        await build(null, { client: true, server: true, emit: true, ignoreHashMismatch: false });
    } else if (command[0] != 'with' || command[1] != 'remote') {
        await build(null, {
            client: !command.includes('noclient'),
            server: !command.includes('noserver'),
            emit: !command.includes('nocodegen'),
            ignoreHashMismatch: command.includes('ignorehash'),
        });
    } else if (command[0] == 'with' && command[1] == 'remote') {
        const ecx: MessengerContext = {
            readline: readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                removeHistoryDuplicates: true,
            }),
        };
        await connectRemote(ecx);
        ecx.readline.on('SIGINT', () => process.exit(0));
        ecx.readline.prompt();
        for await (const raw of ecx.readline) {
            const line = raw.trim();
            if (line.length == 0) {
                // nothing
            } else if (line == 'exit') {
                // it's more complex to disable websocket auto reconnect
                process.exit(0);
            } else if (line.startsWith('connect')) {
                await connectRemote(ecx);
            } else if (line == 'app') {
                await build(ecx, { client: true, server: true, emit: true, ignoreHashMismatch: false });
            } else if (line.startsWith('app')) {
                await build(ecx, {
                    client: !line.includes('noclient'),
                    server: !line.includes('noserver'),
                    emit: !line.includes('nocodegen'),
                    ignoreHashMismatch: line.includes('ignorehash'),
                });
            } else if (line.startsWith('upload ')) {
                // TODO upload arbitrary file
            } else { // TODO download arbitrary file?
                logError('akari', `unknown command`);
            }
            ecx.readline.prompt();
        }
    } else {
        logError('akari', 'unknown command');
    }
}

dispatch(process.argv.slice(2));
