import fs from 'node:fs/promises';
import OSS from 'ali-oss';

declare module 'ali-oss' {
    interface Options {
        authorizationV4: boolean,
    }
}

// access key is on https://ram.console.aliyun.com and grant access previledge
// buckets are on https://oss.console.aliyun.com
// rest api reference https://help.aliyun.com/zh/oss/developer-reference/listbuckets, missing sdk api reference

const client = new OSS({
    secure: true,
    internal: false, // NOTE this should be true if run on ecs
    accessKeyId: process.env['ALIYUN_ACCESS_KEY'],
    accessKeySecret: process.env['ALIYUN_ACCESS_KEY_SECRET'],
    authorizationV4: true,
    region: process.env['ALIYUN_OSS_REGION'],
    bucket: process.env['ALIYUN_OSS_BUCKET'],
});

// helloworld
// action name 'oss:ListBuckets'
// console.log(await client.listBuckets({}));

// upload config.json
// const headers = {
//     'x-oss-storage-class': 'Standard',
//     'x-oss-object-acl': 'private', // 'public-read'
//     // for url download, not suitable for config.json
//     // 'cache-control': 'public',
//     // 'content-disposition': 'attachment; filename="filename.wasm"',
//     // 'content-encoding': 'br',
//     // other may be used keys
//     // 'x-oss-meta-{metakey}': '{metavalue}',
// };
// // action name 'oss:PutObject'
// // second parameter missing type, source code says Buffer for buffer, string for filename, ReadableStream for stream
// const putResult = await client.put('config.json', Buffer.from(JSON.stringify({
//     'static-content': {
//         'example.com': {
//             'ocr/tesseract-core.wasm': 'tesseract.js/tesseract-core.wasm',
//         },
//     },
// })), { headers });
// putResult.res.status == 200
// console.log(putResult);

// download config.json
// also support headers:
// - range: content-range
// there will be no local cache control implemented so not use these
// - if-modified-since
// - if-unmodified-since
// - if-match
// - if-none-match
// - accept-encoding
// action name 'oss:GetObject'
// const getResult = await client.get('config.json');
// console.log(getResult);
// if (getResult.content) {
//     console.log(getResult.content.toString('utf-8'));
// }

// get download url
// ai cannot fix this declaration, so this is currently not fixable in declare module
// const result = await client['signatureUrlV4']('GET', 3600, { headers: {} }, 'tesseract.js/tesseract-core.wasm');
// console.log(result);

const response = await fetch('%2F20250802%2Fcn-hangzhou%2Foss%2Faliyun_v4_request&x-oss-date=20250802T050919Z&x-oss-expires=3600&x-oss-signature-version=OSS4-HMAC-SHA256&x-oss-signature=');
const body = await response.arrayBuffer();
fs.writeFile('temp.wasm', Buffer.from(body));
