import fs from 'node:fs';
import net from 'node:net';

// local file transfer: server

// related network configurations
// 1. redirect wsl port to windows port
//   from https://stackoverflow.com/questions/61002681/connecting-to-wsl2-server-via-local-network
//   this need admin terminal
//   $ netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8002 connectaddress=localhost connectport=8001
//   see more at https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2008-r2-and-2008/cc731068(v=ws.10)
//   ? this link looks very ancient, the document structure is
//   Network Shell (netsh) -> Netsh Technical Reference -> Netsh Command Reference -> Netsh Command for Interface -> for Interface Portproxy
// 2. open port in windows network configuration
//   $ netsh advfirewall firewall add rule name="Allow TCP in by 8002" dir=in action=allow protocol=TCP localport=8002
//   update: netsh firewall series really have powershell replacement
//   $ get-netfirewallrule -displayname "Allow TCP in by 8002"
//   $ get-netfirewallrule -displayname "Allow TCP in by 8002" | get-netfirewallportfilter
//   now you can disable firewall rule with modern command
//   $ New-NetFirewallRule -DisplayName "my/small/lft/server" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8002
//   $ disable-netfirewallrule -displayname "my/small/lft/server"

const server = net.createServer({

}, connection => {
    console.log('server connected');
    connection.on('end', () => {
        console.log('server disconnected');
    });
    // connection.on('data', data => {
    //     console.log('server receive: ', data);
    // });
    const file = fs.createWriteStream('1.mp4');
    connection.pipe(file);
    connection.on('close', () => {
        file.close();
    })
});
server.on('error', err => {
    console.log('server error', err);
    process.exit(1);
});
server.listen(8001, () => {
    console.log('server bind');
});
process.on('SIGINT', () => {
    console.log('server closing');
    server.close();
});
