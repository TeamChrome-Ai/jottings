import type { FaceKey } from './customFonts'

/**
 * Google Fonts CSS API. One request asks for Regular, Bold and Italic; the API leaves out faces a family does not have
 * and answers 400 when the family name is unknown (names are case sensitive: "EB Garamond", not "Eb Garamond").
 */
export function googleCssUrl(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.trim()).replace(/%20/g, '+')}:ital,wght@0,400;0,700;1,400&display=swap`
}

/**
 * Spellings to try in turn: Title Case with short words capitalised ("eb garamond" → "EB Garamond"), then plain Title
 * Case, and the name as typed first when it has capitals of its own. Each miss costs a request (and, in a browser, a
 * CORS error in the console), so the likely spelling goes first.
 */
export function familyCandidates(input: string): string[] {
  const typed = input.trim().replace(/\s+/g, ' ')
  if (!typed) return []
  const words = typed.split(' ')
  const title = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  const short = words.map((w, i) => (w.length <= 2 && /^[a-z]+$/i.test(w) ? w.toUpperCase() : title[i]))
  const fixes = [short.join(' '), title.join(' ')]
  return [...new Set(typed === typed.toLowerCase() ? [...fixes, typed] : [typed, ...fixes])]
}

export interface FaceSrc { url: string; format: string }
export type GoogleFaces = Partial<Record<FaceKey, FaceSrc>> & { family?: string }

/**
 * Picks one file per face out of the stylesheet. A plain user agent gets one whole TTF per face; a modern browser gets
 * WOFF2 split by script, each block preceded by a `/* latin *\/`-style comment, and then the Latin block is the one
 * kept (the text is English). Faces other than 400 normal, 700 normal and 400 italic are ignored.
 */
export function parseGoogleCss(css: string): GoogleFaces {
  const out: GoogleFaces = {}
  const rank = new Map<FaceKey, number>()
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*{([^}]*)}/g
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const subset = m[1]?.toLowerCase()
    const body = m[2]
    const prop = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);?`, 'i').exec(body)?.[1].trim()
    const style = prop('font-style') ?? 'normal'
    const weight = prop('font-weight') ?? '400'
    const src = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)(?:\s*format\(\s*['"]?([\w-]+)['"]?\s*\))?/i.exec(prop('src') ?? '')
    if (!src) continue
    const key: FaceKey | null = style === 'normal' && weight === '400' ? 'regular' : style === 'normal' && weight === '700' ? 'bold' : style === 'italic' && weight === '400' ? 'italic' : null
    if (!key) continue
    const score = subset === undefined || subset === 'latin' ? 2 : 0
    if ((rank.get(key) ?? -1) >= score) continue
    rank.set(key, score)
    out[key] = { url: src[1], format: (src[2] ?? src[1].split('.').pop() ?? '').toLowerCase() }
    const fam = prop('font-family')?.replace(/^['"]|['"]$/g, '')
    if (fam) out.family = fam
  }
  return out
}
