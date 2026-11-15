// Stand-in recordings for the device checks: a chapter read by espeak-ng, with the marks file the player times its
// verses from, so an emulator and a server on the build box can read aloud with no recording from the real voices.
// Each verse is spoken on its own and the clips are joined, so a verse's start and end are exact; there are no word
// marks (the reader lights the verse, not the word) and no spoken heading.
//   node scripts/read-aloud-fixture.mjs <data dir> <book>-<chapter> ...     needs sqlite3, espeak-ng and ffmpeg
// Writes <data dir>/tts/<voice>/<book>-<chapter>.{json,mp3,opus}; VOICE picks the voice's directory (alec), WPM the pace.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [data, ...chapters] = process.argv.slice(2)
if (!data || !chapters.length) { console.error('usage: read-aloud-fixture.mjs <data dir> <book>-<chapter> ...'); process.exit(1) }
const voice = process.env.VOICE ?? 'alec'
const wpm = process.env.WPM ?? '230'
const RATE = 22050
const out = join(data, 'tts', voice)
mkdirSync(out, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'fixture-'))

for (const name of chapters) {
  const [book, chapter] = name.split('-').map(Number)
  const rows = execFileSync('sqlite3', ['-json', join(data, 'scripture.db'), `select verse, text from verses where book=${book} and chapter=${chapter} order by verse`], { encoding: 'utf8' })
  const verses = JSON.parse(rows || '[]')
  if (!verses.length) { console.error(`${name}: no such chapter`); process.exit(1) }
  const pcm = []
  const marks = []
  let at = 0
  for (const { verse, text } of verses) {
    const wav = join(work, 'v.wav')
    execFileSync('espeak-ng', ['-s', wpm, '-w', wav, text.replace(/[[\]]/g, '')])
    // espeak-ng writes 16-bit mono at 22050 Hz after a 44-byte header
    const samples = readFileSync(wav).subarray(44)
    const ms = Math.round(samples.length / 2 / RATE * 1000)
    marks.push({ v: verse, start: at, end: at + ms, words: [], parts: [] })
    pcm.push(samples)
    at += ms
  }
  const raw = join(work, 'chapter.pcm')
  writeFileSync(raw, Buffer.concat(pcm))
  const from = ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', raw]
  execFileSync('ffmpeg', [...from, '-b:a', '48k', join(out, `${name}.mp3`)])
  execFileSync('ffmpeg', [...from, '-c:a', 'libopus', '-b:a', '24k', join(out, `${name}.opus`)])
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ voice, book, chapter, duration: at, heading: null, verses: marks }))
  console.log(`${name}: ${verses.length} verses, ${(at / 1000).toFixed(0)} s`)
}
rmSync(work, { recursive: true })
