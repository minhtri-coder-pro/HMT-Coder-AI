// JavaScript, server.cjs, Electron/Node.js main-process runtime; target: HMT Code AI local API bridge.
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, normalize } = require('node:path');

const port = Number(process.env.PORT || 3000);
const root = join(__dirname, 'public');
const apiBaseUrl = (process.env.XKIRO_BASE_URL || 'https://api.xkiro.com/v1').replace(/\/$/, '');
// Local builds read the ignored xkiro-secret.local.cjs file; GitHub Actions creates it from a repository secret.
let builtInApiKey = '';
try { builtInApiKey = require('./xkiro-secret.local.cjs').apiKey || ''; } catch { }
let userApiKey = '';
let apiKey = process.env.XKIRO_API_KEY || builtInApiKey.trim() || undefined;
function setApiKey(value) {
  userApiKey = typeof value === 'string' ? value.trim() : '';
  apiKey = userApiKey || process.env.XKIRO_API_KEY || builtInApiKey.trim() || undefined;
}

function startServer(listenPort = port) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (req.url === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ configured: Boolean(apiKey) })); return;
    }
    if (req.url === '/api/models' && req.method === 'GET') {
      try {
        const upstream = await fetch(`${apiBaseUrl}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        res.end(await upstream.text());
      } catch { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"Could not reach xKiro"}'); }
      return;
    }
    if (req.url === '/api/chat' && req.method === 'POST') {
      if (!apiKey) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"No xKiro API key is configured. Open Settings and save your API key."}'); return; }
      const chunks = []; let bodyBytes = 0;
      for await (const chunk of req) { bodyBytes += chunk.length; if (bodyBytes > 30 * 1024 * 1024) { res.writeHead(413); res.end(JSON.stringify({ error: 'Request exceeds 30 MB.' })); return; } chunks.push(chunk); }
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 100 || typeof input.model !== 'string' || input.model.length > 160) throw new Error('Provide a model and 1–100 messages.');
        const validContent = content => {
          if (typeof content === 'string') return content.length <= 2_000_000;
          if (!Array.isArray(content) || content.length > 12) return false;
          return content.every(part => {
            if (part?.type === 'text') return typeof part.text === 'string' && part.text.length <= 2_000_000;
            if (part?.type === 'image_url') return typeof part.image_url?.url === 'string' && part.image_url.url.length <= 12 * 1024 * 1024 && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(part.image_url.url);
            return false;
          });
        };
        if (input.messages.some(message => !message || !['system', 'user', 'assistant'].includes(message.role) || !validContent(message.content))) throw new Error('Message text or image attachment is invalid or too large.');
        const upstream = await fetch(`${apiBaseUrl}/chat/completions`, {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: input.model, messages: input.messages, temperature: 0.3 })
        });
        const upstreamBody = await upstream.text();
        if (!upstreamBody.trim()) {
          res.writeHead(upstream.ok ? 502 : upstream.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `xKiro returned an empty response (HTTP ${upstream.status}). Try another model or retry shortly.` }));
          return;
        }
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' }); res.end(upstreamBody);
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message || 'Invalid request' }));
      }
      return;
    }
    const requested = req.url === '/' ? '/index.html' : decodeURIComponent((req.url || '/').split('?')[0]);
    const safePath = normalize(join(root, requested));
    if (!safePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/vnd.microsoft.icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
    try { const data = await readFile(safePath); res.writeHead(200, { 'Content-Type': mime[extname(safePath)] || 'application/octet-stream' }); res.end(data); }
    catch { res.writeHead(404); res.end('Not found'); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startServer, setApiKey };
if (require.main === module) startServer().then(() => console.log(`HMT Code AI running at http://127.0.0.1:${port}`));
