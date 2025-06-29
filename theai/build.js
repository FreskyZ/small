import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk-template';
import SFTPClient from 'ssh2-sftp-client';
import { minify } from 'terser';
import ts from 'typescript';

const debug = 'AKARI_DEBUG' in process.env;
const config = JSON.parse(await fs.readFile('akaric', 'utf-8'));

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
const clientProgram = ts.createProgram(['client.tsx'], {
    ...sharedConfig,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    jsx: ts.JsxEmit.ReactJSX,
});
const serverProgram = ts.createProgram(['server.ts'], {
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
        return chalk`{red error}: ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`;
    } else {
        return chalk`{red error}: ` + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
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
