import { ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { BOOKS } from '@shared/books'
import { groupBooks, groupNamed } from '@shared/bookGroups'
import { t } from '@shared/i18n'
import { Card, Chip, T } from './ui'

/** A search that names a group of books ("prophecies", "the gospels"): its books, one tap each to the first chapter.
 *  Nothing for any other search. */
export default function BookGroupCard({ query }: { query: string }) {
  const router = useRouter()
  const g = groupNamed(query.replace(/"/g, ''))
  if (!g) return null
  return (
    <Card style={{ gap: 8, paddingVertical: 12 }}>
      <T small muted>{t(g.name)}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
        {groupBooks(g).map(n => (
          <Chip key={n} label={BOOKS[n - 1].name} accessibilityLabel={t('Open {book}', { book: BOOKS[n - 1].name })}
            onPress={() => router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(n), chapter: '1', v: '' } })} />
        ))}
      </ScrollView>
    </Card>
  )
}
