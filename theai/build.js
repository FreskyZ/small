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

async function generateForDatabaseModel() {
    console.log('code generation database model');

    const parser = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: true,
    });
    const rawDatabaseModel = parser.parse(await fs.readFile('src/server/database.xml'));
    /**
     * @typedef {Object} DatabaseModelField
     * @property {string} name
     * @property {'id' | 'int' | 'string' | 'datetime' | 'guid' | 'text'} type
     * @property {boolean} nullable
     * @property {number} size string length
     */
    /**
     * @typedef {Object} DatabaseModelForeignKey
     * @property {string} table foreign table
     * @property {string} field
     */
    /**
     * @typedef {Object} DatabaseModelTable
     * @property {string} name
     * @property {string} primaryKey pk is required
     * @property {DatabaseModelForeignKey[]} foreignKeys
     * @property {DatabaseModelField[]} fields
     */
    const databaseName = rawDatabaseModel[1][':@'].name;
    /** @type {DatabaseModelTable[]} */
    const databaseModel = rawDatabaseModel[1].database.map(c => ({
        name: c[':@'].name,
        primaryKey: c.table.find(f => 'primary-key' in f)[':@'].field,
        foreignKeys: c.table.filter(f => 'foreign-key' in f).map(f => f[':@']),
        fields: c.table.filter(f => 'field' in f).map(f => ({
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
    for (const table of databaseModel) {
        sb += `export interface ${table.name} {\n`;
        for (const field of table.fields) {
            const type = {
                'id': 'number',
                'int': 'number',
                'datetime': 'string',
                'guid': 'string',
                'text': 'string',
                'string': 'string',
                'bool': 'boolean',
            }[field.type];
            sb += `    ${field.name}${field.nullable ? '?' : ''}: ${type},\n`
        }
        sb += `    CreateTime: string,\n`;
        sb += `}\n`;
    }
    if (!nocodegen) {
        console.log('write src/server/database.d.ts');
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
            const autoIncrement = table.primaryKey == field.name && field.type == 'id' ? ' AUTO_INCREMENT' : '';
            const newGuid = table.primaryKey == field.name && field.type == 'guid' ? ' DEFAULT (UUID())' : '';
            sb += `    \`${field.name}\` ${type} ${field.nullable ? 'NULL' : 'NOT NULL'}${autoIncrement}${newGuid},\n`;
        }
        sb += '    `CreateTime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n';
        sb += `    CONSTRAINT \`PK_${table.name}\` PRIMARY KEY (\`${table.primaryKey}\`),\n`;
        for (const fk of table.foreignKeys) {
            const foreignTable = databaseModel.find(t => t.name == fk.table);
            sb += `    CONSTRAINT \`FK_${table.name}_${fk.table}\``;
            sb += ` FOREIGN KEY (\`${fk.field}\`) REFERENCES \`${fk.table}\`(\`${foreignTable.primaryKey}\`),\n`;
        }
        sb = sb.substring(0, sb.length - 2) + '\n';
        sb += `);\n`;
    }
    if (!nocodegen) {
        console.log('write src/server/database.sql');
        await fs.writeFile('src/server/database.sql', sb);
    }
}

async function generateForWebInterface() {
    console.log('code generation web interface');
    
    const parser = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: true,
    });
    const rawWebInterfaces = parser.parse(await fs.readFile('src/shared/api.xml'));
    // console.log(JSON.stringify(rawActions, undefined, 2));
    /**
     * @typedef {Object} WebInterfaceActionParameter
     * @property {string} name
     * @property {'id' | 'guid'} type for now only id and guid
     * @property {boolean} optional
     */
    /**
     * @typedef {Object} WebInterfaceAction
     * @property {string} key finally you need something to group actions..., for now =main is main, =share is for share
     * @property {string} name
     * @property {boolean} public
     * @property {string} method method is calculated when read config, because both side need it
     * @property {string} path path is calculated when read config, because both side need it
     * @property {WebInterfaceActionParameter[]} parameters
     * @property {string?} body body type name
     * @property {string?} return return type name
     */
    /**
     * @typedef {Object} WebInterfaceActionField
     * @property {string} name
     * @property {'id' | 'int' | 'string' | 'datetime' | string} type
     * @property {boolean} nullable
     */
    /**
     * @typedef {Object} WebInterfaceActionType
     * @property {string} name
     * @property {WebInterfaceActionField[]} fields
     */
    /** @type {WebInterfaceAction[]} */
    const actions = [];
    /** @type {WebInterfaceActionType[]} */
    const actionTypes = [];
    rawWebInterfaces[1].api.forEach(c => {
        if ('type' in c) {
            actionTypes.push({
                name: c[':@'].name,
                fields: c.type.map(f => ({
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
        console.log('write src/shared/api.d.ts');
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
    // public idopt(name: string) { return this.validate(name, true, parseInt, v => !isNaN(v) && v > 0); }
    public string(name: string) { return this.validate(name, false, v => v, v => !!v); }
}\n`;

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
        console.log('write partial src/server/index.ts');
        await fs.writeFile('src/server/index.ts', sb);
    }

    sb = await fs.readFile('src/client/index.tsx', 'utf-8');
    sb = sb.substring(0, sb.indexOf('// AUTOGEN'));
    sb += '// AUTOGEN\n';
    sb += '// --------------------------------------\n';
    sb += '// ------ ATTENTION AUTO GENERATED ------\n';
    sb += '// --------------------------------------\n';
    sb += '\n'

    sb += `async function sendRequest(method: string, path: string, parameters?: any, data?: any): Promise<any> {
    const url = new URL(\`https://api.example.com/chat\${path}\`);
    Object.entries(parameters || {}).forEach(p => url.searchParams.append(p[0], p[1].toString()));
    const response = await fetch(url.toString(), data ? {
        method,
        body: JSON.stringify(data),
        headers: { 'authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' },
    } : { method, headers: { 'authorization': 'Bearer ' + accessToken } });

    // normal/error both return json body, but void do not
    const hasResponseBody = response.headers.has('content-Type')
        && response.headers.get('content-Type').includes('application/json');
    const responseData = hasResponseBody ? await response.json() : {};
    return response.ok ? Promise.resolve(responseData)
        : response.status >= 400 && response.status < 500 ? Promise.reject(responseData)
        : response.status >= 500 ? Promise.reject({ message: 'internal error' })
        : Promise.reject({ message: 'unknown error' });
}\n`;
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
        console.log('write partial src/client/index.tsx');
        await fs.writeFile('src/client/index.tsx', sb);
    }
}
/**
 * @returns {Record<string, string>} transpile result files
 */
function transpile() {
    console.log('transpiling');
    /** @type {ts.CompilerOptions} */
    const sharedConfig = {
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

    const /** @type {Record<string, string>} */ files = {};
    const emitResult1 = clientProgram.emit(undefined, (fileName, data) => {
        if (data) { files[fileName] = data; }
    });
    const emitResult3 = clientProgram2.emit(undefined, (fileName, data) => {
        if (data) { files[fileName] = data; }
    });
    // TODO what's the following todo todoing, I can get type information from ast type node, then?
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
    return transpileErrors.length ? null : files;
}

/**
 * @param {string} clientJs
 * @param {string} clientJs2
 * @param {string} serverJs
 * @return {Promise<[string, string, string]>} processed [clientJs, clientJs2, serverJs]
 */
async function postprocess(clientJs, clientJs2, serverJs) {
    console.log('postprocessing');

    const dependencies = {
        'react': 'https://esm.sh/react@19.1.0',
        'react-dom': 'https://esm.sh/react-dom@19.1.0',
        'react-dom/client': 'https://esm.sh/react-dom@19.1.0/client',
        'dayjs': 'https://esm.sh/dayjs@1.11.13',
        'dayjs/plugin/utc.js': 'https://esm.sh/dayjs@1.11.13/plugin/utc.js',
        'dayjs/plugin/timezone.js': 'https://esm.sh/dayjs@1.11.13/plugin/timezone.js',
        '@emotion/react': 'https://esm.sh/@emotion/react@11.14.0',
        '@emotion/react/jsx-runtime': 'https://esm.sh/@emotion/react@11.14.0/jsx-runtime',
    }
    clientJs = clientJs.replaceAll('example.com', config['main-domain']);
    for (const [devModule, runtimeModule] of Object.entries(dependencies)) {
        clientJs = clientJs.replace(new RegExp(`from ['"]${devModule}['"]`), `from '${runtimeModule}'`);
    }
    clientJs2 = clientJs2.replaceAll('example.com', config['main-domain']);
    for (const [devModule, runtimeModule] of Object.entries(dependencies)) {
        clientJs2 = clientJs2.replace(new RegExp(`from ['"]${devModule}['"]`), `from '${runtimeModule}'`);
    }

    let resultClientJs;
    let resultClientJs2;
    let resultServerJs;
    console.log(`minify`);
    try {
        const minifyResult = await minify(clientJs, {
            sourceMap: false,
            module: true,
            compress: { ecma: 2022 },
            format: { max_line_len: 160 },
        });
        resultClientJs = minifyResult.code;
    } catch (err) {
        console.error(chalk`{red error} terser`, err, clientJs);
    }
    try {
        const minifyResult = await minify(clientJs2, {
            sourceMap: false,
            module: true,
            compress: { ecma: 2022 },
            format: { max_line_len: 160 },
        });
        resultClientJs2 = minifyResult.code;
    } catch (err) {
        console.error(chalk`{red error} terser`, err, clientJs2);
    }

    try {
        const minifyResult = await minify(serverJs, {
            module: true,
            compress: { ecma: 2022 },
            format: { max_line_len: 160 },
        });
        resultServerJs = minifyResult.code;
    } catch (err) {
        console.error(chalk`{red error} terser`, err, serverJs);
    }
    return [resultClientJs, resultClientJs2, resultServerJs];
}

async function reportLocalBuildComplete(ok) {
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

    await Promise.all([
        // TODO by the way, the files inside these function can also parallel
        await generateForWebInterface(),
        await generateForDatabaseModel(),
    ]);
    const transpileResult = transpile();
    if (!transpileResult) { console.log('there are error in transpiling'); return await reportLocalBuildComplete(false); }
    const [resultClientJs, resultClientJs2, resultServerJs] = await postprocess(
        transpileResult['/vbuild1/index.js'], transpileResult['/vbuild3/share.js'], transpileResult['/vbuild2/index.js']);
    if (!resultClientJs || !resultClientJs2 || !resultServerJs) { console.log('there are error in postprocessing'); return await reportLocalBuildComplete(false); }
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
    await sftpclient.fastPut('src/client/index.html', path.join(config.webroot, 'static/chat/index.html'));
    await sftpclient.fastPut('src/client/share.html', path.join(config.webroot, 'static/chat/share.html'));
    await sftpclient.put(Buffer.from(resultClientJs), path.join(config.webroot, 'static/chat/index.js'));
    await sftpclient.put(Buffer.from(resultClientJs2), path.join(config.webroot, 'static/chat/share.js'));
    await sftpclient.put(Buffer.from(resultServerJs), path.join(config.webroot, 'servers/chat.js'));
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

