import fs from 'node:fs/promises';
import OSS from 'ali-oss';

// remote version have different configuration and operation

declare module 'ali-oss' {
    interface Options {
        authorizationV4: boolean,
    }
}

const config = JSON.parse(await fs.readFile('config', 'utf-8')) as {
    oss: { key: string, secret: string, endpoint: string, bucket: string, },
};
const client = new OSS({
    secure: true,
    // ATTENTION TEMP currently oss and ecs are in different region and cannot use internal
    // internal: false,
    accessKeyId: config.oss.key,
    accessKeySecret: config.oss.secret,
    authorizationV4: true,
    endpoint: config.oss.endpoint,
    // no, bucket is needed
    bucket: config.oss.bucket,
});

// upload static content
// const headers = {
//     'x-oss-storage-class': 'Standard',
//     'x-oss-object-acl': 'private',
//     // TODO check whether they are in temporary url
//     'cache-control': 'public',
//     'content-encoding': 'zstd'
// };
// const buffer = await fs.readFile('public/ocr/tesseract-core.wasm');
// const putResult = await client.put(
//     'tesseract.js/tesseract-core.wasm',
//     buffer,
//     { headers },
// );
// console.log(putResult);
