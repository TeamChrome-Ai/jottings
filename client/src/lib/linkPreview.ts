/**
 * The text card under a link in a jotting: the page's title, a line about it and its host (`GET /api/link-preview`,
 * docs/API.md). The server fetches the page, so the phone never tells a third party who is reading, and there is no
 * picture. Anything that is not a preview (a link kept only on this device while signed out, a page that would not
 * load, one the scan would hide) reads as none, and the plain link stays.
 */
import { get } from './api'

export interface LinkPreview { host: string; title: string; description: string | null }

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}
/** The server's answer as a preview, or null when it has no title to show. */
export function previewOf(body: unknown): LinkPreview | null {
  if (body === null || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const title = clean(b.title, 160), host = clean(b.host, 255)
  return title && host ? { host: host.replace(/^www\./i, ''), title, description: clean(b.description, 280) } : null
}
export const isWebUrl = (url: string): boolean => /^https?:\/\/[^\s/]+/i.test(url)

/** One request per link per launch; the answer (a preview or none) is kept. */
const asked = new Map<string, Promise<LinkPreview | null>>()
export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!isWebUrl(url)) return Promise.resolve(null)
  let p = asked.get(url)
  if (!p) {
    p = get<unknown>(`/link-preview?url=${encodeURIComponent(url)}`).then(previewOf, () => null)
    asked.set(url, p)
    // a failure to reach the server is not "no preview": ask again next time the link is shown
    p.then(v => { if (v === null) asked.delete(url) }, () => {})
  }
  return p
}
