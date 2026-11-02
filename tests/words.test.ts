import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const words: Record<string, [string, string][]> = JSON.parse(readFileSync(path.resolve(__dirname, '../data/words.json'), 'utf8'))
const codeOf = (key: string, word: string) => words[key]?.find(([w]) => w === word)?.[1]

describe('data/words.json', () => {
  it('tags Darby’s own renderings from the Greek of the verse', () => {
    // Acts 21:31, "a representation came to the chiliarch of the band": χιλίαρχος and σπεῖρα, which ebible left bare
    expect(codeOf('44.21.31', 'chiliarch')).toBe('G5506')
    expect(codeOf('44.21.31', 'band')).toBe('G4686')
    expect(codeOf('41.6.21', 'chiliarchs')).toBe('G5506')
    expect(codeOf('43.18.12', 'chiliarch')).toBe('G5506')
    expect(Object.entries(words).filter(([k]) => +k.split('.')[0] >= 40).flatMap(([, ws]) => ws).filter(([w, c]) => /^chiliarchs?$/.test(w) && c === 'G5506').length).toBeGreaterThanOrEqual(20)
  })

  it('gives a number to no word the Greek does not have it for', () => {
    // Matt 26:74, "the cock crew": one ἀλέκτωρ, and it is the cock's
    expect(codeOf('40.26.74', 'cock')).toBe('G220')
    expect(codeOf('40.26.74', 'crew')).toBeUndefined()
    // Matt 5:15 and Luke 11:33: the lamp-stand is λυχνία, one word as ebible would write it; μόδιος is the bushel
    expect(codeOf('40.5.15', 'lamp-stand')).toBe('G3087')
    expect(codeOf('42.11.33', 'lamp-stand')).toBe('G3087')
    expect(codeOf('40.5.15', 'stand')).toBeUndefined()
    // Matt 7:2: ebible tags "measure" μετρέω, whose rendering "mete" is; μέτρον, left over, is not "mete"
    expect(codeOf('40.7.2', 'mete')).toBeUndefined()
    // Matt 21:33: ἐκδίδωμι is "let out", not "left" the country
    expect(codeOf('40.21.33', 'left')).toBeUndefined()
    // Matt 21:42: they that "builded" is οἰκοδομέω; γωνία is the corner-stone
    expect(codeOf('40.21.42', 'builded')).toBe('G3618')
    expect(codeOf('40.21.42', 'corner-stone')).toBe('G1137')
  })

  it('makes one entry of the words that render one Greek word, and two of a word said twice', () => {
    expect(codeOf('40.4.23', 'glad tidings')).toBe('G2098')
    expect(codeOf('40.11.19', 'tax-gatherers')).toBe('G5057')
    expect(words['43.3.3'].filter(([w]) => /^verily$/i.test(w))).toEqual([['Verily', 'G281'], ['verily', 'G281']])
  })

  it('keeps ebible’s own tags as they were', () => {
    expect(words['43.3.16'].slice(0, 6)).toEqual([['For', ''], ['God', 'G2316'], ['so', ''], ['loved', 'G25'], ['the', ''], ['world', 'G2889']])
    expect(codeOf('44.21.31', 'seeking')).toBe('G2212')
  })
})
