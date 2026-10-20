import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { CbdIndexRow } from '@shared/cbd'
import type { SectionHit } from '@shared/ministry'
import { t } from '@shared/i18n'
import { loadDictionaryIndex } from '../lib/dictionary'
import { searchSections } from '../lib/ministryLibrary'
import { isSubject, paperCount, subjectArticles } from '../lib/subject'
import { Card, Chip, ListRow, T } from './ui'

/**
 * Under a search: what the dictionary and the ministry have on the same words. One card, at most a row of chips and
 * one line, so the verses stay where they were; nothing at all when neither has anything, and nothing while they
 * load. The dictionary is on the device; the ministry's titles need the server (or a downloaded author) and are
 * simply left out without them.
 */
export default function SubjectLinks({ query }: { query: string }) {
  const router = useRouter()
  const [found, setFound] = useState<{ query: string; rows: CbdIndexRow[]; more: boolean; papers: SectionHit[] } | null>(null)
  useEffect(() => {
    let live = true
    if (!isSubject(query)) { setFound(null); return }
    void Promise.all([loadDictionaryIndex().catch(() => null), searchSections(query.replace(/"/g, '')).catch(() => [] as SectionHit[])]).then(([index, papers]) => {
      if (live) setFound({ query, ...subjectArticles(index, query), papers })
    })
    return () => { live = false }
  }, [query])
  if (!found || found.query !== query || (found.rows.length === 0 && found.papers.length === 0)) return null
  const q = query.replace(/"/g, '').trim()
  const only = found.papers.length === 1 ? found.papers[0] : null
  return (
    <Card style={{ gap: 8, paddingVertical: 12 }}>
      <T small muted>{t('On this subject')}</T>
      {found.rows.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
          {found.rows.map(r => <Chip key={r[0]} label={r[1]} accessibilityLabel={t('Dictionary: {headword}', { headword: r[1] })} onPress={() => router.push({ pathname: '/dictionary', params: { id: r[0] } })} />)}
          {found.more ? <Chip label={t('More…')} accessibilityLabel={t('More in the dictionary')} onPress={() => router.push({ pathname: '/dictionary', params: { q } })} /> : null}
        </ScrollView>
      ) : null}
      {found.papers.length > 0 ? (
        <View style={{ marginHorizontal: -4 }}>
          {only
            ? <ListRow icon="companion" label={only.title} detail={t('Ministry · {work}', { work: only.work.title })} onPress={() => router.push({ pathname: '/companion', params: { author: only.author, work: only.work.id, n: String(only.n) } })} />
            : <ListRow icon="companion" label={t('Ministry')} detail={t('{papers} with “{q}” in the title', { papers: paperCount(found.papers.length), q })} onPress={() => router.push({ pathname: '/companion', params: { q } })} />}
        </View>
      ) : null}
    </Card>
  )
}
