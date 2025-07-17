import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import tls from 'node:tls';
import chalk from 'chalk-template';
import { XMLParser } from 'fast-xml-parser';
import SFTPClient from 'ssh2-sftp-client';
import { minify } from 'terser';
import ts from 'typescript';

// this is currently the app server builder base template
// - server side multiple file,
//   currently for server side I'd like to keep it single file, because merge multiple file is very complex,
//   related type definitions can have separate file and copy around,
//   shared non-type (actual js) code currently is short and is included auto generated dispatch function
// - server side auto generated api dispatch,
//   still needed, but seems no need to namespace, put 10 or 20 apis in one namespace should be ok
//   I'd consider suggesting making app servers small and no need to be separated in namespace
// - client side,
//   for now this specific app is similar to user, single file, use react, no antd,
//   I'd currently try to keep single file until some app want to use client side routing

const debug = 'AKARI_DEBUG' in process.env;
// TODO if this is needed again, it need to be in buildscriptwebsocket command
const nocodegen = 'AKARI_NOCG' in process.env; // manually change codegen part for debugging, etc.
if (nocodegen) { console.log('configured no codegen'); }
const config = JSON.parse(await fs.readFile('akaric', 'utf-8'));

// ???
// by the way ATTENTION this relative path is not same as in build-core.js
const mycert = await fs.readFile('../../../my.crt', 'utf-8');
const originalCreateSecureContext = tls.createSecureContext;
tls.createSecureContext = options => {
    const originalResult = originalCreateSecureContext(options);
    if (!options.ca) {
        originalResult.context.addCACert(mycert);
    }
    return originalResult;
};

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

// return true for ok, false for not ok
async function generateForDatabaseModel(): Promise<boolean> {
    console.log('code generation database model');
    let hasError = false;

    const parser = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: true,
    });
    // the result of preserveOrder: boolean is too complex and not that worthy to type
    const rawDatabaseModel = parser.parse(await fs.readFile('src/server/database.xml'));

    const databaseName = rawDatabaseModel[1][':@'].name;
    const databaseModel = (rawDatabaseModel[1].database as any[]).map<DatabaseModelTable>(c => ({
        name: c[':@'].name,
        primaryKey: c.table.find((f: any) => 'primary-key' in f)[':@'].field.split(','),
        foreignKeys: c.table.filter((f: any) => 'foreign-key' in f).map((f: any) => f[':@']),
        fields: c.table.filter((f: any) => 'field' in f).map((f: any) => ({
            name: f[':@'].name,
            type: f[':@'].type.endsWith('?') ? f[':@'].type.substring(0, f[':@'].type.length - 1) : f[':@'].type,
            nullable: f[':@'].type.endsWith('?'),
            size: f[':@'].size ? parseInt(f[':@'].size) : null,
        })),
    }));
    // console.log(JSON.stringify(databaseModel, undefined, 2));

    // database.d.ts
    let sb = '';
    sb += '// --------------------------------------\n';
    sb += '// ------ ATTENTION AUTO GENERATED ------\n';
    sb += '// --------------------------------------\n';
    sb += '\n';
    sb += `import type { Dayjs } from 'dayjs';\n`;
    sb += '\n';
    for (const table of databaseModel) {
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
            sb += `    ${field.name}${field.nullable ? '?' : ''}: ${type},\n`
        }
        sb += `    CreateTime: Dayjs,\n`;
        sb += `    UpdateTime: Dayjs,\n`;
        sb += `}\n`;
    }
    if (!nocodegen) {
        console.log('   write src/server/database.d.ts');
        await fs.writeFile('src/server/database.d.ts', sb);
    }

    // database.sql
    sb = '';
    sb += '--------------------------------------\n';
    sb += '------ ATTENTION AUTO GENERATED ------\n';
    sb += '--------------------------------------\n';
    sb += '\n';
    sb += '-- -- first, mysql -u root -p:\n'
    sb += `-- CREATE DATABASE '${databaseName}';\n`;
    sb += `-- GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO 'fine'@'localhost';\n`;
    sb += '-- FLUSH PRIVILEGES;\n';
    sb += '-- -- then, mysql -p\n';
    sb += '\n';
    for (const table of databaseModel) {
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
            const foreignTable = databaseModel.find(t => t.name == fk.table);
            if (foreignTable.primaryKey.length > 1) {
                hasError = true;
                console.error(chalk`{red error} table ${table.name} foreign key ${fk.field} cannot reference table ${fk.table} with composite primary key`);
            }
            const foreignTablePrimaryKey = foreignTable.primaryKey[0];
            sb += `    CONSTRAINT \`FK_${table.name}_${fk.table}\``;
            sb += ` FOREIGN KEY (\`${fk.field}\`) REFERENCES \`${fk.table}\`(\`${foreignTablePrimaryKey}\`),\n`;
        }
        sb = sb.substring(0, sb.length - 2) + '\n';
        sb += `);\n`;
    }
    if (!nocodegen) {
        console.log('   write src/server/database.sql');
        await fs.writeFile('src/server/database.sql', sb);
    }
    return !hasError;
}

interface WebInterfaceActionParameter {
    name: string,
    type: 'id' | 'guid', // for now only this
    optional: boolean,
}
interface WebInterfaceAction{
    // finally you need something to group actions
    // for now =main is main, =share is for share page
    // for now =temp is temporary investigating actions
    key: string,
    name: String,
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

// return true for ok, false for not ok
async function generateForWebInterface(): Promise<boolean> {
    console.log('code generation web interface');
    
    const parser = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: true,
    });
    const rawWebInterfaces = parser.parse(await fs.readFile('src/shared/api.xml'));
    // console.log(JSON.stringify(rawActions, undefined, 2));

    const actions: WebInterfaceAction[] = [];
    const actionTypes: WebInterfaceActionType[] = [];

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

    let sb = '';
    sb += '// --------------------------------------\n';
    sb += '// ------ ATTENTION AUTO GENERATED ------\n';
    sb += '// --------------------------------------\n';
    sb += '\n';
    for (const type of actionTypes) {
        sb += `export interface ${type.name} {\n`;
        for (const field of type.fields) {
            const type = {
                'id': 'number',
                'int': 'number',
                'datetime': 'string',
                'string': 'string',
            }[field.type] ?? field.type;
            sb += `    ${field.name}${field.nullable ? '?': ''}: ${type},\n`;
        }
        sb += '}\n';
    }
    if (!nocodegen) {
        console.log('   write src/shared/api.d.ts');
        await fs.writeFile('src/shared/api.d.ts', sb);
    }

    sb = await fs.readFile('src/server/index.ts', 'utf-8');
    sb = sb.substring(0, sb.indexOf('// AUTOGEN'));
    sb += '// AUTOGEN\n';
    sb += '// --------------------------------------\n';
    sb += '// ------ ATTENTION AUTO GENERATED ------\n';
    sb += '// --------------------------------------\n';
    sb += '\n'
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
    public string(name: string) { return this.validate(name, false, v => v, v => !!v); }
}\n`;
    // append more helper methods if need
    // public idopt(name: string) { return this.validate(name, true, parseInt, v => !isNaN(v) && v > 0); }

    sb += 'export async function dispatch(ctx: DispatchContext): Promise<DispatchResult> {\n';
    // NOTE no need to wrap try in this function because it correctly throws into overall request error handler
    sb += `    const { pathname, searchParams } = new URL(ctx.path, 'https://example.com');\n`;
    sb += `    const v = new ParameterValidator(searchParams);\n`
    sb += `    const ax: ActionContext = { now: ctx.state.now, userId: ctx.state.user?.id, userName: ctx.state.user?.name };\n`;
    sb += `    const action = ({\n`;
    for (const action of actions) {
        const functionName = action.name.charAt(0).toLowerCase() + action.name.substring(1);
        sb += `        '${action.method} ${action.public ? '/public' : ''}/v1/${action.path}': () => ${functionName}(ax, `;
        for (const parameter of action.parameters) {
            const method = parameter.type == 'id' ? 'id' : 'string';
            sb += `v.${method}('${parameter.name}'), `;
        }
        if (action.body) {
            sb += 'ctx.body, ';
        }
        sb = sb.substring(0, sb.length - 2) + '),\n';
    }
    sb += '    } as Record<string, () => Promise<any>>)[\`\${ctx.method} \${pathname}\`];\n';
    sb += `    return action ? { body: await action() } : { error: new MyError('not-found', 'invalid-invocation') };\n`;
    sb += `}\n`;

    if (!nocodegen) {
        console.log('   write partial src/server/index.ts');
        await fs.writeFile('src/server/index.ts', sb);
    }

    sb = await fs.readFile('src/client/index.tsx', 'utf-8');
    sb = sb.substring(0, sb.indexOf('// AUTOGEN'));
    sb += '// AUTOGEN\n';
    sb += '// --------------------------------------\n';
    sb += '// ------ ATTENTION AUTO GENERATED ------\n';
    sb += '// --------------------------------------\n';
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
    }
    window.location.assign('https://id.example.com?return=https://chat.example.com');
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
    const url = new URL(\`https://api.example.com/yala\${path}\`);
    Object.entries(parameters || {}).forEach(p => url.searchParams.append(p[0], p[1].toString()));
    const response = await fetch(url.toString(), data ? {
        method,
        body: JSON.stringify(data),
        headers: { 'authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' },
    } : { method, headers: { 'authorization': 'Bearer ' + accessToken } });
    if (response.status == 401) { confirmGotoIdentityProvider(); return; }
    // normal/error both return json body, but void do not
    const hasJsonBody = response.headers.has('content-Type') && response.headers.get('content-Type').includes('application/json');
    const responseData = hasJsonBody ? await response.json() : {};
    return response.ok ? Promise.resolve(responseData)
        : response.status >= 400 && response.status < 500 ? Promise.reject(responseData)
        : response.status >= 500 ? Promise.reject({ message: 'internal error' })
        : Promise.reject({ message: 'unknown error' });
}`;
    sb += '\n';
    sb += 'const api = {\n';
    // for now now action.key only used here
    for (const action of actions.filter(a => a.key == 'main')) {
        const functionName = action.name.charAt(0).toLowerCase() + action.name.substring(1);
        sb += `    ${functionName}: (`;
        for (const parameter of action.parameters) {
            const type = parameter.type == 'id' ? 'number' : 'string';
            sb += `${parameter.name}: ${type}, `;
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
                sb += `${parameter.name}, `;
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
    if (!nocodegen) {
        console.log('   write partial src/client/index.tsx');
        await fs.writeFile('src/client/index.tsx', sb);
    }

    return true; // no error for now
}

interface ScriptAssets {
    mainClient: string,
    shareClient: string,
    server: string,
}
// return null for has error
function transpile(): ScriptAssets {
    console.log('transpiling');

    const sharedConfig: ts.CompilerOptions = {
        lib: ['lib.esnext.d.ts'],
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
        noEmitOnError: true,
        strict: 'AKARIN_STRICT' in process.env,
        noImplicitAny: true,
        noFallthroughCaseInSwitch: true,
        noImplicitReturns: true,
        noImplicitThis: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        strictNullChecks: 'AKARIN_STRICT' in process.env,
        strictFunctionTypes: true,
        strictBindCallApply: true,
        strictBuiltinIteratorReturn: true,
        removeComments: true,
    }
    const clientProgram = ts.createProgram(['src/client/index.tsx'], {
        ...sharedConfig,
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
        jsx: ts.JsxEmit.ReactJSX,
        outDir: '/vbuild1',
        // disable for now
        noUnusedLocals: false,
        noUnusedParameters: false,
    });
    const clientProgram2 = ts.createProgram(['src/client/share.tsx'], {
        ...sharedConfig,
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
        jsx: ts.JsxEmit.ReactJSX,
        outDir: '/vbuild3',
    });
    const serverProgram = ts.createProgram(['src/server/index.ts'], {
        ...sharedConfig,
        outDir: '/vbuild2',
    });

    const files: Record<string, string> = {};
    const emitResult1 = clientProgram.emit(undefined, (fileName, data) => {
        if (data) { files[fileName] = data; }
    });
    const emitResult3 = clientProgram2.emit(undefined, (fileName, data) => {
        if (data) { files[fileName] = data; }
    });
    // TODO what's the following todo todoing, I can get type information from ast type node, then?
    // update: maybe is checking def-use chains and tree shaking?
    // TODO 
    // const checker = clientProgram.getTypeChecker();
    // checker.getTypeFromTypeNode();
    const emitResult2 = serverProgram.emit(undefined, (fileName, data) => {
        if (data) { files[fileName] = data; }
    });
    const transpileErrors = ts
        .getPreEmitDiagnostics(clientProgram).concat(emitResult1.diagnostics)
        .concat(ts.getPreEmitDiagnostics(clientProgram)).concat(emitResult2.diagnostics)
        .concat(ts.getPreEmitDiagnostics(clientProgram2)).concat(emitResult3.diagnostics)
        .map(diagnostic =>
    {
        if (diagnostic.file) {
            const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            return chalk`{red error} ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`;
        } else {
            return chalk`{red error} ` + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        }
    });
    for (const message of transpileErrors.filter((v, i, a) => a.indexOf(v) == i)) {
        console.log(message);
    }
    return transpileErrors.length ? null : {
        mainClient: files['/vbuild1/index.js'], 
        shareClient: files['/vbuild3/share.js'], 
        server: files['/vbuild2/index.js'],
    };
}

// directly modify parameter member as result
// return true for ok, false for not ok
async function postprocess(assets: ScriptAssets): Promise<boolean> {
    console.log('postprocessing');
    let hasError = false;

    // example.com replacement
    assets.mainClient = assets.mainClient.replaceAll('example.com', config['main-domain']);
    assets.shareClient = assets.shareClient.replaceAll('example.com', config['main-domain']);

    // TODO server side dependency version need to be validated with core module package.json dependencies (not devdependencies)
    // dependency path replacement, change to cdn
    interface ClientDependency {
        name: string,
        // available paths
        // a normal plain package is always included `https://esm.sh/{name}@{version}`
        // if path is required then source code `{name}{path}` becomes `https://esm.sh/{name}@{version}{path}`
        pathnames: string[],
    }
    const dependencies: ClientDependency[] = [
        { name: 'react', pathnames: [] },
        { name: 'react-dom', pathnames: ['/client'] },
        { name: 'dayjs', pathnames: ['/plugin/utc.js', '/plugin/timezone.js'] },
        { name: '@emotion/react', pathnames: ['/jsx-runtime'] }
    ];
    const projectConfig = JSON.parse(await fs.readFile('package.json', 'utf-8')) as {
        dependencies: Record<string, string>,
        devDependencies: Record<string, string>,
    };
    for (const dependency of dependencies) {
        const projectDependency = Object
            .entries(projectConfig.dependencies).find(d => d[0] == dependency.name)
            || Object.entries(projectConfig.devDependencies).find(d => d[0] == dependency.name);
        if (!projectDependency) {
            hasError = true;
            console.error(chalk`{red error} postprocess dependency ${dependency.name} not found in project config`);
        }
        const packageVersion = projectDependency[1].substring(1);
        assets.mainClient = assets.mainClient.replace(
            new RegExp(`from ['"]${dependency.name}['"]`), `from 'https://esm.sh/${dependency.name}@${packageVersion}'`);
        for (const pathname of dependency.pathnames) {
            assets.mainClient = assets.mainClient.replace(
                new RegExp(`from ['"]${dependency.name}${pathname}['"]`), `from 'https://esm.sh/${dependency.name}@${packageVersion}${pathname}'`);
        }
    }

    console.log(`minify`);
    async function tryminify(input: string) {
        try {
            const minifyResult = await minify(input, {
                sourceMap: false,
                module: true,
                compress: { ecma: 2022 as any },
                format: { max_line_len: 160 },
            });
            return minifyResult.code;
        } catch (err) {
            console.error(chalk`{red error} terser`, err, input);
            return null;
        }
    }
    assets.mainClient = await tryminify(assets.mainClient);
    assets.shareClient = await tryminify(assets.shareClient);
    assets.server = await tryminify(assets.server);
    if (!assets.mainClient || !assets.shareClient || !assets.server) { hasError = true; }

    return !hasError;
}

async function reportLocalBuildComplete(ok: boolean) {
    const response = await fetch(`https://${config['main-domain']}:8001/local-build-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok }),
    });
    if (response.ok) {
        console.log('POST /local-build-complete ok');
    } else {
        console.log('POST /local-build-complete not ok', response);
    }
}

async function buildAndDeploy() {

    const [ok1, ok2] = await Promise.all([
        // TODO by the way, the files inside these function can also parallel
        await generateForWebInterface(),
        await generateForDatabaseModel(),
    ]);
    if (!ok1 || !ok2) { console.log('there are error in code generation'); return await reportLocalBuildComplete(false); }
    const assets = transpile();
    if (!assets) { console.log('there are error in transpiling'); return await reportLocalBuildComplete(false); }
    const ok3 = await postprocess(assets);
    if (!ok3) { console.log('there are error in postprocessing'); return await reportLocalBuildComplete(false); }
    console.log(`complete build`);

    console.log(`uploading`);
    // ??? cannot reuse the client ???
    const sftpclient = new SFTPClient();
    await sftpclient.connect({
        host: config['main-domain'],
        username: config.ssh.user,
        privateKey: await fs.readFile(config.ssh.identity),
        passphrase: config.ssh.passphrase,
    });

    const indexhtml = await fs.readFile('src/client/index.html', 'utf-8');
    const processedIndexHTML = indexhtml.replaceAll('example.com', config['main-domain']);
    await sftpclient.put(Buffer.from(processedIndexHTML), path.join(config.webroot, 'static/yala/index.html'));

    await sftpclient.fastPut('src/client/share.html', path.join(config.webroot, 'static/yala/share.html'));
    await sftpclient.put(Buffer.from(assets.mainClient), path.join(config.webroot, 'static/yala/index.js'));
    await sftpclient.put(Buffer.from(assets.shareClient), path.join(config.webroot, 'static/yala/share.js'));
    await sftpclient.put(Buffer.from(assets.server), path.join(config.webroot, 'servers/yala.js'));
    console.log(`complete upload`);

    await reportLocalBuildComplete(true);
}

const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
function connectRemoteCommandCenter() {
    const websocket = new WebSocket(`wss://${config['main-domain']}:8001/for-build`);
    websocket.addEventListener('close', async () => {
        console.log(`websocket: disconnected`);
        await readlineInterface.question('input anything to reconnect: ');
        connectRemoteCommandCenter();
    });
    websocket.addEventListener('error', async error => {
        console.log(`websocket: error:`, error);
        await readlineInterface.question('input anything to reconnect: ');
        connectRemoteCommandCenter();
    });
    websocket.addEventListener('open', async () => {
        console.log(`websocket: connected, you'd better complete authentication quickly`);
        const token = await readlineInterface.question('> ');
        websocket.send(token);
        console.log('listening to remote request');
    });
    websocket.addEventListener('message', event => {
        console.log('websocket: received data', event.data);
        buildAndDeploy();
    });
}

connectRemoteCommandCenter();
