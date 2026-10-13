/**
 * Web: the word under a click in a paragraph, from the caret position at the point (no node per word). The offset is
 * taken across the whole paragraph (a Range from its start to the caret), so a two-word term split by italics or a
 * line break still reads whole. Null when the click is on a link or a footnote caller (they answer for themselves),
 * while text is selected, or off the text.
 */
import { wordAtOffset, type WordTap } from '@shared/wordTap'

export function wordAtPoint(root: Element, target: EventTarget | null, x: number, y: number): WordTap | null {
  if (target instanceof Element && target.closest('[role="link"], [role="button"], a')) return null
  const doc = root.ownerDocument
  const sel = doc.getSelection()
  if (sel && !sel.isCollapsed) return null
  let node: Node | null = null, offset = 0
  if (typeof doc.caretPositionFromPoint === 'function') { const p = doc.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; offset = p.offset } }
  else if (typeof doc.caretRangeFromPoint === 'function') { const r = doc.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; offset = r.startOffset } }
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null
  if (node.parentElement?.closest('[role="link"], [role="button"], a')) return null
  const range = doc.createRange()
  range.setStart(root, 0)
  range.setEnd(node, offset)
  return wordAtOffset(root.textContent ?? '', range.toString().length)
}
