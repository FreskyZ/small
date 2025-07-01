import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk-template';
import { XMLParser } from 'fast-xml-parser';
import SFTPClient from 'ssh2-sftp-client';
import { minify } from 'terser';
import ts from 'typescript';

// this is now the app server builder base template
// - server side multiple file,
//   currently for server side I'd like to keep it single file, because merge multiple file is very complex
//   for now, the typecast parameter in createpool function is not likely to be used
//   so the actual remaining adk js code is FineError, which is very small,
//   and type definitions can be in another file and shared
// - server side auto generated api dispatch,
//   still needed, but seems no need to namespace, put 10 or 20 apis in one namespace should be ok
//   I'd consider suggesting making app servers small and no need to be separated in namespace
// - client side,
//   for now this specific app is similar to user, single file, use react, no antd,
//   I'd currently try to keep single file until some app want to user client side routing
// - generated api,
//   server side auto generated dispatch is needed, ai generate is not reliable, generate at end of server.ts
//   client side is not quite needed, generate at end of client.ts

const debug = 'AKARI_DEBUG' in process.env;
const config = JSON.parse(await fs.readFile('akaric', 'utf-8'));

console.log('code generation server side');
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
        }[field.type];
        sb += `    ${field.name}${field.nullable ? '?' : ''}: ${type},\n`
    }
    sb += `    CreateTime: string,\n`;
    sb += `}\n`;
}
await fs.writeFile('src/server/database.d.ts', sb);

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
await fs.writeFile('src/server/database.sql', sb);

console.log('code generation web interface');
const rawWebInterfaces = parser.parse(await fs.readFile('src/shared/api.xml'));
// console.log(JSON.stringify(rawActions, undefined, 2));
/**
 * @typedef {Object} WebInterfaceActionParameter
 * @property {string} name
 * @property {'id'} type for now only id
 * @property {boolean} optional
 */
/**
 * @typedef {Object} WebInterfaceAction
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
                optional: f[':@'].type.endsWith('?'),
            })),
        });
    } else {
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
            // NOTE for now not support nullable and not id type
            return { name: r, type: 'id', optional: false };
        });
        actions.push({ name, public: $public, method, path, body, return: $return, parameters });
    }
});
// console.log(JSON.stringify(actionTypes, undefined, 2), actions);

sb = '';
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
await fs.writeFile('src/shared/api.d.ts', sb);

sb = await fs.readFile('src/server/index.ts', 'utf-8');
sb = sb.substring(sb.indexOf('// AUTOGEN'));
sb += '// AUTOGEN\n';
sb += '// --------------------------------------\n';
sb += '// ------ ATTENTION AUTO GENERATED ------\n';
sb += '// --------------------------------------\n';
sb += 'export async function dispatch(ctx: DispatchContext): Promise<DispatchResult> {\n';
sb += `    const ax: ActionContext = { userId: ctx.state.user.id, userName: ctx.state.user.name };\n`;
sb += `    try {\n`;
sb += `        const key = \`\${ctx.method} \${ctx.state.public ? '/public' : ''}\${ctx.path}\`;\n`;
sb += `        let match: RegExpExecArray;\n`;
for (const action of actions) {
    // TODO use query for parameters
}

process.exit(0);

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
    outDir: '/vbuild',
}
const clientProgram = ts.createProgram(['src/client.tsx'], {
    ...sharedConfig,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    jsx: ts.JsxEmit.ReactJSX,
});
const serverProgram = ts.createProgram(['src/server.ts'], {
    ...sharedConfig,
    // TODO disable for now
    noUnusedLocals: false,
    noUnusedParameters: false,
});

let hasError = false;
/** @type {Record<string, string>} */
const emittedFiles = {};
const emitResult1 = clientProgram.emit(undefined, (fileName, data) => {
    if (data) { emittedFiles[fileName] = data; }
});
const checker = clientProgram.getTypeChecker();
// TODO 
checker.getTypeFromTypeNode();
const emitResult2 = serverProgram.emit(undefined, (fileName, data) => {
    if (data) { emittedFiles[fileName] = data; }
});
const transpileErrors = ts
    .getPreEmitDiagnostics(clientProgram).concat(emitResult1.diagnostics)
    .concat(ts.getPreEmitDiagnostics(clientProgram)).concat(emitResult2.diagnostics)
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
    hasError = true;
    console.log(message);
}
if (hasError) {
    console.log('there are errors in transpiling');
    process.exit(1);
}

console.log('postprocessing');
let clientJs = emittedFiles['/vbuild/client.js'];
clientJs = clientJs.replaceAll('example.com', config['main-domain']);
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
for (const [devModule, runtimeModule] of Object.entries(dependencies)) {
    clientJs = clientJs.replace(new RegExp(`from ['"]${devModule}['"]`), `from '${runtimeModule}'`);
}

let minifyResult1;
let minifyResult2;
console.log(`minify`);
try {
    minifyResult1 = await minify(clientJs, {
        sourceMap: false,
        module: true,
        compress: { ecma: 2022 },
        format: { max_line_len: 160 },
    });
} catch (err) {
    console.error(chalk`{red error} terser`, err, clientJs);
    process.exit(1);
}
try {
    minifyResult2 = await minify(emittedFiles['/vbuild/server.js'], {
        sourceMap: false,
        module: true,
        compress: { ecma: 2022 },
        format: { max_line_len: 160 },
    });
} catch (err) {
    console.error(chalk`{red error} terser`, err, emittedFiles['/vbuild/server.js']);
    process.exit(1);
}

console.log(`uploading`);
const client = new SFTPClient();
await client.connect({
    host: config['main-domain'],
    username: config.ssh.user,
    privateKey: await fs.readFile(config.ssh.identity),
    passphrase: config.ssh.passphrase,
});

await client.fastPut('index.html', path.join(config.webroot, 'static/chat/index.html'));
await client.fastPut('share.html', path.join(config.webroot, 'static/chat/share.html'));
await client.put(Buffer.from(minifyResult1.code), path.join(config.webroot, 'static/chat/index.js'));
await client.put(Buffer.from(minifyResult2.code), path.join(config.webroot, 'servers/chat.js'));
client.end();
console.log(`complete build chat page`);
