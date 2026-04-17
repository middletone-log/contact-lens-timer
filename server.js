const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

http.createServer((req, res) => {
    const file = path.join(dir, req.url === '/' ? 'index.html' : req.url);
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' });
        res.end(data);
    });
}).listen(8080, () => console.log('Server running at http://localhost:8080'));
