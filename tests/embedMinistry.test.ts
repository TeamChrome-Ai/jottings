import { describe, it, expect } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HAS_CONVERTERS } from './_texts'

const ROOT = path.resolve(__dirname, '..')
/** The tool needs numpy; a machine without it skips this file, as one without the texts skips theirs. */
const HAS_NUMPY = spawnSync('python3', ['-c', 'import numpy']).status === 0

/** ministry.db as the tool reads it, with `n` paragraphs of one enabled author, every text its own. */
function library(db: string, n: number) {
  execFileSync('python3', ['-c', `import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.executescript("CREATE TABLE authors (id TEXT, enabled INTEGER); CREATE TABLE paras (id INTEGER PRIMARY KEY, author TEXT, text TEXT); INSERT INTO authors VALUES ('darby', 1);")
c.executemany("INSERT INTO paras VALUES (?, 'darby', ?)", [(i, f"Paragraph {i} of the library.") for i in range(1, int(sys.argv[2]) + 1)])
c.commit()`, db, String(n)])
}

describe.skipIf(!HAS_NUMPY || !HAS_CONVERTERS)('tools/embed_ministry.py', () => {
  it('tries again after an answer cut short or not JSON, and writes the file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'embed-ministry-'))
    library(path.join(dir, 'ministry.db'), 450)
    let calls = 0
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        calls++
        if (calls === 1) {
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100000' })
          res.write('{"data": [{"index": 0, "embedding": "AAAA')
          res.socket?.destroy()
          return
        }
        if (calls === 2) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>502 Bad Gateway</html>'); return }
        const input: string[] = JSON.parse(body).input
        const vector = Buffer.from(new Float32Array(8).fill(0.5).buffer).toString('base64')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: vector })), usage: { total_tokens: input.length * 6 } }))
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const out = path.join(dir, 'ministry_vec.bin')
    const tool = spawn('python3', [path.join(ROOT, 'tools/embed_ministry.py'), '--db', path.join(dir, 'ministry.db'), '--cache', path.join(dir, 'cache'), '--out', out,
      '--url', `http://127.0.0.1:${(server.address() as AddressInfo).port}`], { env: { ...process.env, BEREAN_EMBED_KEY: 'test-key' } })
    let said = ''
    tool.stdout.on('data', c => { said += c })
    tool.stderr.on('data', c => { said += c })
    const code = await new Promise<number | string>(r => {
      const late = setTimeout(() => { tool.kill(); r('still running after 20 s') }, 20_000)
      tool.on('close', c => { clearTimeout(late); r(c ?? 'killed') })
    })
    server.close()
    expect({ code, calls }, said).toEqual({ code: 0, calls: 4 })
    expect(said).toContain('embedded 450 paragraphs (450 texts) in 2 requests: 2,700 tokens, $0.000054')
    expect(existsSync(out) && statSync(out).size).toBe(4 + 20 + 'text-embedding-3-small'.length + 450 * 8 + 450 * 8)
  }, 30_000)

  it('tries again after an error whose own body is cut short', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'embed-ministry-'))
    library(path.join(dir, 'ministry.db'), 450)
    let calls = 0
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        calls++
        if (calls === 1) {
          res.writeHead(502, { 'content-type': 'text/html', 'content-length': '100000' })
          // the headers and a few bytes arrive, then the connection closes cleanly: the error is read, its body is short
          res.write('<html>502 Bad Gateway', () => res.socket?.end())
          return
        }
        const input: string[] = JSON.parse(body).input
        const vector = Buffer.from(new Float32Array(8).fill(0.5).buffer).toString('base64')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: vector })), usage: { total_tokens: input.length * 6 } }))
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const out = path.join(dir, 'ministry_vec.bin')
    const tool = spawn('python3', [path.join(ROOT, 'tools/embed_ministry.py'), '--db', path.join(dir, 'ministry.db'), '--cache', path.join(dir, 'cache'), '--out', out,
      '--url', `http://127.0.0.1:${(server.address() as AddressInfo).port}`], { env: { ...process.env, BEREAN_EMBED_KEY: 'test-key' } })
    let said = ''
    tool.stdout.on('data', c => { said += c })
    tool.stderr.on('data', c => { said += c })
    const code = await new Promise<number | string>(r => {
      const late = setTimeout(() => { tool.kill(); r('still running after 20 s') }, 20_000)
      tool.on('close', c => { clearTimeout(late); r(c ?? 'killed') })
    })
    server.close()
    expect({ code, calls }, said).toEqual({ code: 0, calls: 3 })
    expect(existsSync(out) && statSync(out).size).toBe(4 + 20 + 'text-embedding-3-small'.length + 450 * 8 + 450 * 8)
  }, 30_000)
})
