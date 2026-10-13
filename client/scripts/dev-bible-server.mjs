// Serves ../../public (the static chapter JSON) with CORS, for `expo start --web` without the Rust API.
// Usage: node scripts/dev-bible-server.mjs [port=8787]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../public')
const port = Number(process.argv[2] ?? 8787)
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path.startsWith('/api/')) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"no API in the static dev server"}') }
  const file = join(root, path)
  try {
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error('nope')
    res.writeHead(200, { 'Content-Type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' })
    res.end(await readFile(file))
  } catch { res.writeHead(404); res.end('not found') }
}).listen(port, () => console.log(`bible static server on http://localhost:${port} (root ${root})`))
