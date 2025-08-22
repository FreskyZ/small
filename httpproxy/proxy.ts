import * as http from 'node:http';
import * as url from 'node:url';
import * as net from 'node:net';

// Configure whitelist domains
const WHITELIST_DOMAINS = [
    'example.com',
    'api.github.com',
    // Add more domains as needed
];

// Helper function to check if the domain is whitelisted
function isDomainWhitelisted(domain: string): boolean {
    return WHITELIST_DOMAINS.some(whitelistedDomain => 
        domain === whitelistedDomain || domain.endsWith(`.${whitelistedDomain}`)
    );
}

// Create HTTP proxy server
const httpProxy = http.createServer((req, res) => {
    // Parse the URL from the request
    const parsedUrl = url.parse(req.url || '');
    const targetDomain = parsedUrl.hostname || '';

    // Check if the domain is whitelisted
    if (!isDomainWhitelisted(targetDomain)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Access to this domain is not allowed');
        console.log(`Blocked request to non-whitelisted domain: ${targetDomain}`);
        return;
    }

    // Forward the request
    const options: http.RequestOptions = {
        hostname: targetDomain,
        port: parsedUrl.port || 80,
        path: parsedUrl.path || '/',
        method: req.method,
        headers: req.headers
    };

    // Create a proxy request
    const proxyReq = http.request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
    });

    // Handle errors
    proxyReq.on('error', (err) => {
        console.error(`Error proxying request: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Proxy error');
    });

    // Pipe the original request body to the proxy request
    req.pipe(proxyReq);
});

// Handle HTTPS CONNECT method
httpProxy.on('connect', (req, clientSocket, head) => {
    const parsedUrl = url.parse(`https://${req.url}`);
    const targetDomain = parsedUrl.hostname || '';
    const targetPort = parseInt(parsedUrl.port || '443', 10);

    // Check if the domain is whitelisted
    if (!isDomainWhitelisted(targetDomain)) {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        clientSocket.end();
        console.log(`Blocked HTTPS request to non-whitelisted domain: ${targetDomain}`);
        return;
    }

    // Create a connection to the target server
    const serverSocket = net.connect(targetPort, targetDomain, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
        console.error(`HTTPS proxy error: ${err.message}`);
        clientSocket.write('HTTP/1.1 500 Connection Error\r\n\r\n');
        clientSocket.end();
    });

    clientSocket.on('error', (err) => {
        console.error(`Client socket error: ${err.message}`);
        serverSocket.end();
    });
});

// Start the proxy server
const PORT = process.env.PORT || 8080;
httpProxy.listen(PORT, () => {
    console.log(`Proxy server listening on port ${PORT}`);
    console.log(`Whitelisted domains: ${WHITELIST_DOMAINS.join(', ')}`);
});