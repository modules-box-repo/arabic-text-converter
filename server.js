// Serves the app and reshapes Arabic text with fribidi

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const MAX_BODY = 512 * 1024;
const BIN = process.env.FRIBIDI_BIN || 'fribidi';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function runFribidi(text, options) {
  return new Promise((resolve, reject) => {
    const args = ['--nopad', '--nobreak'];
    if (options.direction === 'rtl') args.push('--rtl');
    else if (options.direction === 'ltr') args.push('--ltr');
    else args.push('--wltr');

    const child = execFile(
      BIN,
      args,
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
    child.stdin.on('error', () => {});
    child.stdin.end(text, 'utf8');
  });
}

async function handleConvert(req, res) {
  try {
    const raw = await readBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const text = typeof payload.text === 'string' ? payload.text : '';
    const direction = payload.direction === 'rtl' || payload.direction === 'ltr' ? payload.direction : 'auto';
    const output = await runFribidi(text, { direction: direction });
    send(res, 200, JSON.stringify({ output }), 'application/json; charset=utf-8');
  } catch (error) {
    const message = error.code === 'ENOENT'
      ? 'fribidi is not installed on this system'
      : error.message;
    send(res, 400, JSON.stringify({ error: message }), 'application/json; charset=utf-8');
  }
}

function handleStatus(res) {
  execFile(BIN, ['--version'], { encoding: 'utf8' }, (error, stdout) => {
    const version = error ? null : stdout.split('\n')[0].trim();
    send(res, 200, JSON.stringify({ ready: !error, engine: BIN, version }), 'application/json; charset=utf-8');
  });
}

function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    send(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      send(res, 404, 'Not found');
      return;
    }
    send(res, 200, data, MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (url.pathname === '/api/convert' && req.method === 'POST') {
    handleConvert(req, res);
    return;
  }
  if (url.pathname === '/api/status' && req.method === 'GET') {
    handleStatus(res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed');
    return;
  }
  serveStatic(url.pathname, res);
});

const DISPLAY = HOST === '127.0.0.1' || HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;

server.listen(PORT, HOST, () => {
  console.log('Arabic Text Converter running at http://' + DISPLAY + ':' + PORT);
});
