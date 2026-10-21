import { useCallback, useEffect, useState } from 'react'
import { Linking, Platform, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import type { Stats } from '@shared/types'
import { formatRef, type Ref } from '@shared/ref'
import { ownNumber } from '@shared/texts'
import { presentVotd, votdFor } from '@shared/votd'
import { book as bookMeta, fetchChapter } from '../../src/lib/bible'
import { dayLine } from '../../src/lib/week'
import { loadPosition, localPosition, type Position } from '../../src/hooks/usePosition'
import { fetchStats } from '../../src/hooks/useStreakAlive'
import { useAuth } from '../../src/store/auth'
import { usePref } from '../../src/store/prefs'
import { useInks } from '../../src/hooks/useTheme'
import { useDesktop } from '../../src/hooks/useDesktop'
import { face, proseStyle } from '../../src/theme'
import StreakCard from '../../src/components/StreakCard'
import { ThemeStrip } from '../../src/components/ThemeGallery'
import { Card, Enter, Grow, H2, ListRow, Numeral, Row, Screen, Spinner, T, TYPE } from '../../src/components/ui'
import { useArrivalDelay } from '../../src/components/motion/home'
import { FadeSwap } from '../../src/components/motion/nav'
import { tourRef } from '../../src/store/tour'
import { loadFriends, loadFriendsCached, type FriendsOverview } from '../../src/lib/friends'
import { noteInvitesShown, onInviteNews } from '../../src/lib/inviteNotice'
import HomeFriends from '../../src/components/friends/HomeFriends'
import SignInCard from '../../src/components/SignInCard'
import PathCard from '../../src/components/PathCard'
import Wordmark from '../../src/components/Wordmark'
import UpdateLine from '../../src/components/UpdateLine'
import ReviewAsk from '../../src/components/ReviewAsk'
import { anyLocalRead, refreshPath, usePath } from '../../src/lib/paths'
import { signInPromptBelowLibrary } from '../../src/lib/jot'
import { pathTitle } from '@shared/paths'
import { countWords } from '../../src/lib/pathWords'
import { useEdition } from '../../src/lib/edition'
import { authorShown, hasChronology } from '../../src/lib/editionCore'
import { authorNames, enabledAuthors } from '@shared/ministry'
import { BRAND, NOUN } from '@shared/brand'
import { t } from '@shared/i18n'
import { policyPath } from '../../src/lib/credits'

/**
 * Home opens on the text itself: today's verse as the screen's one solid accent block, then the chapter to go back
 * to (its rubric numeral), the streak, the library and a one-row theme switcher. One entrance sequence, in that order;
 * a block whose data lands after the sequence has begun joins it where it stands rather than waiting out its slot.
 */
export default function Home() {
  const router = useRouter()
  const edition = useEdition()
  const { user, ready } = useAuth()
  const font = usePref('font'), reduce = usePref('reduceMotion')
  const c = useInks()
  const desktop = useDesktop()
  const [pos, setPos] = useState<Position | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [votd, setVotd] = useState<{ ref: Ref; text: string } | null>(null)
  const [friends, setFriends] = useState<FriendsOverview | null>(null)
  /** A chapter has been finished on this device; null until asked. */
  const [readAny, setReadAny] = useState<boolean | null>(null)

  const uid = user?.id
  useFocusEffect(useCallback(() => {
    if (!ready) return
    let cancelled = false
    let settled = false
    // first paint uses this device's copy rather than waiting on the network; the server's replaces it when it lands
    if (uid) localPosition().then(p => { if (!cancelled && !settled && p) setPos(cur => cur ?? p) })
    loadPosition(!!uid).then(p => { settled = true; if (!cancelled) setPos(p) })
    if (uid) fetchStats().then(s => { if (!cancelled) setStats(s) }).catch(() => {})
    else setStats(null)
    if (uid) loadFriendsCached().then(f => { if (!cancelled) setFriends(f) }).catch(() => {})
    else setFriends(null)
    anyLocalRead().then(r => { if (!cancelled) setReadAny(r) })
    // the path card moves by what this device saw credited or marked; what it did not see is asked for on every return
    void refreshPath()
    return () => { cancelled = true }
  }, [ready, uid]))

  // an invite arriving while Home is open shows on the Friends card at once
  useEffect(() => onInviteNews(() => { if (uid) loadFriends().then(setFriends).catch(() => {}) }), [uid])
  useEffect(() => { if (friends) noteInvitesShown(friends.incoming) }, [friends])

  useEffect(() => {
    const ref = votdFor()
    fetchChapter(ref.book, ref.chapter).then(ch => {
      const text = presentVotd(ch.verses.filter(v => v.v >= ref.v1 && v.v <= (ref.v2 ?? ref.v1)).map(v => v.t.trim()).join(' '))
      setVotd({ ref, text })
    }).catch(() => {})
  }, [])

  const open = (r: { book: number; chapter: number; verse?: number }) => router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(r.book), chapter: String(r.chapter), v: r.verse ? String(r.verse) : '' } })
  const readerName = usePref('readerName')
  const weekday = dayLine(new Date(), readerName)
  const votdAt = useArrivalDelay(180, !!votd)
  // while a path is on, its card takes the Continue tile's place (docs/PATHS.md rule 3: Home shows one card)
  const path = usePath()
  const pathOn = !!(path.state && path.progress)
  const posAt = useArrivalDelay(160, !!pos || pathOn)
  const streakAt = useArrivalDelay(220, !!(user && stats))
  const streakSlot = (
    <View ref={tourRef('home-streak')}>
      {user && stats ? <Enter delay={streakAt}><StreakCard streak={stats.streak} delay={reduce ? 0 : streakAt} /></Enter> : user ? null : (
        <Enter delay={220}>
          <SignInCard title={t('Keep a daily reading streak')} text={t('Sign in to track your days and read with a group.')} />
        </Enter>
      )}
    </View>
  )

  return (
    <Screen safeTop animate={false}>
      <Enter>
        <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <Wordmark size={TYPE.hero} />
          <T small muted numberOfLines={1} style={{ flexShrink: 1 }}>{weekday}</T>
        </Row>
      </Enter>

      <Grow from={0.94} delay={60}>
        <Card ref={tourRef('home-votd')} tone="accent" style={{ padding: 24, gap: 18, minHeight: 200 }} onPress={votd ? () => open({ book: votd.ref.book, chapter: votd.ref.chapter, verse: votd.ref.v1 }) : undefined}
          accessibilityLabel={votd ? t('Today’s verse, {ref}. Open the chapter', { ref: formatRef(votd.ref) }) : undefined}>
          {votd ? <Enter delay={votdAt}><T bold style={{ color: c.accentText }}>{formatRef(votd.ref)}</T></Enter> : <T bold> </T>}
          {votd ? (
            <Enter delay={votdAt}>
              <Text style={{ color: c.accentText, ...proseStyle(font, TYPE.hero, 32 / TYPE.hero) }}>{votd.text}</Text>
            </Enter>
          ) : <Spinner color={c.accentText} />}
          <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <T small style={{ color: c.accentText, opacity: 0.8 }}>{t('Today’s verse')}</T>
            {votd ? (
              <Enter delay={votdAt} rise={0}>
                <View style={{ backgroundColor: c.accentText, borderRadius: 18, height: 36, paddingHorizontal: 16, justifyContent: 'center' }}>
                  <T small bold style={{ color: c.accent }}>{t('Read the chapter')}</T>
                </View>
              </Enter>
            ) : null}
          </Row>
        </Card>
      </Grow>

      {pathOn ? (
        <Enter delay={posAt}>
          <PathCard path={path} delay={posAt} onOpen={open} onPaths={() => router.push('/paths')} />
        </Enter>
      ) : pos ? (
        <Enter delay={posAt}>
          {/* the server's position replacing this device's first guess swaps in place rather than jumping */}
          <FadeSwap k={`${pos.book}.${pos.chapter}`}>
            <Card onPress={() => open(pos)} accessibilityLabel={t('Continue reading {ref}', { ref: formatRef({ book: pos.book, chapter: pos.chapter }) })} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, paddingLeft: 22 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T small muted>{t('Continue reading')}</T>
                <Text numberOfLines={1} style={{ color: c.text, fontSize: 24, ...face('serif', { bold: true }) }}>{bookMeta(pos.book).name}</Text>
              </View>
              <Numeral n={ownNumber(pos.book, pos.chapter, 1).c} size={56} dyslexic={font === 'dyslexic'} />
            </Card>
          </FadeSwap>
        </Enter>
      ) : null}

      {/* the streak card, or the sign-in prompt: above the library once a chapter has been finished here, below it before
          (a reader who has not read yet is not sold a streak before the books; the tour finds it either way) */}
      {readAny === null || signInPromptBelowLibrary(!!user, readAny) ? null : streakSlot}

      {/* on the desktop Library and Together stand side by side, Library first, the same order as the column */}
      <Enter delay={280} style={desktop ? { flexDirection: 'row', alignItems: 'flex-start', gap: 20 } : { gap: 12 }}>
        {/* flex 1 only in the row: in the column, on the web, a flex-basis of 0 collapses a block to no height */}
        <View style={{ flex: desktop ? 1 : undefined, gap: 12 }}>
        <H2>{t('Library')}</H2>
        <Card style={{ gap: 0, paddingVertical: 8 }}>
          <ListRow ref={tourRef('home-bookmarks')} icon="bookmark" label={t('Bookmarks')} onPress={() => router.push('/bookmarks')} />
          <ListRow icon="list" label={NOUN.Many} detail={t('Your studies')} onPress={() => router.push('/outlines')} />
          {hasChronology(edition) ? <ListRow ref={tourRef('home-chronology')} icon="clock" label={t('Chronological table')} detail={t('Kings and prophets of Judah and Israel')} onPress={() => router.push('/chronology')} /> : null}
          <ListRow ref={tourRef('home-dictionary')} icon="dictionary" label={t('Dictionary and concordance')} detail={t('Morrish’s dictionary, Strong’s concordance')} onPress={() => router.push('/dictionary')} />
          <ListRow ref={tourRef('home-ministry')} icon="companion" label={t('Ministry')} detail={authorNames(enabledAuthors().filter(a => !authorShown(a.id, edition)).map(a => a.id))} onPress={() => router.push('/companion')} />
          <ListRow icon="stack" label={t('Paths')} detail={pathOn && path.state && path.progress ? `${pathTitle(path.state)} · ${countWords(path.progress)}` : t('Reading plans, no dates unless you set one')} onPress={() => router.push('/paths')} />
        </Card>
        {/* before the first finished chapter the sign-in card sits under the Library column (rule above) */}
        {readAny !== null && signInPromptBelowLibrary(!!user, readAny) ? streakSlot : null}
        </View>
        <View ref={tourRef('home-together')} style={{ flex: desktop ? 1 : undefined, gap: 12 }}>
        <H2>{t('Together')}</H2>
        {/* friends only once there are some (or an invite): otherwise one quiet line, and nothing while invites are off */}
        {user && friends && (friends.friends.length || friends.incoming.length) ? <HomeFriends data={friends} uid={user.id} delay={280} /> : null}
        <Card style={{ gap: 0, paddingVertical: 8 }}>
          <ListRow icon="users" label={t('Reading groups')} detail={t('Start one, or join with a code')} onPress={() => router.push('/groups')} />
          {user && friends && !friends.friends.length && !friends.incoming.length && friends.settings.invites
            ? <ListRow icon="invite" label={t('Invite a friend')} detail={t('Someone you know, by their handle or your code')} onPress={() => router.push('/friends')} /> : null}
        </Card>
        </View>
      </Enter>

      {/* only while the owner has an ask running and this reader has read enough (rs/src/review_ask.rs) */}
      <ReviewAsk />

      <Enter delay={340} style={{ gap: 8 }}>
        <H2>{t('Theme')}</H2>
        <ThemeStrip onMore={() => router.push('/themes')} />
      </Enter>

      <UpdateLine />

      {Platform.OS === 'web' && (
        <View style={{ paddingTop: 8, gap: 4 }}>
          <T small muted>{BRAND.fullName}</T>
          <Row style={{ gap: 14 }}>
            <Text accessibilityRole="link" style={{ color: c.muted, fontSize: TYPE.small, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(policyPath('/privacy'))}>{t('Privacy policy')}</Text>
            <Text accessibilityRole="link" style={{ color: c.muted, fontSize: TYPE.small, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(policyPath('/terms'))}>{t('Terms')}</Text>
            <Text accessibilityRole="link" style={{ color: c.muted, fontSize: TYPE.small, textDecorationLine: 'underline' }} onPress={() => Linking.openURL('/copyright')}>{t('Copyright')}</Text>
          </Row>
        </View>
      )}
    </Screen>
  )
}
