// Local development server: serves the static site and the /api/room function.
// Usage: node dev-server.js  → http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const room = require('./api/room');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const port = process.env.PORT || 3000;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/room') return room(req, res);
  const file = path.join(__dirname, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(__dirname) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Mafia dev server on http://localhost:${port}`));
