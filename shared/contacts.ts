/**
 * Private contact matching, the client half. Phone numbers and email addresses are normalised on the device
 * (E.164; trimmed lower case), hashed with SHA-256 and a fixed salt, and only the hashes leave the phone. The
 * server compares them with the hashes of users who chose "Let contacts find me".
 *
 * Pure and dependency-free: runs on Hermes (no `crypto.subtle`, no `TextEncoder`), in the browser and in vitest.
 */

// ---------- SHA-256 (FIPS 180-4) ----------

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
/** message schedule, reused by every block (single-threaded JS) */
const W = new Int32Array(64)

function compress(h: Int32Array, m: Uint8Array, off: number) {
  for (let i = 0; i < 16; i++, off += 4) W[i] = m[off] << 24 | m[off + 1] << 16 | m[off + 2] << 8 | m[off + 3]
  for (let i = 16; i < 64; i++) {
    const x = W[i - 15], y = W[i - 2]
    const s0 = (x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ x >>> 3
    const s1 = (y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ y >>> 10
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7]
  for (let i = 0; i < 64; i++) {
    const t1 = (k + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0
    const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
    k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
  }
  h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0
  h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0
}

/** The digest as eight big-endian words. */
function digest(bytes: Uint8Array): Int32Array {
  const n = bytes.length
  const end = (n + 72) & ~63 // message + 0x80 + 64-bit length, rounded up to whole blocks
  const m = new Uint8Array(end)
  m.set(bytes)
  m[n] = 0x80
  const hi = Math.floor(n / 0x20000000), lo = (n << 3) >>> 0
  m[end - 8] = hi >>> 24; m[end - 7] = hi >>> 16; m[end - 6] = hi >>> 8; m[end - 5] = hi
  m[end - 4] = lo >>> 24; m[end - 3] = lo >>> 16; m[end - 2] = lo >>> 8; m[end - 1] = lo
  const h = new Int32Array(H0)
  for (let off = 0; off < end; off += 64) compress(h, m, off)
  return h
}

export function sha256(bytes: Uint8Array): Uint8Array {
  const h = digest(bytes), out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    const w = h[i]
    out[i * 4] = w >>> 24; out[i * 4 + 1] = w >>> 16; out[i * 4 + 2] = w >>> 8; out[i * 4 + 3] = w
  }
  return out
}

/** UTF-8 bytes of a JS string; a lone surrogate becomes U+FFFD, as `TextEncoder` does. */
export function utf8(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 3)
  let p = 0
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c < 0x80) { out[p++] = c; continue }
    if (c < 0x800) { out[p++] = 0xc0 | c >> 6; out[p++] = 0x80 | c & 63; continue }
    if (c >= 0xd800 && c < 0xe000) {
      const d = c < 0xdc00 && i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
        i++
        out[p++] = 0xf0 | c >> 18; out[p++] = 0x80 | c >> 12 & 63; out[p++] = 0x80 | c >> 6 & 63; out[p++] = 0x80 | c & 63
        continue
      }
      c = 0xfffd
    }
    out[p++] = 0xe0 | c >> 12; out[p++] = 0x80 | c >> 6 & 63; out[p++] = 0x80 | c & 63
  }
  return out.subarray(0, p)
}

/** Lower-case hex SHA-256 of the UTF-8 encoding of `input`. */
export function sha256Hex(input: string): string {
  const h = digest(utf8(input))
  let s = ''
  for (let i = 0; i < 8; i++) s += (h[i] >>> 0).toString(16).padStart(8, '0')
  return s
}

// ---------- hashes ----------

export type ContactKind = 'phone' | 'email'

/**
 * Public: it ships in the app, so it only keeps values out of casual view (logs, a database glance) and stops a
 * hash from matching a plain SHA-256 table. It does not stop a determined attacker: a phone number has about
 * 10^10 candidates per country and brute-forces in minutes. The protections that matter are opt-in on both
 * sides, never storing the querying user's hashes, and rate limits, all of them the server's job.
 * Changing it orphans every stored hash: bump the version and re-collect.
 */
export const CONTACT_SALT = 'jottings-contacts-v1'

/** Hash of an already normalised value (`normalisePhone` / `normaliseEmail`), lower-case hex. */
export function contactHash(kind: ContactKind, normalised: string): string {
  return sha256Hex(`${CONTACT_SALT}|${kind}|${normalised}`)
}

// ---------- email ----------

/**
 * Trimmed and lower-cased whole (local parts are case-sensitive on paper, never in practice), or null when it is
 * not plausibly an address. Dots and `+tags` are kept: providers disagree on what they mean, so `a.b@gmail.com`
 * and `ab@gmail.com` stay different people here.
 */
export function normaliseEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (!s || s.length > 254 || /\s/.test(s)) return null
  const at = s.indexOf('@')
  if (at < 1 || at !== s.lastIndexOf('@')) return null
  const labels = s.slice(at + 1).split('.')
  return labels.length >= 2 && labels.every(l => l.length > 0) ? s : null
}

// ---------- phone ----------

export interface Region {
  /** country calling code, digits only */
  cc: string
  /** national (trunk) prefix dropped from national-format numbers; alternatives are tried in order */
  trunk?: string | string[]
  /** the leading 0 belongs to the number and is dialled from abroad too (Italy) */
  keepZero?: boolean
  /** international prefixes besides `00`, tried before it */
  idd?: string[]
}

const NANP: Region = { cc: '1', trunk: '1', idd: ['011'] }
const r = (cc: string, trunk?: string | string[], idd?: string[]): Region => ({ cc, trunk, idd })
const z = (cc: string): Region => ({ cc, keepZero: true })

/**
 * ISO 3166 alpha-2 -> numbering plan. A region without `trunk` has closed numbering: national numbers are dialled
 * as they are, and one starting with 0 (not `keepZero`) is rejected rather than guessed at.
 *
 * Handled specially in `normalisePhone`: Mexico (the 2019 plan dropped 044/045/01 and the mobile `1` after +52;
 * both old forms are rewritten), Brazil (a two-digit carrier code after the trunk 0 is dropped), NANP (exactly 10
 * national digits, area code 2-9). Not handled: Argentina's mobile `15` / `9` (a national mobile will not match
 * its E.164 form), carrier-selecting international prefixes (Brazil 00xx, Colombia 00x), and numbers written with
 * the country code but no `+` or `00` ("44 20 ..."), which read as national.
 */
export const REGIONS: Record<string, Region> = {
  // North American Numbering Plan
  US: NANP, CA: NANP, PR: NANP, VI: NANP, GU: NANP, AS: NANP, MP: NANP, AG: NANP, AI: NANP, BB: NANP, BM: NANP,
  BS: NANP, DM: NANP, DO: NANP, GD: NANP, JM: NANP, KN: NANP, KY: NANP, LC: NANP, MS: NANP, SX: NANP, TC: NANP,
  TT: NANP, VC: NANP, VG: NANP,
  // United Kingdom, Crown dependencies, Ireland
  GB: r('44', '0'), GG: r('44', '0'), JE: r('44', '0'), IM: r('44', '0'), GI: r('350'), IE: r('353', '0'),
  // European Union (IE above)
  AT: r('43', '0'), BE: r('32', '0'), BG: r('359', '0'), HR: r('385', '0'), CY: r('357'), CZ: r('420'),
  DK: r('45'), EE: r('372'), FI: r('358', '0'), FR: r('33', '0'), DE: r('49', '0'), GR: r('30'),
  HU: r('36', '06'), IT: z('39'), LV: r('371'), LT: r('370', ['8', '0']), LU: r('352'), MT: r('356'),
  NL: r('31', '0'), PL: r('48'), PT: r('351'), RO: r('40', '0'), SK: r('421', '0'), SI: r('386', '0'),
  ES: r('34'), SE: r('46', '0'),
  // French overseas departments
  RE: r('262', '0'), YT: r('262', '0'), GP: r('590', '0'), MQ: r('596', '0'), GF: r('594', '0'),
  // rest of Europe; Vatican City is served by Rome's +39 06
  CH: r('41', '0'), LI: r('423'), NO: r('47'), IS: r('354'), MC: r('377'), SM: z('378'), VA: z('39'),
  AD: r('376'), RS: r('381', '0'), BA: r('387', '0'), ME: r('382', '0'), MK: r('389', '0'), AL: r('355', '0'),
  XK: r('383', '0'), MD: r('373', '0'), UA: r('380', '0'), BY: r('375', ['80', '8', '0'], ['810']),
  RU: r('7', '8', ['810']), KZ: r('7', '8', ['810']), GE: r('995', '0'), AM: r('374', '0'), AZ: r('994', '0'),
  TR: r('90', '0'),
  // Middle East and North Africa
  IL: r('972', '0'), PS: r('970', '0'), AE: r('971', '0'), SA: r('966', '0'), QA: r('974'), BH: r('973'),
  KW: r('965'), OM: r('968'), JO: r('962', '0'), LB: r('961', '0'), IQ: r('964', '0'), IR: r('98', '0'),
  YE: r('967', '0'), EG: r('20', '0'), DZ: r('213', '0'), MA: r('212', '0'), TN: r('216'), SD: r('249', '0'),
  // Asia
  CN: r('86', '0'), HK: r('852', undefined, ['001']), MO: r('853'), TW: r('886', '0', ['002']),
  JP: r('81', '0', ['010']), KR: r('82', '0', ['001', '002', '005', '006', '008']), SG: r('65', undefined, ['001', '002']),
  MY: r('60', '0'), TH: r('66', '0', ['001']), VN: r('84', '0'), PH: r('63', '0'),
  ID: r('62', '0', ['001', '007', '008']), IN: r('91', '0'), PK: r('92', '0'), BD: r('880', '0'), LK: r('94', '0'),
  NP: r('977', '0'), MM: r('95', '0'), KH: r('855', '0'), AF: r('93', '0'),
  // Oceania
  AU: r('61', '0', ['0011']), NZ: r('64', '0'), FJ: r('679'), PG: r('675'),
  // Sub-Saharan Africa; Côte d'Ivoire's 2021 plan made the leading 0 part of the number
  ZA: r('27', '0'), NG: r('234', '0'), KE: r('254', '0', ['000']), UG: r('256', '0', ['000']),
  TZ: r('255', '0', ['000']), GH: r('233', '0'), ET: r('251', '0'), CD: r('243', '0'), AO: r('244'), MZ: r('258'),
  CM: r('237'), CI: z('225'), SN: r('221'), ZM: r('260', '0'), ZW: r('263', '0'), MW: r('265', '0'),
  RW: r('250', '0'), BW: r('267'), NA: r('264', '0'), MU: r('230'),
  // Latin America and the Caribbean outside NANP
  MX: r('52'), BR: r('55', '0'), AR: r('54', '0'), CO: r('57'), CL: r('56'), PE: r('51', '0'), VE: r('58', '0'),
  EC: r('593', '0'), BO: r('591', '0'), PY: r('595', '0'), UY: r('598', '0'), CU: r('53', '0'), GT: r('502'),
  CR: r('506'), PA: r('507'), SV: r('503'), HN: r('504'), NI: r('505'),
}

const trunks = (reg: Region) => reg.trunk === undefined ? [] : typeof reg.trunk === 'string' ? [reg.trunk] : reg.trunk

/** cc -> trunk prefix written by mistake after it ("+44 (0)20", "+44 07700"): only 0-led trunks every region of the cc shares. */
const CC_TRUNK = (() => {
  const seen = new Map<string, string | null>()
  for (const reg of Object.values(REGIONS)) {
    const t = trunks(reg)
    const one = !reg.keepZero && t.length === 1 && t[0][0] === '0' ? t[0] : null
    seen.set(reg.cc, seen.has(reg.cc) && seen.get(reg.cc) !== one ? null : one)
  }
  return new Map([...seen].filter((e): e is [string, string] => e[1] !== null))
})()

/** Arabic-Indic, Persian and fullwidth digits and the fullwidth plus, as ASCII. */
function asciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹０-９＋]/g, ch => {
    const c = ch.charCodeAt(0)
    return c === 0xff0b ? '+' : String.fromCharCode(48 + (c >= 0xff10 ? c - 0xff10 : c >= 0x6f0 ? c - 0x6f0 : c - 0x660))
  })
}

/** Everything from an extension or dialler pause on: "ext. 12", "x12", "#12", ",,12", ";12", "p12", "w12". */
const EXTENSION = /(?:ext|[x#,;pw]).*$/i
const SEPARATORS = /[\s  -​ 　().\-‐-―−/]/g

/** National digits (no trunk, no carrier code) or null when the plan says they cannot be right. */
function national(d: string, region: string, reg: Region): string | null {
  const t = trunks(reg).find(p => d.startsWith(p))
  if (t !== undefined) {
    d = d.slice(t.length)
    // 0 + carrier + area + subscriber: area + subscriber is 10 or 11 digits
    if (region === 'BR' && (d.length === 12 || d.length === 13)) d = d.slice(2)
  } else if (region === 'MX') {
    if (d.length === 13 && (d.startsWith('044') || d.startsWith('045'))) d = d.slice(3)
    else if (d.length === 12 && d.startsWith('01')) d = d.slice(2)
  }
  return d[0] === '0' && !reg.keepZero ? null : d
}

/**
 * E.164 ("+" and 8-15 digits, the first not 0) or null. `region` (ISO alpha-2, the device's) decides national
 * numbers; without it only "+..." and "00..." numbers are accepted. See `REGIONS` for the plans and exceptions.
 */
export function normalisePhone(raw: string, region: string | null): string | null {
  let s = asciiDigits(raw).trim().replace(/^tel:/i, '').replace(EXTENSION, '')
  // the "(0)" of "+44 (0) 20 ...": a trunk prefix that is never dialled from abroad
  const z0 = /\(\s*0\s*\)/.exec(s)
  if (z0 && /[+\d]/.test(s.slice(0, z0.index))) s = s.slice(0, z0.index) + s.slice(z0.index + z0[0].length)
  s = s.replace(SEPARATORS, '')
  if (!/^\+?\d+$/.test(s)) return null
  const code = region ? region.toUpperCase() : null
  const reg = code ? REGIONS[code] : undefined
  let d: string
  if (s[0] === '+') d = s.slice(1)
  else {
    const idd = reg?.idd?.find(p => s.startsWith(p)) ?? (s.startsWith('00') ? '00' : undefined)
    if (idd) d = s.slice(idd.length)
    else {
      if (!reg || !code) return null
      const n = national(s, code, reg)
      if (n === null) return null
      d = reg.cc + n
    }
  }
  if (d[0] === '1') {
    // NANP: area code and 7 digits, the area code never starting 0 or 1
    return d.length === 11 && d[1] >= '2' ? '+' + d : null
  }
  if (d.startsWith('521') && d.length === 13) d = '52' + d.slice(3)
  for (let n = 2; n <= 3; n++) {
    const t = CC_TRUNK.get(d.slice(0, n))
    if (t && d.startsWith(t, n)) { d = d.slice(0, n) + d.slice(n + t.length); break }
  }
  return /^[1-9]\d{7,14}$/.test(d) ? '+' + d : null
}

/** "en-US", "fr_CA", "zh-Hant-TW", "en_GB.UTF-8" -> the region if `REGIONS` knows it ("en-UK" reads as GB); "es-419", "en" -> null. */
export function regionFromLocale(locale: string | null | undefined): string | null {
  if (!locale) return null
  const parts = locale.split(/[.@]/)[0].split(/[-_]/)
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (p.length === 1) break // extension or private-use singleton: the rest is not a region
    if (/^[a-z]{2}$/i.test(p)) {
      const code = p.toUpperCase() === 'UK' ? 'GB' : p.toUpperCase()
      return REGIONS[code] ? code : null
    }
  }
  return null
}

// ---------- batches ----------

export interface ContactHashes {
  /** sorted lower-case hex, unique */
  hashes: string[]
  /** distinct phone numbers and email addresses sent */
  phones: number
  emails: number
  /** entries that could not be normalised or did not fit under the cap (blanks and duplicates are not counted) */
  skipped: number
}

/**
 * The address book as a sorted list of hashes, so the request says nothing about the book's order. Over `cap`,
 * phone numbers go first (almost every contact has one, fewer have an email) and within a kind the smallest hashes
 * are kept: the same book always sends the same subset, whatever order the device lists it in.
 */
export function hashContacts(input: { phones: string[]; emails: string[] }, region: string | null, cap = 2000): ContactHashes {
  let skipped = 0
  const kind = (raw: string[], norm: (s: string) => string | null, k: ContactKind) => {
    const vals = new Set<string>()
    for (const v of raw) {
      if (!v || !v.trim()) continue
      const n = norm(v)
      if (n === null) skipped++
      else vals.add(n)
    }
    return [...vals].map(v => contactHash(k, v)).sort()
  }
  const phones = kind(input.phones, s => normalisePhone(s, region), 'phone')
  const emails = kind(input.emails, normaliseEmail, 'email')
  const room = Math.max(0, Math.floor(cap))
  const p = phones.slice(0, room), e = emails.slice(0, room - p.length)
  skipped += phones.length - p.length + emails.length - e.length
  return { hashes: [...new Set([...p, ...e])].sort(), phones: p.length, emails: e.length, skipped }
}

/**
 * The "Let contacts find me" form: hashes of what the user typed, and an interface sentence per field that could
 * not be read. An empty field is neither.
 */
export function ownContactHashes(phone: string | null, email: string | null, region: string | null): {
  hashes: string[]; errors: { phone?: string; email?: string }
} {
  const hashes: string[] = []
  const errors: { phone?: string; email?: string } = {}
  if (phone && phone.trim()) {
    const n = normalisePhone(phone, region)
    if (n) hashes.push(contactHash('phone', n))
    else errors.phone = `That does not look like a phone number. Include the country code, such as +${(region && REGIONS[region.toUpperCase()]?.cc) || '44'}.`
  }
  if (email && email.trim()) {
    const n = normaliseEmail(email)
    if (n) hashes.push(contactHash('email', n))
    else errors.email = 'That does not look like an email address.'
  }
  return { hashes: hashes.sort(), errors }
}
