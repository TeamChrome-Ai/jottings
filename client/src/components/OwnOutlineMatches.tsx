import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { NOUN } from '@shared/brand'
import { searchOwnOutlines, type OutlineMatch } from '../lib/outlineSearch'
import { useAuth } from '../store/auth'
import { Card, ListRow, T } from './ui'

/** Under a search: the reader's own jottings with the same words, the newest few. Nothing when none has them. */
export default function OwnOutlineMatches({ query }: { query: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const [found, setFound] = useState<{ query: string; rows: OutlineMatch[] } | null>(null)
  useEffect(() => {
    let live = true
    void searchOwnOutlines(query.replace(/"/g, ''), !!user, 6).then(rows => { if (live) setFound({ query, rows }) })
    return () => { live = false }
  }, [query, user])
  if (!found || found.query !== query || !found.rows.length) return null
  return (
    <Card style={{ gap: 4, paddingVertical: 12 }}>
      <T small muted>In your {NOUN.many}</T>
      <View style={{ marginHorizontal: -4 }}>
        {found.rows.map(m => (
          <ListRow key={m.id} icon="list" label={m.title || 'Untitled'} detail={m.snippet || undefined}
            onPress={() => router.push({ pathname: '/outlines/[id]', params: { id: String(m.id) } })} />
        ))}
      </View>
    </Card>
  )
}
