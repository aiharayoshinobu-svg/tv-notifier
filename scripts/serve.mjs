import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../docs/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  let path;
  try { path = resolve(root, `.${decodeURIComponent(pathname.endsWith('/') ? `${pathname}index.html` : pathname)}`); }
  catch { response.writeHead(400).end(); return; }
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
  try { const body = await readFile(path); response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body); }
  catch { response.writeHead(404).end('Not found'); }
}).listen(4173, '0.0.0.0', () => console.log('PWA shell is available on port 4173'));
