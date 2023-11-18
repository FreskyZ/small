import fs from 'node:fs/promises';
import path from 'node:path';
import OSS from 'ali-oss';

// environment variables:
// - the following 4 in initialize oss
// - AOS_TARGET_DIR: local path to put the files, this path is required to exist, objects' path will create automatically

const client = OSS({
    accessKeyId: process.env['ALIYUN_ACCESS_KEY'],
    accessKeySecret: process.env['ALIYUN_ACCESS_KEY_SECRET'],
    region: process.env['ALIYUN_OSS_REGION'],
    bucket: process.env['ALIYUN_OSS_BUCKET'],
    secure: true,
    internal: true,
});

async function getAllObjects() {
    let result = await client.list();
    const objects = result.objects;
    while (result.isTruncated) {
        result = await client.list({ marker: result.lastMarker });
        objects.push(...result.objects);
    }
    // only include interested properties
    return objects.map(o => ({
        name: o.name,
        size: o.size,
        etag: o.etag,
        url: o.url,
    }));
}

// a+: Open file for reading and appending. The file is created if it does not exist.
const objectsFile = await fs.open(path.join(process.env['AOS_TARGET_DIR'], 'objects.json'), 'a+');
const objectsFileContent = await objectsFile.readFile('utf-8');
const existingObjects = JSON.parse(objectsFileContent || '[]');

const objects = await getAllObjects();
const newObjects = objects.filter(o => !existingObjects.some(
    e => e.name == o.name && e.size == o.size && e.etag == o.etag && e.url == o.url));
if (newObjects.length > 0) {
    console.log(`aos: downloading ${newObjects.length} files`);
    for (const dir of newObjects.map(o => path.dirname(o.name)).filter((v, i, a) => a.indexOf(v) == i)) {
        // recursive does not throw when dir already exists
        // this should not be promise.all because there may still be race condition like both '/foo' and '/foo/bar' exists
        await fs.mkdir(path.join(process.env['AOS_TARGET_DIR'], dir), { recursive: true });
    }
    await Promise.all(newObjects.map(async o => {
        const localPath = path.join(process.env['AOS_TARGET_DIR'], o.name);
        await client.get(o.name, localPath);
        console.log(`aos: downloaded ${o.name} => ${localPath} ${o.size/1000} kb`);
    }));
}
await objectsFile.truncate();
await objectsFile.write(JSON.stringify(objects));
await objectsFile.close();
console.log(`aos: total ${objects.length} files, downloaded ${newObjects.length} files`);
