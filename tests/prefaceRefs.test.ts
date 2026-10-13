import { describe, it, expect } from 'vitest'
import { romanToInt, scanPrefaceRefs } from '../shared/ref'

// "text=book.chapter:verse-verse" per link, as the About screen would draw it
const flat = (s: string) => scanPrefaceRefs(s).map(r => `${s.slice(r.start, r.end)}=${r.ref.book}.${r.ref.chapter}${r.ref.v1 !== undefined ? ':' + r.ref.v1 : ''}${r.ref.v2 !== undefined ? '-' + r.ref.v2 : ''}`)

describe('romanToInt', () => {
  it('reads well-formed numerals and nothing else', () => {
    expect([romanToInt('i'), romanToInt('iv'), romanToInt('xix'), romanToInt('xxviii'), romanToInt('XV'), romanToInt('cl')]).toEqual([1, 4, 19, 28, 15, 150])
    expect([romanToInt(''), romanToInt('ill'), romanToInt('civil'), romanToInt('iiii'), romanToInt('vv')]).toEqual([undefined, undefined, undefined, undefined, undefined])
  })
})

describe('scanPrefaceRefs', () => {
  it('reads roman chapters with the book spelt out or abbreviated', () => {
    expect(flat('interpolate in Matthew xxvii. 49 some words borrowed from John xix. 34, but')).toEqual(['Matthew xxvii. 49=40.27:49', 'John xix. 34=43.19:34'])
    expect(flat('In Luke ii. 14, however')).toEqual(['Luke ii. 14=42.2:14'])
    expect(flat('see 1 John ii. 13 and the note, and Rev. xxii. 14.')).toEqual(['1 John ii. 13=62.2:13', 'Rev. xxii. 14=66.22:14'])
    expect(flat('The omission in 1 Cor. ix. 20 of')).toEqual(['1 Cor. ix. 20=46.9:20'])
    expect(flat('putting the imperative in I Cor. xv. 49; though')).toEqual(['I Cor. xv. 49=46.15:49'])
    expect(flat('cf. 1 Sam. xx. 15 (16) in the LXX, for burned up in 2 Pet. iii. 10, by')).toEqual(['1 Sam. xx. 15=9.20:15', '2 Pet. iii. 10=61.3:10'])
    expect(flat('in 1 Chronicles xxix. 20, They')).toEqual(['1 Chronicles xxix. 20=13.29:20'])
  })
  it('links a chapter on its own', () => {
    expect(flat('the beginning of John viii, and the last verses of Mark xvi. In the first')).toEqual(['John viii=43.8', 'Mark xvi=41.16'])
    expect(flat('Thus in Acts i we have ordained; in John v we have judgment; save 1 Peter ii, the building')).toEqual(['Acts i=44.1', 'John v=43.5', '1 Peter ii=60.2'])
    expect(flat('employed in Romans ii for sinning')).toEqual(['Romans ii=45.2'])
  })
  it('reads the arabic forms with a dot', () => {
    expect(flat('An exception may be noted in Psalm 147.1. For it see the note at Genesis 1.1.')).toEqual(['Psalm 147.1=19.147:1', 'Genesis 1.1=1.1:1'])
    expect(flat('compare the forms in Isaiah 7.7,11.] as compared with I AM, Exod. 3.14. Compare also Isa. 41.4, &c.')).toEqual(['Isaiah 7.7=23.7:7', '11=23.7:11', 'Exod. 3.14=2.3:14', 'Isa. 41.4=23.41:4'])
    expect(flat('verses such as Ex. 12. 40, 41; Judges 11. 26; 1 Kings 6. 1; which')).toEqual(['Ex. 12. 40=2.12:40', '41=2.12:41', 'Judges 11. 26=7.11:26', '1 Kings 6. 1=11.6:1'])
    expect(flat('(Num. 21. 24-26)')).toEqual(['Num. 21. 24-26=4.21:24-26'])
  })
  it('reads ranges and semicolon lists, the book carried into bare chapters', () => {
    expect(flat('old (Gen. 5. 3 -- 29; 7. 11) 1,656')).toEqual(['Gen. 5. 3 -- 29=1.5:3-29', '7. 11=1.7:11'])
    expect(flat('(Gen. 11. 10–25) 222')).toEqual(['Gen. 11. 10–25=1.11:10-25'])
    expect(flat('(Luke 19. 41-44; 21. 20-24; 23. 28, 29)')).toEqual(['Luke 19. 41-44=42.19:41-44', '21. 20-24=42.21:20-24', '23. 28=42.23:28', '29=42.23:29'])
    expect(flat('Samson judged Israel (Judges 13. 1; 15. 20)')).toEqual(['Judges 13. 1=7.13:1', '15. 20=7.15:20'])
  })
  it('reads the Kurios list: roman chapters after semicolons, verses after commas, (?) and bis between', () => {
    expect(flat('Matt. i. 20, 22, 24; ii. 13, 15, 19; iii. 3; iv. 7, 10; v. 33; xxi. 3 (?), 9, 42.')).toEqual([
      'Matt. i. 20=40.1:20', '22=40.1:22', '24=40.1:24', 'ii. 13=40.2:13', '15=40.2:15', '19=40.2:19', 'iii. 3=40.3:3',
      'iv. 7=40.4:7', '10=40.4:10', 'v. 33=40.5:33', 'xxi. 3=40.21:3', '9=40.21:9', '42=40.21:42',
    ])
    expect(flat('Mark xii. 11, 29 bis, 30, 36; xiii. 20; xvi. 20 (?).')).toEqual(['Mark xii. 11=41.12:11', '29=41.12:29', '30=41.12:30', '36=41.12:36', 'xiii. 20=41.13:20', 'xvi. 20=41.16:20'])
    expect(flat('2 Cor. iii. 17, 18 (peculiar character); vi. 17, 18; x. 17.')).toEqual(['2 Cor. iii. 17=47.3:17', '18=47.3:18', 'vi. 17=47.6:17', '18=47.6:18', 'x. 17=47.10:17'])
  })
  it('ends an entry at the next book even when it starts with a figure', () => {
    expect(flat('1 Peter i. 25; iii. 12 bis, 15. 2 Peter ii. 9 (?), 11; iii. 8. Jude 5, 9. Rev. iv. 8')).toEqual([
      '1 Peter i. 25=60.1:25', 'iii. 12=60.3:12', '15=60.3:15', '2 Peter ii. 9=61.2:9', '11=61.2:11', 'iii. 8=61.3:8', 'Jude 5=65.1:5', '9=65.1:9', 'Rev. iv. 8=66.4:8',
    ])
  })
  it('reads the capital I the scan printed for the figure 1', () => {
    expect(flat('Romans XV. I2, I3: In him')).toEqual(['Romans XV. I2=45.15:12', 'I3=45.15:13'])
    expect(flat('Acts viii. 39 (?); ix. 3I (?); x. 4')).toEqual(['Acts viii. 39=44.8:39', 'ix. 3I=44.9:31', 'x. 4=44.10:4'])
  })
  it('resolves ch. and verse against the reference just before', () => {
    expect(flat("the 'rest' mentioned in Judges 5. 31 must form part of the 'rest' spoken of in ch. 3. 30, especially")).toEqual(['Judges 5. 31=7.5:31', 'ch. 3. 30=7.3:30'])
    expect(flat('mentioned in Acts 13. 20, appears to be a figure, verse 21 being a parenthesis')).toEqual(['Acts 13. 20=44.13:20', 'verse 21=44.13:21'])
    expect(flat('see verse 21 and ch. 3')).toEqual([])
  })
  it('reads a numbered book after a capitalised word', () => {
    expect(flat('In 2 Corinthians 11 we see it. See 1 Peter 3:22; Compare 2 Kings 5:8.')).toEqual(['2 Corinthians 11=47.11', '1 Peter 3:22=60.3:22', '2 Kings 5:8=12.5:8'])
    expect(flat('So 1 Corinthians 11 speaks of it; Is 2 Kings 4 like it?')).toEqual(['1 Corinthians 11=46.11', '2 Kings 4=12.4'])
    expect(flat('Song of Songs 1 and Isaiah 2')).toEqual(['Song of Songs 1=22.1', 'Isaiah 2=23.2'])
  })
  it('reads a commentary’s own shorthand against the book it is on', () => {
    const home = (s: string, h: { book: number; chapter?: number }) => scanPrefaceRefs(s, h).map(r => `${s.slice(r.start, r.end)}=${r.ref.book}.${r.ref.chapter}${r.ref.v1 !== undefined ? ':' + r.ref.v1 : ''}${r.ref.v2 !== undefined ? '-' + r.ref.v2 : ''}`)
    // Darby on Joshua: chapters are Joshua's, a verse the chapter last named, else the section's chapter
    expect(home('In chapter 9 the Gibeonites come (ch. 10:12). Chapter 11 closes it. In verses 13–14 the sun stands.', { book: 6 })).toEqual(['chapter 9=6.9', 'ch. 10:12=6.10:12', 'Chapter 11=6.11', 'verses 13–14=6.11:13-14'])
    expect(home('It is the same in verse 29; vv. 4–6 too.', { book: 1, chapter: 24 })).toEqual(['verse 29=1.24:29', 'vv. 4–6=1.24:4-6'])
    // a reference just before still leads; further off the home book does
    expect(home('Compare Romans 11:28–33. In verse 31 mercy.', { book: 1, chapter: 24 })).toEqual(['Romans 11:28–33=45.11:28-33', 'verse 31=45.11:31'])
    expect(home('as the apostle says in Romans 11:28 of Israel, a people beloved for the fathers’ sakes; and so in chapter 12 here the call.', { book: 1 })).toEqual(['Romans 11:28=45.11:28', 'chapter 12=1.12'])
    // no home: the notices' reading, "chapter" and "verses" are words
    expect(flat('In chapter 9 and verses 13–14')).toEqual([])
    expect(home('verse 4 here', { book: 6 })).toEqual([])
    expect(home('in chapter 99', { book: 6 })).toEqual([])
  })
  it('never links a word that is not a book, or a chapter the book does not have', () => {
    expect(flat('Stow Hill Bible and Tract Depot in 1939; Depot i. 3; the Greek l. 4')).toEqual([])
    expect(flat('and compare Job xxxi. 27; and Herodotus i. 134 for the customs of Persia')).toEqual(['Job xxxi. 27=18.31:27'])
    expect(flat('Length of the captivity 70 years, and up to Nehemiah 80 years 150')).toEqual([])
    expect(flat('Mr. Darby, Scrivener (3rd ed. p.511), Tischendorf in his 8th edition, B L 1 33 69, B, 124, and Stephanus 1550')).toEqual([])
    expect(flat("In 'I,' Heb. ani (the pronoun); See the use of eutheos in Mark. In St. John's writings; Matthew, I believe")).toEqual([])
    expect(flat('as it is, in 1 and 2 Thessalonians; 1 and 2 Corinthians; Romans, and Philemon')).toEqual([])
  })
})
