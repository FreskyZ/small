import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import OSS from 'ali-oss';

// environment variables:
// - ALIYUN_ACCESS_KEY: access key
// - ALIYUN_ACCESS_KEY_SECRET: access key secret
// - ALIYUN_OSS_REGION: region
// - ALIYUN_OSS_BUCKET: bucket
// - AOS_TARGET_DIR: local path to put the files, this path is required to exist, objects' path will create automatically

// access key information see https://ram.console.aliyun.com/
// bucket information see https://oss.console.aliyun.com/, if you forget

const bucketName = process.env['ALIYUN_OSS_BUCKET'];
const localDirectory = process.env['AOS_TARGET_DIR'];
const client = OSS({
    accessKeyId: process.env['ALIYUN_ACCESS_KEY'],
    accessKeySecret: process.env['ALIYUN_ACCESS_KEY_SECRET'],
    region: process.env['ALIYUN_OSS_REGION'],
    bucket: bucketName,
    secure: true,
    internal: true,
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
if (process.argv[2] == 'upload') {
    if (process.argv.length != 5) {
        console.log('aos: usage: node manage.mjs upload localfile.mp3 remote/path/filename.mp3');
        process.exit(2);
    }
    await fs.access(process.argv[3]);
    const result = await client.put(process.argv[4], process.argv[3], {
        'x-oss-storage-class': 'Standard',
        'x-oss-object-acl': 'default',
        'Content-Disposition': `attachment; filename="${path.basename(process.argv[4])}"`,
        // may provide a argument for this
        // 'x-oss-forbid-overwrite': 'true',
    });
    console.log(`aos: upload ${process.argv[3]} => ${process.argv[4]}`);
    console.log(result);
} else if (process.argv[2] == 'delete') {
    if (process.argv.length != 4) {
        console.log('aos: usage: node manage.mjs upload remote/path/filename.mp3');
        process.exit(2);
    }
    const answer = await rl.question('aos: delete file cannot recover, are you sure to continue? (y|n): ');
    if (answer != 'y' && answer != 'Y') {
        process.exit(2);
    } else {
        const result = await client.delete(process.argv[3]);
        console.log(`aos: delete ${process.argv[3]}`);
        console.log(result);
        process.exit(0);
    }
} else if (process.argv[2] == 'sync') {
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
    const objectsFile = await fs.open(path.join(localDirectory, 'objects.json'), 'a+');
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
            await fs.mkdir(path.join(localDirectory, dir), { recursive: true });
        }
        await Promise.all(newObjects.map(async o => {
            // encodeURI: this is fine (github.com/freskyz/fine) file handling bug to forget decode uri,
            // but it's a lot harder to reestablish that develop environment for that for now, so put it here
            const localPath = path.join(localDirectory, encodeURI(o.name));
            await client.get(o.name, localPath);
            console.log(`aos: downloaded ${o.name} => ${localPath} ${o.size/1000} kb`);
        }));
    }
    await objectsFile.truncate();
    await objectsFile.write(JSON.stringify(objects));
    await objectsFile.close();
    console.log(`aos: total ${objects.length} files, downloaded ${newObjects.length} files`);
    process.exit(0);
} else if (process.argv[2] == 'open') {
    const answer = await rl.question('aos: will open public access, are you sure to continue? (y|n): ');
    if (answer != 'y' && answer != 'Y') {
        process.exit(2);
    } else {
        await client.putBucketACL(bucketName, 'public-read');
        console.log('aos: open bucket');
        process.exit(0);
    }
} else if (process.argv[2] == 'close') {
    const answer = await rl.question('aos: will close public access, are you sure to continue? (y|n): ');
    if (answer != 'y' && answer != 'Y') {
        process.exit(2);
    } else {
        await client.putBucketACL(bucketName, 'private');
        console.log('aos: closed bucket');
        process.exit(0);
    }
} else {
    console.log('aos: unknown command, expect upload, delete, sync, open, close');
    process.exit(1);
}