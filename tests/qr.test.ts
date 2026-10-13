import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { siteUrl } from '../shared/brand'
import {
  alignmentPositions, byteCapacity, dataCodewords, encodeQr, finderOrigins, formatBits, qrPath, rawDataModules,
  reedSolomonRemainder, utf8, versionBits, type Ecl, type QrMatrix,
} from '../shared/qr'

const INVITE = siteUrl('/friends?t=Ab3dEf5hIj7kLm9nOp1q')
const ECLS: Ecl[] = ['L', 'M', 'Q', 'H']

describe('utf8', () => {
  it('encodes 1- to 4-byte sequences', () => {
    expect(utf8('A')).toEqual([0x41])
    expect(utf8('é')).toEqual([0xc3, 0xa9])
    expect(utf8('€')).toEqual([0xe2, 0x82, 0xac])
    expect(utf8('😀')).toEqual([0xf0, 0x9f, 0x98, 0x80])
    expect(utf8('a😀b')).toEqual([0x61, 0xf0, 0x9f, 0x98, 0x80, 0x62])
  })
  it('replaces lone surrogates with U+FFFD', () => {
    expect(utf8('\ud83d')).toEqual([0xef, 0xbf, 0xbd])
    expect(utf8('\ude00x')).toEqual([0xef, 0xbf, 0xbd, 0x78])
    expect(utf8('\ud83d😀')).toEqual([0xef, 0xbf, 0xbd, 0xf0, 0x9f, 0x98, 0x80])
  })
  it('matches Node for a mixed string', () => {
    const s = 'Café naïve Ζωή 😀 — ok'
    expect(utf8(s)).toEqual([...Buffer.from(s, 'utf8')])
  })
})

describe('Reed-Solomon', () => {
  it('matches the Thonky HELLO WORLD 1-M vector', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
    expect(reedSolomonRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
  })
})

describe('format and version information', () => {
  it('gives the published 15-bit format strings', () => {
    const f = (e: Ecl, m: number) => formatBits(e, m).toString(2).padStart(15, '0')
    expect(f('L', 0)).toBe('111011111000100')
    expect(f('M', 0)).toBe('101010000010010')
    expect(f('Q', 0)).toBe('011010101011111')
    expect(f('H', 0)).toBe('001011010001001')
    expect(f('L', 4)).toBe('110011000101111')
    expect(f('M', 5)).toBe('100000011001110')
    expect(f('H', 7)).toBe('000100000111011')
  })
  it('gives the published 18-bit version strings', () => {
    expect(versionBits(7)).toBe(0x07c94)
    expect(versionBits(8)).toBe(0x085bc)
    expect(versionBits(40)).toBe(0x28c69)
  })
})

describe('capacity tables', () => {
  it('agree with the standard at the ends', () => {
    expect(rawDataModules(1)).toBe(208)
    expect(Math.floor(rawDataModules(40) / 8)).toBe(3706)
    expect(ECLS.map(e => dataCodewords(1, e))).toEqual([19, 16, 13, 9])
    expect(ECLS.map(e => dataCodewords(40, e))).toEqual([2956, 2334, 1666, 1276])
    expect(ECLS.map(e => byteCapacity(40, e))).toEqual([2953, 2331, 1663, 1273])
  })
  it('grow with the version and shrink with the level', () => {
    for (let v = 1; v <= 40; v++) {
      const caps = ECLS.map(e => byteCapacity(v, e))
      expect(caps).toEqual([...caps].sort((a, b) => b - a))
      if (v > 1) for (const e of ECLS) expect(byteCapacity(v, e)).toBeGreaterThan(byteCapacity(v - 1, e))
    }
  })
  it('puts the byte-mode boundaries for level M where the standard does', () => {
    for (const [v, cap] of [[1, 14], [2, 26], [3, 42], [4, 62], [5, 84], [10, 213]]) {
      expect(encodeQr('x'.repeat(cap), { ecl: 'M', boostEcl: false }).version).toBe(v)
      expect(encodeQr('x'.repeat(cap + 1), { ecl: 'M', boostEcl: false }).version).toBe(v + 1)
    }
  })
  it('throws when version 40 is too small', () => {
    expect(() => encodeQr('x'.repeat(2331), { ecl: 'M', boostEcl: false })).not.toThrow()
    expect(() => encodeQr('x'.repeat(2332), { ecl: 'M' })).toThrow(/version 40/)
    expect(() => encodeQr('x'.repeat(1274), { ecl: 'H' })).toThrow(/version 40/)
  })
})

describe('options', () => {
  it('boosts the level only within the same version', () => {
    const q = encodeQr('HELLO')
    expect(q).toMatchObject({ version: 1, ecl: 'H' })
    expect(encodeQr('HELLO', { boostEcl: false }).ecl).toBe('M')
    expect(encodeQr('x'.repeat(14))).toMatchObject({ version: 1, ecl: 'M' })
    expect(encodeQr(INVITE)).toMatchObject({ version: 4, ecl: 'M' })
  })
  it('honours minVersion and a forced mask', () => {
    expect(encodeQr('hi', { minVersion: 7 }).version).toBe(7)
    for (let k = 0; k < 8; k++) expect(encodeQr('hi', { mask: k }).mask).toBe(k)
    expect(() => encodeQr('hi', { mask: 8 })).toThrow()
    expect(() => encodeQr('hi', { minVersion: 41 })).toThrow()
  })
  it('is deterministic', () => {
    expect(encodeQr(INVITE)).toEqual(encodeQr(INVITE))
  })
})

describe('structure', () => {
  const finderOk = (m: QrMatrix, ox: number, oy: number) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = ox + dx, y = oy + dy
      if (x < 0 || y < 0 || x >= m.size || y >= m.size) continue
      const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
      expect(m.modules[y][x], `finder ${ox},${oy} at ${x},${y}`).toBe(d !== 2 && d !== 4)
    }
  }
  for (const v of [1, 2, 7, 21, 40]) {
    it(`draws the fixed patterns of version ${v}`, () => {
      const m = encodeQr('x', { minVersion: v })
      expect(m.version).toBe(v)
      expect(m.size).toBe(17 + 4 * v)
      expect(m.modules.length).toBe(m.size)
      expect(m.modules.every(r => r.length === m.size)).toBe(true)
      expect(finderOrigins(m)).toEqual([[0, 0], [m.size - 7, 0], [0, m.size - 7]])
      for (const [x, y] of finderOrigins(m)) finderOk(m, x, y)
      for (let i = 8; i < m.size - 8; i++) {
        expect(m.modules[6][i]).toBe(i % 2 === 0)
        expect(m.modules[i][6]).toBe(i % 2 === 0)
      }
      expect(m.modules[4 * v + 9][8]).toBe(true)
      const al = alignmentPositions(v), last = al.length - 1
      al.forEach((cy, i) => al.forEach((cx, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          expect(m.modules[cy + dy][cx + dx]).toBe(Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }))
    })
  }
  it('places alignment centres per the standard table', () => {
    expect(alignmentPositions(1)).toEqual([])
    expect(alignmentPositions(2)).toEqual([6, 18])
    expect(alignmentPositions(7)).toEqual([6, 22, 38])
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138])
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170])
  })
  it('writes the format bits in both copies', () => {
    const m = encodeQr(INVITE, { ecl: 'Q', mask: 5, boostEcl: false })
    const bits = formatBits('Q', 5), at = (x: number, y: number) => m.modules[y][x] ? 1 : 0
    const a = [0, 1, 2, 3, 4, 5, 7, 8].map(y => at(8, y)).concat([7, 5, 4, 3, 2, 1, 0].map(x => at(x, 8)))
    const b = Array.from({ length: 8 }, (_, i) => at(m.size - 1 - i, 8)).concat(Array.from({ length: 7 }, (_, i) => at(8, m.size - 7 + i)))
    const want = Array.from({ length: 15 }, (_, i) => (bits >>> i) & 1)
    expect(a).toEqual(want)
    expect(b).toEqual(want)
  })
  it('writes the version bits in both copies from version 7', () => {
    const m = encodeQr('x', { minVersion: 7 }), bits = versionBits(7)
    for (let i = 0; i < 18; i++) {
      const a = m.size - 11 + i % 3, b = Math.floor(i / 3), want = ((bits >>> i) & 1) === 1
      expect(m.modules[b][a]).toBe(want)
      expect(m.modules[a][b]).toBe(want)
    }
  })
})

describe('qrPath', () => {
  const cells = (d: string) => {
    const on = new Set<string>()
    for (const [, x, y, w, w2] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      expect(w2).toBe(w)
      for (let i = 0; i < +w; i++) on.add(`${+x + i},${y}`)
    }
    return on
  }
  it('covers exactly the dark modules with one rect per run', () => {
    const m = encodeQr(INVITE), d = qrPath(m), on = cells(d)
    let dark = 0
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
      if (m.modules[y][x]) dark++
      expect(on.has(`${x},${y}`)).toBe(m.modules[y][x])
    }
    expect(on.size).toBe(dark)
    expect(d.replace(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g, '')).toBe('')
    expect(d.startsWith('M0 0h7v1h-7z')).toBe(true)
  })
  it('skips the finders and nothing else', () => {
    const m = encodeQr(INVITE), on = cells(qrPath(m, { skipFinders: true }))
    const inFinder = (x: number, y: number) => finderOrigins(m).some(([ox, oy]) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7)
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
      expect(on.has(`${x},${y}`)).toBe(m.modules[y][x] && !inFinder(x, y))
    }
  })
})

// ---------- round trip through zbar ----------

const hasZbar = existsSync('/usr/bin/zbarimg') || (() => {
  try { execFileSync('zbarimg', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
})()

/** zbar's --raw output: the payload as UTF-8, newline-terminated. */
function decode(m: QrMatrix): string {
  const quiet = 4, scale = 8, n = (m.size + quiet * 2) * scale
  const rows: string[] = []
  for (let py = 0; py < n; py++) {
    const y = Math.floor(py / scale) - quiet
    let r = ''
    for (let px = 0; px < n; px++) {
      const x = Math.floor(px / scale) - quiet
      r += x >= 0 && y >= 0 && x < m.size && y < m.size && m.modules[y][x] ? '1' : '0'
    }
    rows.push(r)
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'qr-'))
  try {
    const file = path.join(dir, 'qr.pbm')
    writeFileSync(file, `P1\n${n} ${n}\n${rows.join('\n')}\n`)
    return execFileSync('zbarimg', ['--raw', '-q', file]).toString('utf8').replace(/\n$/, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!hasZbar)('zbar round trip', () => {
  const long = 'In the beginning God created the heavens and the earth. '.repeat(4) + 'And the earth was waste and empty.'
  const cases: [string, string, Parameters<typeof encodeQr>[1]][] = [
    ['the invite URL', INVITE, {}],
    ['an ASCII sentence', 'For God so loved the world, that he gave his only-begotten Son.', {}],
    ['accents, Greek and an emoji', 'Café naïve Ζωή 😀 — ok', {}],
    ['a 200+ byte string', long, {}],
    ['level L', INVITE, { ecl: 'L', boostEcl: false }],
    ['level M', INVITE, { ecl: 'M', boostEcl: false }],
    ['level Q', INVITE, { ecl: 'Q', boostEcl: false }],
    ['level H', INVITE, { ecl: 'H', boostEcl: false }],
    ['version 7 (version information)', INVITE, { minVersion: 7 }],
    ['version 32, short and long blocks', long.repeat(4), { ecl: 'Q' }],
    ['version 40 filled at level L', 'Notebook '.repeat(328) + '0', { ecl: 'L' }],
  ]
  for (const [name, text, opts] of cases) {
    it(`decodes ${name}`, () => {
      const m = encodeQr(text, opts)
      expect(decode(m)).toBe(text)
    })
  }
  it('uses higher versions for the long cases', () => {
    expect(encodeQr(long).version).toBeGreaterThanOrEqual(10)
    expect(encodeQr(long.repeat(4), { ecl: 'Q' }).version).toBe(32)
    expect(encodeQr('Notebook '.repeat(328) + '0', { ecl: 'L' })).toMatchObject({ version: 40, ecl: 'L' })
  })
  for (let k = 0; k < 8; k++) {
    it(`decodes with forced mask ${k}`, () => {
      expect(decode(encodeQr(INVITE, { mask: k }))).toBe(INVITE)
    })
  }
})
