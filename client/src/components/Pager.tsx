import { t, tn } from '@shared/i18n'
import { Button, Chip, Row, T } from './ui'

/** Previous and Next either side of "Page 2 of 7": the dictionary's lists and the word sheet's occurrences. */
export default function Pager({ page, pages, onPage, busy = false }: { page: number; pages: number; onPage: (p: number) => void; /** a page is on its way: both buttons wait */ busy?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
      <Button small title={t('‹ Previous')} accessibilityLabel={t('Previous page')} disabled={busy || page <= 1} onPress={() => onPage(page - 1)} />
      <T small muted>{t('Page {page} of {pages}', { page, pages })}</T>
      <Button small title={t('Next ›')} accessibilityLabel={t('Next page')} disabled={busy || page >= pages} onPress={() => onPage(page + 1)} />
    </Row>
  )
}

/** The counted label for each noun a caller passes, as a whole phrase so a translation can order and inflect it. */
const COUNTED: Partial<Record<string, (n: number, label: string) => string>> = {
  headword: (n, label) => tn(n, '{label}, {n} headword', '{label}, {n} headwords', { label }),
  occurrence: (n, label) => tn(n, '{label}, {n} occurrence', '{label}, {n} occurrences', { label }),
}

/** A group of a paged list (the dictionary's "Ab", a book of the occurrences): its label, then how many it holds. */
export function CountChip({ label, count, noun, on, onPress, accessibilityLabel }: { label: string; count: number; noun: [one: string, many: string]; on: boolean; onPress: () => void; accessibilityLabel?: string }) {
  const counted = COUNTED[noun[0]]
  return <Chip tab label={label} detail={count.toLocaleString()} on={on} onPress={onPress} accessibilityLabel={counted ? counted(count, accessibilityLabel ?? label) : `${accessibilityLabel ?? label}, ${count} ${count === 1 ? noun[0] : noun[1]}`} />
}
