// What a test may count on finding. A copy of this repository can hold the code without the texts it serves and
// without the converters that made them (data/README.md). A test of either says so with a flag from here
// (`describe.skipIf(!HAS_TEXTS)`) and is skipped there; where they are in place every test runs. A file that reads the
// texts as it loads does so in a `beforeAll` behind the same flag. Vitest runs the default export once before the suite
// (vitest.config.ts, globalSetup), so a run with skips says why.
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const at = (file: string) => path.join(ROOT, file)

/** The texts are here: the scripture and, built from it or beside it, the chapter files, the notes, the ministry, the
 *  dictionary and the glossary. The stand-ins a copy without them carries are empty files of the same shapes. */
export const HAS_TEXTS = existsSync(at('data/darby.json'))
/** The converters that made the texts (tools/*.py) are here, with the pages they are tried on (tests/fixtures). */
export const HAS_CONVERTERS = existsSync(at('tools/ministry_convert.py'))

export default function setup() {
  const absent = [!HAS_TEXTS && 'the texts (data/README.md)', !HAS_CONVERTERS && 'the converters that made them'].filter(Boolean)
  if (absent.length) console.log(`\nNot in this copy: ${absent.join('; ')}. The tests of them are skipped (tests/_texts.ts).`)
}
