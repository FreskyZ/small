import net from 'node:net';

// local file transfer: server

const server = net.createServer({

}, connection => {
    console.log('server connected');
    connection.on('end', () => {
        console.log('server disconnected');
    });
    connection.on('data', data => {
        console.log('server receive: ', data);
    });
});
server.on('error', err => {
    console.log('server error', err);
    process.exit(1);
});
server.listen(8008, () => {
    console.log('server bind');
});
process.on('SIGINT', () => {
    console.log('server closing');
    server.close();
});
