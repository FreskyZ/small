import net from 'node:net';
import readline from 'node:readline/promises';

// local file transfer: client

const client = net.createConnection({
    port: 8008,
}, () => {
    console.log('client connected');
    client.write('hello world');
    const rl = readline.createInterface(process.stdin, process.stdout);
    rl.on('line', line => {
        if (line == 'exit') {
            console.log('client disconnecting');
            rl.close();
            client.end();
        } else {
            client.write(line);
        }
    });
});
// client.on('data', data => {
//     console.log('client receive: ', data);
// });
client.on('end', () => {
    console.log('client disconnected');
});
