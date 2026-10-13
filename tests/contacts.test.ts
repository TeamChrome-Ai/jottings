import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  CONTACT_SALT, REGIONS, contactHash, hashContacts, normaliseEmail, normalisePhone, ownContactHashes, regionFromLocale,
  sha256, sha256Hex, utf8,
} from '../shared/contacts'

const node = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

describe('sha256', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
    expect(sha256Hex('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'))
      .toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1')
  })
  it('hashes one million a', () => {
    const t = performance.now()
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
    console.log(`sha256 of 1,000,000 bytes: ${(performance.now() - t).toFixed(1)} ms`)
  })
  it('hashes bytes and UTF-8 text as node:crypto does', () => {
    for (const s of ['é', '日本', 'Ψ', '😀 emoji', 'a b']) expect(sha256Hex(s)).toBe(node(s))
    const bytes = new Uint8Array(300).map((_, i) => (i * 7 + 3) & 255)
    expect(Buffer.from(sha256(bytes)).toString('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
  it('encodes UTF-8 like Buffer, lone surrogates as U+FFFD', () => {
    for (const s of ['', 'abc', 'é', '€', '日本', '😀', '\ud800', 'x\udc00y', '\ud83d', '\ud83d😀'])
      expect(Buffer.from(utf8(s)).toString('hex')).toBe(Buffer.from(s, 'utf8').toString('hex'))
  })
  it('agrees with node:crypto on 200 random strings across the padding boundaries', () => {
    let seed = 12345
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n }
    const pool = ['a', 'Z', '0', ' ', '+', 'é', 'ß', '€', '日', '😀', '\ud800', '\udfff', '\u0000']
    const lengths = [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128]
    for (let i = 0; i < 200; i++) {
      const len = i < lengths.length ? lengths[i] : rand(301)
      let s = ''
      // ASCII-only strings hit the byte boundaries exactly; the rest mix in multi-byte characters
      for (let j = 0; j < len; j++) s += i < lengths.length ? 'q' : pool[rand(pool.length)]
      expect(sha256Hex(s), JSON.stringify(s)).toBe(node(s))
    }
  })
})

describe('contactHash', () => {
  it('is salted, stable and differs by kind', () => {
    expect(CONTACT_SALT).toBe('jottings-contacts-v1')
    expect(contactHash('phone', '+442079460958')).toBe(node('jottings-contacts-v1|phone|+442079460958'))
    expect(contactHash('phone', '+442079460958')).toBe('3a5c57f398b6bae3e909a441484c385d73bc9bb5f14e0d495e9d2d90e6318593')
    expect(contactHash('email', '+442079460958')).not.toBe(contactHash('phone', '+442079460958'))
    expect(contactHash('email', 'a@b.org')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('normaliseEmail', () => {
  it('trims and folds case, keeps dots and tags', () => {
    expect(normaliseEmail('  John.Smith+Bible@Example.ORG ')).toBe('john.smith+bible@example.org')
    expect(normaliseEmail('a.b@gmail.com')).not.toBe(normaliseEmail('ab@gmail.com'))
    expect(normaliseEmail('x@mail.example.co.uk')).toBe('x@mail.example.co.uk')
  })
  it('rejects what is not an address', () => {
    for (const bad of ['', '   ', 'a@b', '@b.org', 'a b@c.org', 'a@.org', 'a@org.', 'a@b@c.org', 'a@b..org', 'plain', `${'a'.repeat(250)}@b.org`])
      expect(normaliseEmail(bad), bad).toBeNull()
  })
})

describe('normalisePhone', () => {
  const cases: [string, string | null, string][] = [
    ['(303) 555-0142', 'US', '+13035550142'],
    ['1-303-555-0142', 'US', '+13035550142'],
    ['303.555.0142', 'us', '+13035550142'],
    ['+1 303 555 0142', null, '+13035550142'],
    ['011 44 20 7946 0958', 'US', '+442079460958'],
    ['020 7946 0958', 'GB', '+442079460958'],
    ['07700 900123', 'GB', '+447700900123'],
    ['+44 (0) 20 7946 0958', null, '+442079460958'],
    ['+44 (0)7700 900123', 'FR', '+447700900123'],
    ['+44 07700 900123', null, '+447700900123'],
    ['0044 20 7946 0958', 'DE', '+442079460958'],
    ['06 12 34 56 78', 'FR', '+33612345678'],
    ['030 1234567', 'DE', '+49301234567'],
    ['06 1234 5678', 'IT', '+390612345678'],
    ['+39 06 1234 5678', null, '+390612345678'],
    ['333 123 4567', 'IT', '+393331234567'],
    ['0412 345 678', 'AU', '+61412345678'],
    ['0011 44 20 7946 0958', 'AU', '+442079460958'],
    ['8 912 345-67-89', 'RU', '+79123456789'],
    ['8 (912) 345-67-89', 'KZ', '+79123456789'],
    ['810 44 20 7946 0958', 'RU', '+442079460958'],
    ['8 029 123-45-67', 'BY', '+375291234567'],
    ['06 30 123 4567', 'HU', '+36301234567'],
    ['090-1234-5678', 'JP', '+819012345678'],
    ['010-1234-5678', 'KR', '+821012345678'],
    ['9123 4567', 'SG', '+6591234567'],
    ['0712 345678', 'KE', '+254712345678'],
    ['098765 43210', 'IN', '+919876543210'],
    ['55 1234 5678', 'MX', '+525512345678'],
    ['044 55 1234 5678', 'MX', '+525512345678'],
    ['+52 1 55 1234 5678', null, '+525512345678'],
    ['(11) 91234-5678', 'BR', '+5511912345678'],
    ['0 21 11 91234-5678', 'BR', '+5511912345678'],
    ['07 07 12 34 56', 'CI', '+2250707123456'],
    ['082 123 4567', 'ZA', '+27821234567'],
    ['+33 6 12 34 56 78 ext. 12', null, '+33612345678'],
    ['(303) 555-0142 x204', 'US', '+13035550142'],
    ['303-555-0142#9', 'US', '+13035550142'],
    ['303-555-0142,,9', 'US', '+13035550142'],
    ['tel:+442079460958', null, '+442079460958'],
    ['＋４４ 20 7946 0958', null, '+442079460958'],
  ]
  it.each(cases)('%s (%s) -> %s', (raw, region, want) => expect(normalisePhone(raw, region)).toBe(want))

  it('reads 00 as international in every region', () => {
    for (const region of [null, 'GB', 'US', 'FR', 'IT', 'RU', 'AU', 'JP', 'KE'])
      expect(normalisePhone('00 33 6 12 34 56 78', region), String(region)).toBe('+33612345678')
  })
  it('needs a region for national numbers', () => {
    expect(normalisePhone('020 7946 0958', null)).toBeNull()
    expect(normalisePhone('(303) 555-0142', null)).toBeNull()
    expect(normalisePhone('020 7946 0958', 'ZZ')).toBeNull()
  })
  it('rejects garbage, short and long numbers', () => {
    for (const [raw, region] of [
      ['', 'GB'], ['hello', 'GB'], ['1-800-FLOWERS', 'US'], ['+', null], ['++44 20 7946 0958', null], ['*86', 'US'],
      ['555-0142', 'US'], ['+1 055 555 0142', null], ['+1 303 555 01429', null], ['+44 1234', null],
      ['+44 1234 5678 9012 3456', null], ['+0 44 20 7946 0958', null], ['0 20 7946 0958', 'ES'], ['00', 'GB'],
    ] as [string, string | null][]) expect(normalisePhone(raw, region), raw).toBeNull()
  })
})

describe('regionFromLocale', () => {
  it('takes the region subtag when REGIONS knows it', () => {
    expect(regionFromLocale('en-US')).toBe('US')
    expect(regionFromLocale('fr_CA')).toBe('CA')
    expect(regionFromLocale('zh-Hant-TW')).toBe('TW')
    expect(regionFromLocale('en_GB.UTF-8')).toBe('GB')
    expect(regionFromLocale('de-de')).toBe('DE')
    expect(regionFromLocale('en-UK')).toBe('GB')
    expect(regionFromLocale('en-US-u-ca-gregory')).toBe('US')
    expect(regionFromLocale('es-419')).toBeNull()
    expect(regionFromLocale('en')).toBeNull()
    expect(regionFromLocale('en-ZZ')).toBeNull()
    expect(regionFromLocale('')).toBeNull()
    expect(regionFromLocale(null)).toBeNull()
    expect(regionFromLocale(undefined)).toBeNull()
  })
  it('covers at least 80 regions', () => {
    expect(Object.keys(REGIONS).length).toBeGreaterThanOrEqual(80)
    for (const [code, reg] of Object.entries(REGIONS)) {
      expect(code, code).toMatch(/^[A-Z]{2}$/)
      expect(reg.cc, code).toMatch(/^[1-9]\d{0,2}$/)
    }
  })
})

describe('hashContacts', () => {
  it('writes one number three ways as one hash', () => {
    const out = hashContacts({ phones: ['020 7946 0958', '+44 (0)20 7946 0958', '0044 20 7946 0958'], emails: [] }, 'GB')
    expect(out).toEqual({ hashes: [contactHash('phone', '+442079460958')], phones: 1, emails: 0, skipped: 0 })
  })
  it('drops invalid entries, ignores blanks, sorts and counts', () => {
    const out = hashContacts({
      phones: ['07700 900123', '', '  ', 'not a number', '+33 6 12 34 56 78'],
      emails: ['A@Example.org', 'a@example.org ', 'broken@', 'b@example.org'],
    }, 'GB')
    expect(out.phones).toBe(2)
    expect(out.emails).toBe(2)
    expect(out.skipped).toBe(2)
    expect(out.hashes).toHaveLength(4)
    expect(out.hashes).toEqual([...out.hashes].sort())
    expect(out.hashes).toContain(contactHash('email', 'a@example.org'))
    expect(out.hashes).toContain(contactHash('phone', '+33612345678'))
  })
  it('does not depend on the order of the address book', () => {
    const phones = ['07700 900123', '020 7946 0958', '+1 303 555 0142'], emails = ['x@y.org', 'z@y.org']
    const a = hashContacts({ phones, emails }, 'GB'), b = hashContacts({ phones: [...phones].reverse(), emails: [...emails].reverse() }, 'GB')
    expect(a).toEqual(b)
  })
  it('caps phones first, then emails, keeping the smallest hashes', () => {
    const phones = Array.from({ length: 10 }, (_, i) => `+44 7700 9001${String(i).padStart(2, '0')}`)
    const emails = Array.from({ length: 10 }, (_, i) => `p${i}@example.org`)
    const out = hashContacts({ phones, emails }, null, 12)
    expect(out.hashes).toHaveLength(12)
    expect(out).toMatchObject({ phones: 10, emails: 2, skipped: 8 })
    const emailHashes = emails.map(e => contactHash('email', e)).sort()
    expect(out.hashes.filter(h => emailHashes.includes(h))).toEqual(emailHashes.slice(0, 2))
    expect(hashContacts({ phones, emails }, null, 4)).toMatchObject({ phones: 4, emails: 0, skipped: 16 })
    expect(hashContacts({ phones, emails }, null, 0).hashes).toEqual([])
  })
  it('hashes 2,000 typical contacts quickly', () => {
    const phones = Array.from({ length: 1500 }, (_, i) => `07700 ${String(900000 + i)}`)
    const emails = Array.from({ length: 500 }, (_, i) => `Friend.${i}+notes@Example.org`)
    const t = performance.now()
    const out = hashContacts({ phones, emails }, 'GB')
    const ms = performance.now() - t
    console.log(`hashContacts, 2,000 values: ${ms.toFixed(1)} ms`)
    expect(out.hashes).toHaveLength(2000)
    expect(ms).toBeLessThan(500)
  })
})

describe('ownContactHashes', () => {
  it('hashes what was typed', () => {
    const out = ownContactHashes('07700 900123', ' Me@Example.org', 'GB')
    expect(out.errors).toEqual({})
    expect(out.hashes).toEqual([contactHash('phone', '+447700900123'), contactHash('email', 'me@example.org')].sort())
  })
  it('explains what it could not read, and skips empty fields', () => {
    expect(ownContactHashes('12', 'me@', 'US')).toEqual({
      hashes: [],
      errors: {
        phone: 'That does not look like a phone number. Include the country code, such as +1.',
        email: 'That does not look like an email address.',
      },
    })
    expect(ownContactHashes('020 7946 0958', null, null).errors.phone).toBe('That does not look like a phone number. Include the country code, such as +44.')
    expect(ownContactHashes(null, '  ', 'GB')).toEqual({ hashes: [], errors: {} })
  })
})
