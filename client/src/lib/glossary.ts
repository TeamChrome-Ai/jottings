/**
 * Darby's glossary, bundled on every platform (35 KB of JSON: the terms, a sentence each, and the sentence of his
 * they rest on). shared/glossary.ts has the shape and the resolver; data/glossary/SOURCE.md says where it comes from.
 */
import { buildGlossary, type Glossary, type GlossaryEntry } from '@shared/glossary'

let glossary: Glossary | null = null
export function darbyGlossary(): Glossary {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  glossary ??= buildGlossary(require('../../../data/glossary/darby.json') as GlossaryEntry[])
  return glossary
}
