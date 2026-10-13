import { Button, Chip, Row, T } from './ui'

/** Previous and Next either side of "Page 2 of 7": the dictionary's lists and the word sheet's occurrences. */
export default function Pager({ page, pages, onPage, busy = false }: { page: number; pages: number; onPage: (p: number) => void; /** a page is on its way: both buttons wait */ busy?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
      <Button small title="‹ Previous" accessibilityLabel="Previous page" disabled={busy || page <= 1} onPress={() => onPage(page - 1)} />
      <T small muted>Page {page} of {pages}</T>
      <Button small title="Next ›" accessibilityLabel="Next page" disabled={busy || page >= pages} onPress={() => onPage(page + 1)} />
    </Row>
  )
}

/** A group of a paged list (the dictionary's "Ab", a book of the occurrences): its label, then how many it holds. */
export function CountChip({ label, count, noun, on, onPress, accessibilityLabel }: { label: string; count: number; noun: [one: string, many: string]; on: boolean; onPress: () => void; accessibilityLabel?: string }) {
  return <Chip tab label={label} detail={count.toLocaleString()} on={on} onPress={onPress} accessibilityLabel={`${accessibilityLabel ?? label}, ${count} ${count === 1 ? noun[0] : noun[1]}`} />
}
