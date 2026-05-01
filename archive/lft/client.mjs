import fs from 'node:fs';
import net from 'node:net';
// import readline from 'node:readline/promises';

// local file transfer: client

const client = net.createConnection({
    port: 8002,
    host: '192.168.31.30',
}, () => {
    console.log('client connected');
    
    const file = fs.createReadStream('1.mp4');
    file.on('end', () => {
        console.log('file stream end');
        client.end();
    });
    file.pipe(client);
    file.on('finish', () => {
        console.log('send complete');
        client.close();
    });

    // client.write('hello world');
    // const rl = readline.createInterface(process.stdin, process.stdout);
    // rl.on('line', line => {
    //     if (line == 'exit') {
    //         console.log('client disconnecting');
    //         rl.close();
    //         client.end();
    //     } else {
    //         client.write(line);
    //     }
    // });
});
client.on('error', err => {
    console.log('client error', err);
    process.exit(1);
});
// client.on('data', data => {
//     console.log('client receive: ', data);
// });
client.on('end', () => {
    console.log('client disconnected');
});
