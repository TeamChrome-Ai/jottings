/*
 * QR Code encoder, byte mode only. Adapted from Project Nayuki's QR Code generator library (TypeScript).
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in all copies or substantial portions
 *   of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or implied, including but not limited
 *   to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall
 *   the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of
 *   contract, tort or otherwise, arising from, out of or in connection with the Software or the use or other
 *   dealings in the Software.
 */

export type Ecl = 'L' | 'M' | 'Q' | 'H'

export interface QrMatrix {
  version: number
  /** 17 + 4 * version modules a side */
  size: number
  ecl: Ecl
  mask: number
  /** [y][x], true = dark */
  modules: boolean[][]
}

export interface QrOptions {
  /** the minimum level; default 'M' */
  ecl?: Ecl
  /** 1..40, default 1 */
  minVersion?: number
  /** raise the level while the data still fits the same version; default true */
  boostEcl?: boolean
  /** 0..7; default: the lowest-penalty mask */
  mask?: number
}

const ECLS: Ecl[] = ['L', 'M', 'Q', 'H']
/** The two format-information bits per level (not the level's order). */
const ECL_FORMAT: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 }

// Indexed [level][version]; index 0 is padding.
const ECC_PER_BLOCK: Record<Ecl, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
}
const ECC_BLOCKS: Record<Ecl, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
}

/** UTF-8 bytes of a JS string; a lone surrogate becomes U+FFFD. Hermes has no guaranteed TextEncoder. */
export function utf8(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++ }
    }
    if (c >= 0xd800 && c < 0xe000) c = 0xfffd
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63)
    else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63)
    else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63)
  }
  return out
}

/** Modules left for data and ECC once every function pattern of the version is drawn (remainder bits included). */
export function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const a = Math.floor(ver / 7) + 2
    n -= (25 * a - 10) * a - 55
    if (ver >= 7) n -= 36
  }
  return n
}

/** 8-bit data codewords (ECC excluded) the version holds at the level. */
export function dataCodewords(ver: number, ecl: Ecl): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * ECC_BLOCKS[ecl][ver]
}

/** Most bytes byte mode fits in the version at the level. */
export function byteCapacity(ver: number, ecl: Ecl): number {
  return Math.floor((dataCodewords(ver, ecl) * 8 - 4 - (ver < 10 ? 8 : 16)) / 8)
}

/** Centre coordinates of the alignment patterns along either axis (empty for version 1). */
export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2
  const out = [6]
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

// ---------- Reed-Solomon over GF(2^8), modulus x^8 + x^4 + x^3 + x^2 + 1 ----------

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

/** Generator polynomial of the degree, coefficients highest power first with the leading 1 dropped. */
function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0)
  out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root)
      if (j + 1 < degree) out[j] ^= out[j + 1]
    }
    root = gfMul(root, 2)
  }
  return out
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const out = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ out.shift()!
    out.push(0)
    divisor.forEach((coef, i) => { out[i] ^= gfMul(coef, factor) })
  }
  return out
}

/** The `degree` ECC codewords of a block of data codewords. */
export function reedSolomonRemainder(data: readonly number[], degree: number): number[] {
  return rsRemainder(data, rsDivisor(degree))
}

// ---------- format and version information ----------

/** The 15-bit format information (BCH (15,5), XOR 0x5412), bit 14 first in reading order. */
export function formatBits(ecl: Ecl, mask: number): number {
  const data = ECL_FORMAT[ecl] << 3 | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return (data << 10 | rem) ^ 0x5412
}

/** The 18-bit version information (BCH (18,6)), drawn for versions 7 and up. */
export function versionBits(ver: number): number {
  let rem = ver
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return ver << 12 | rem
}

// ---------- the symbol ----------

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
]

class Builder {
  readonly version: number
  readonly ecl: Ecl
  readonly size: number
  readonly modules: boolean[][]
  readonly fn: boolean[][]

  constructor(version: number, ecl: Ecl) {
    this.version = version; this.ecl = ecl
    const size = this.size = version * 4 + 17
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
    this.fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  }

  set(x: number, y: number, dark: boolean) { this.modules[y][x] = dark; this.fn[y][x] = true }

  drawFunctionPatterns() {
    const { size, version } = this
    for (let i = 0; i < size; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0) }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) this.set(x, y, d !== 2 && d !== 4)
      }
    }
    const al = alignmentPositions(version), last = al.length - 1
    al.forEach((cy, i) => al.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }))
    this.drawFormat(0)
    if (version >= 7) {
      const bits = versionBits(version)
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + i % 3, b = Math.floor(i / 3)
        this.set(a, b, bit(bits, i)); this.set(b, a, bit(bits, i))
      }
    }
  }

  drawFormat(mask: number) {
    const bits = formatBits(this.ecl, mask), size = this.size
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i))
    this.set(8, 7, bit(bits, 6)); this.set(8, 8, bit(bits, 7)); this.set(7, 8, bit(bits, 8))
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i))
    for (let i = 0; i < 8; i++) this.set(size - 1 - i, 8, bit(bits, i))
    for (let i = 8; i < 15; i++) this.set(8, size - 15 + i, bit(bits, i))
    this.set(8, size - 8, true)
  }

  /** Zigzag placement from the bottom-right, two columns at a time, skipping the vertical timing column. */
  drawCodewords(data: readonly number[]) {
    const size = this.size
    let i = 0
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      const upward = ((right + 1) & 2) === 0
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = upward ? size - 1 - vert : vert
        if (!this.fn[y][x] && i < data.length * 8) { this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7)); i++ }
      }
    }
  }

  applyMask(mask: number) {
    const f = MASKS[mask]
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fn[y][x] && f(x, y)) this.modules[y][x] = !this.modules[y][x]
  }

  /** The four penalty rules of ISO/IEC 18004 7.8.3, weights 3, 3, 40 and 10. */
  penalty(): number {
    const { size, modules: m } = this
    let score = 0
    const addHistory = (len: number, h: number[]) => { if (h[0] === 0) len += size; h.pop(); h.unshift(len) }
    const countFinder = (h: number[]) => {
      const n = h[1], core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0)
    }
    const line = (at: (i: number) => boolean) => {
      let color = false, run = 0
      const h = [0, 0, 0, 0, 0, 0, 0]
      for (let i = 0; i < size; i++) {
        if (at(i) === color) {
          run++
          if (run === 5) score += 3
          else if (run > 5) score++
        } else {
          addHistory(run, h)
          if (!color) score += countFinder(h) * 40
          color = at(i); run = 1
        }
      }
      if (color) { addHistory(run, h); run = 0 }
      addHistory(run + size, h)
      score += countFinder(h) * 40
    }
    for (let y = 0; y < size; y++) line(x => m[y][x])
    for (let x = 0; x < size; x++) line(y => m[y][x])
    let dark = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++
      if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3
    }
    const total = size * size
    return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  }
}

/** Split the data codewords into blocks (short blocks first), append each block's ECC, interleave. */
function addEccAndInterleave(data: readonly number[], ver: number, ecl: Ecl): number[] {
  const numBlocks = ECC_BLOCKS[ecl][ver], eccLen = ECC_PER_BLOCK[ecl][ver]
  const raw = Math.floor(rawDataModules(ver) / 8)
  const numShort = numBlocks - raw % numBlocks, shortLen = Math.floor(raw / numBlocks)
  const div = rsDivisor(eccLen), blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const out: number[] = []
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]) })
  return out
}

/** Encode the text (UTF-8, byte mode) in the smallest version from `minVersion` that fits. Throws when not even version 40 holds it. */
export function encodeQr(text: string, opts: QrOptions = {}): QrMatrix {
  const bytes = utf8(text)
  let ecl = opts.ecl ?? 'M'
  const minVersion = opts.minVersion ?? 1
  if (!(minVersion >= 1 && minVersion <= 40 && Number.isInteger(minVersion))) throw new RangeError(`QR minVersion ${minVersion} is not 1..40`)
  if (opts.mask !== undefined && !(opts.mask >= 0 && opts.mask <= 7 && Number.isInteger(opts.mask))) throw new RangeError(`QR mask ${opts.mask} is not 0..7`)
  let ver = minVersion
  for (; ; ver++) {
    if (bytes.length <= byteCapacity(ver, ecl)) break
    if (ver >= 40) throw new Error(`QR: ${bytes.length} bytes do not fit version 40 at level ${ecl} (at most ${byteCapacity(40, ecl)})`)
  }
  if (opts.boostEcl ?? true) for (const e of ECLS.slice(ECLS.indexOf(ecl) + 1)) if (bytes.length <= byteCapacity(ver, e)) ecl = e

  const cap = dataCodewords(ver, ecl) * 8
  const bits: number[] = []
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(4, 4)
  put(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - bits.length % 8) % 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a << 1 | b, 0))
  for (let pad = 0xec; data.length < cap / 8; pad ^= 0xec ^ 0x11) data.push(pad)

  const q = new Builder(ver, ecl)
  q.drawFunctionPatterns()
  q.drawCodewords(addEccAndInterleave(data, ver, ecl))
  let mask = opts.mask ?? -1
  if (mask < 0) {
    let best = Infinity
    for (let k = 0; k < 8; k++) {
      q.applyMask(k); q.drawFormat(k)
      const p = q.penalty()
      if (p < best) { best = p; mask = k }
      q.applyMask(k)
    }
  }
  q.applyMask(mask); q.drawFormat(mask)
  return { version: ver, size: q.size, ecl, mask, modules: q.modules }
}

/** Top-left corners of the three finder patterns: [[0,0],[size-7,0],[0,size-7]]. */
export function finderOrigins(m: QrMatrix): [number, number][] {
  return [[0, 0], [m.size - 7, 0], [0, m.size - 7]]
}

/**
 * SVG path data (viewBox units = modules, origin at the top-left of the symbol, no quiet zone) for the dark modules,
 * horizontal runs merged into one rect each: `M x y h w v 1 h -w z`. `skipFinders` leaves out the three 7x7 finder
 * patterns (and nothing else) so a caller can draw rounded eyes itself.
 */
export function qrPath(m: QrMatrix, opts: { skipFinders?: boolean } = {}): string {
  const { size, modules } = m
  const inFinder = (x: number, y: number) => (x < 7 || x >= size - 7) && y < 7 || x < 7 && y >= size - 7
  const dark = (x: number, y: number) => modules[y][x] && !(opts.skipFinders && inFinder(x, y))
  let d = ''
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!dark(x, y)) continue
      const x0 = x
      while (x + 1 < size && dark(x + 1, y)) x++
      const w = x - x0 + 1
      d += `M${x0} ${y}h${w}v1h-${w}z`
    }
  }
  return d
}
