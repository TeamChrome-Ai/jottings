import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, BackHandler, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import { formatRef } from '@shared/ref'
import { WHATS_NEW, type NewsItem } from '@shared/whatsNew'
import { peekText } from '../lib/text'
import { userSpeed } from '../lib/motionSpeed'
import type { Track } from '../lib/overture'
import { ANSWER, ASK, HAND, LEAVE_MS, SCENES, STAGES, STILL, newsMotion, shapeOf, type NewsStage } from '../lib/whatsNew'
import { useColors, useFill } from '../hooks/useTheme'
import { useReduceMotion } from '../store/prefs'
import { face } from '../theme'
import Icon from './Icon'
import SkipPill from './SkipPill'
import { makeDriver, type Bound, type Driver, type Playback } from './motion/track'
import { fixedSpeed } from './motion/speed'
import { Card, Chip, RADIUS, SPACE, T, TYPE } from './ui'

/*
 * The news of an update, shown once over Home on the first launch after it (and again from Settings). Three scenes,
 * one for each item of the release (shared/whatsNew.ts), then the version's name:
 *
 *   1. Ask: a question is typed into the library search; verses, phrases and related subjects rise under it.
 *   2. Answer: an answer settles a sentence at a time, each with its numbered marker; one marker opens its paragraph.
 *   3. A hand: the reader asks for larger text, the line grows, and Undo is offered.
 *
 * Each scene is a vignette drawn here with the app's own parts; nothing is fetched and no model is asked. The timeline
 * is lib/whatsNew.ts, at the reader's Animation speed; every moving part is a keyframe track played by
 * motion/track.ts, a stage at a time, so a tap ends the scene in hand and starts the next. Reduce animation gets the
 * three scenes as still pages, crossfaded.
 */

type Tracks = Record<string, Track | Track[]>
type BoundOf<T> = { [K in keyof T]: T[K] extends Track[] ? Bound[] : Bound }
function bindAll<T extends Tracks>(D: Driver<NewsStage>, stage: NewsStage, tracks: T): BoundOf<T> {
  return Object.fromEntries(Object.entries(tracks).map(([name, v]) => [name, Array.isArray(v) ? v.map(x => D.bind(stage, x)) : D.bind(stage, v)])) as BoundOf<T>
}
/** Every moving part bound to a driver, for the question as the reader's language has it. */
function motion(question: string, speed: number) {
  const M = newsMotion(shapeOf(question), speed)
  const D = makeDriver<NewsStage>(M.lengths)
  return { D, ask: bindAll(D, 'ask', M.ask), answer: bindAll(D, 'answer', M.answer), hand: bindAll(D, 'hand', M.hand), close: bindAll(D, 'close', M.close) }
}
type Motion = ReturnType<typeof motion>

/** The scenes themselves, loaded only when they are due (components/FirstRun.tsx). */
export default function WhatsNew({ onClose }: { replay: boolean; onClose: () => void }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const insets = useSafeAreaInsets()
  const { width: W, height: H } = useWindowDimensions()
  // a run keeps the speed it started at
  const [speed] = useState(userSpeed)
  const m = useMemo(() => (reduce ? null : motion(ASK.question, speed)), [reduce, speed])
  const clocks = useRef({ skip: new Animated.Value(reduce ? 1 : 0), out: new Animated.Value(1), pages: SCENES.map((_, i) => new Animated.Value(i === 0 ? 1 : 0)) }).current
  /** The stage playing (STAGES), or the still page shown (SCENES). */
  const [at, setAt] = useState(0)
  const anim = useRef<Playback | null>(null)
  const closing = useRef(false)

  const leave = useCallback(() => {
    if (closing.current) return
    closing.current = true
    anim.current?.stop()
    if (reduce) { onClose(); return }
    Animated.timing(clocks.out, fixedSpeed({ toValue: 0, duration: LEAVE_MS / speed, easing: Easing.out(Easing.cubic), useNativeDriver: true })).start(() => onClose())
  }, [reduce, clocks, speed, onClose])

  // ---- motion: one stage at a time, each handing on to the next ----
  const play = useCallback((i: number) => {
    if (!m || closing.current) return
    if (i >= STAGES.length) { leave(); return }
    setAt(i)
    anim.current = m.D.play([STAGES[i]], () => play(i + 1))
  }, [m, leave])
  useEffect(() => {
    if (!m) return
    play(0)
    return () => anim.current?.stop()
  }, [m, play])
  useEffect(() => {
    Animated.timing(clocks.skip, fixedSpeed({ toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true })).start()
  }, [clocks])

  // ---- a tap: on to the next scene, or out after the last ----
  const next = useCallback(() => {
    if (closing.current) return
    if (m) {
      anim.current?.stop()
      m.D.finish([STAGES[at]])
      play(at + 1)
      return
    }
    if (at >= SCENES.length - 1) { leave(); return }
    Animated.parallel([0, 1].map(k => Animated.timing(clocks.pages[at + k], { toValue: k, duration: STILL.cross, easing: Easing.inOut(Easing.quad), useNativeDriver: true }))).start()
    setAt(at + 1)
  }, [m, at, play, leave, clocks])
  // Reduce animation: a still page stays until it is tapped or its time runs out
  useEffect(() => {
    if (!reduce) return
    const timer = setTimeout(next, STILL.page)
    return () => clearTimeout(timer)
  }, [reduce, next])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { leave(); return true })
    if (Platform.OS !== 'web' || typeof window === 'undefined') return () => sub.remove()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') leave() }
    window.addEventListener('keydown', key)
    return () => { sub.remove(); window.removeEventListener('keydown', key) }
  }, [leave])

  const narrow = W < 380
  // a scene's block is centred in what lies between the skip pill and the dots, clear of both by the same margin
  const frame = { top: insets.top + PILL.top + PILL.height + CLEAR, bottom: insets.bottom + DOTS.bottom + DOTS.size + CLEAR, narrow }
  const VIGNETTES = { ask: <Ask b={m?.ask} />, answer: <Answer b={m?.answer} />, hand: <Hand b={m?.hand} /> }
  const closeLine: TextStyle = { color: c.text, fontSize: narrow ? 30 : 36, letterSpacing: -0.3, ...face('serif', { bold: true }) }

  return (
    <Animated.View testID="whats-new" accessibilityViewIsModal style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity: clocks.out }]}>
      <Pressable accessible={false} focusable={false} onPress={next} style={StyleSheet.absoluteFill}>
        {WHATS_NEW.items.map((item, k) => (
          <Scene key={item.id} k={k} item={item} on={at === k} frame={frame} b={m?.[item.scene]} still={m ? null : { opacity: clocks.pages[k] }}>
            {VIGNETTES[item.scene]}
          </Scene>
        ))}
        {m ? (
          <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none', alignItems: 'center', justifyContent: 'center', paddingBottom: Math.round(H * 0.08) }]}>
            <Part b={m.close.line} testID="news-close">
              <Text accessibilityRole="header" style={closeLine}>{BRAND.name} <Text style={{ color: c.accent }}>{WHATS_NEW.version}</Text></Text>
            </Part>
          </View>
        ) : null}
      </Pressable>
      {/* which scene of the three: a tap anywhere moves on */}
      {at < SCENES.length ? (
        <View testID="news-dots" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + DOTS.bottom, flexDirection: 'row', justifyContent: 'center', gap: 7, pointerEvents: 'none' }}>
          {SCENES.map((s, k) => <View key={s} style={{ width: DOTS.size, height: DOTS.size, borderRadius: DOTS.size / 2, backgroundColor: k === at ? c.accent : c.border }} />)}
        </View>
      ) : null}
      <SkipPill onPress={leave} label={t('Skip what is new')} style={{ position: 'absolute', top: insets.top + PILL.top, right: insets.right + 16, opacity: clocks.skip }} />
    </Animated.View>
  )
}

/** Where the skip pill (components/SkipPill.tsx is 28 high) and the dots sit, and how far a scene keeps from each. */
const PILL = { top: 12, height: 28 }, DOTS = { bottom: 18, size: 6 }, CLEAR = 16
const HIDDEN = { opacity: 0 } as const
const noop = () => {}

/** One moving part: a view whose opacity and transform are the driver's. Unbound (Reduce animation), it simply shows. */
function Part({ b, style, children, testID }: { b?: Bound | null; style?: StyleProp<ViewStyle>; children?: ReactNode; testID?: string }) {
  return <Animated.View ref={b?.ref} testID={testID} style={[style, b?.style]}>{children}</Animated.View>
}

interface Frame { top: number; bottom: number; narrow: boolean }
/** A scene's own layer: the item's title and body, and its vignette under them. Only the scene showing is read out;
 *  the vignette is a picture of the app, so a screen reader is given the words and not its parts. */
function Scene({ k, item, on, frame, b, still, children }: { k: number; item: NewsItem; on: boolean; frame: Frame; b?: { layer: Bound; title: Bound; body: Bound }; still: { opacity: Animated.Value } | null; children: ReactNode }) {
  const c = useColors()
  const title: TextStyle = { color: c.text, fontSize: frame.narrow ? 26 : 30, lineHeight: frame.narrow ? 32 : 37, letterSpacing: -0.3, ...face('serif', { bold: true }) }
  return (
    <Animated.View ref={b?.layer.ref} testID={`news-scene-${k}`} accessibilityElementsHidden={!on} importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
      style={[StyleSheet.absoluteFill, { pointerEvents: 'none', alignItems: 'center', paddingTop: frame.top, paddingBottom: frame.bottom, paddingHorizontal: 24, overflow: 'hidden' }, b?.layer.style ?? still]}>
      {/* auto margins centre it when there is room and leave it at the top when there is not, so a title is never cut */}
      <View testID={`news-block-${k}`} style={{ width: '100%', maxWidth: 440, gap: 26, marginVertical: 'auto' }}>
        <View style={{ gap: SPACE.s }}>
          <Part b={b?.title}><Text testID={`news-title-${k}`} accessibilityRole="header" style={title}>{t(item.title)}</Text></Part>
          <Part b={b?.body}><Text testID={`news-body-${k}`} style={{ color: c.muted, fontSize: TYPE.body, lineHeight: 23 }}>{t(item.body)}</Text></Part>
        </View>
        <View testID={`news-vignette-${k}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{children}</View>
      </View>
    </Animated.View>
  )
}

/** Scene 1: the library search with a question typed in, and the other wordings under it as the search shows them
 *  (components/SearchExpansion.tsx). */
function Ask({ b }: { b?: Motion['ask'] }) {
  const c = useColors()
  const fill = useFill()
  const letter: TextStyle = { color: c.text, fontSize: TYPE.body, lineHeight: 22 }
  // a letter is its own view so it can be typed in; they are kept in words so the line breaks between words
  const words = ASK.question.split(' ')
  let typed = 0, chip = 0
  const groups = [
    { title: t('Other wordings'), chips: [...ASK.phrases, ...ASK.related].map(p => ({ label: p.words, total: p.total })) },
    { title: t('Verses'), chips: ASK.verses.map(v => ({ label: formatRef({ book: v.book, chapter: v.chapter, v1: v.verse }), total: v.total })) },
  ]
  return (
    <View style={{ gap: SPACE.l }}>
      <Part b={b?.field} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: fill, borderRadius: RADIUS.control, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48 }}>
        <Icon name="search" size={18} color={c.muted} />
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap' }}>
          {words.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row' }}>
              {[...(i < words.length - 1 ? w + ' ' : w)].map((ch, j) => { const x = b?.chars[typed++]; return <Animated.Text key={j} ref={x?.ref} style={[letter, x?.style]}>{ch}</Animated.Text> })}
            </View>
          ))}
        </View>
      </Part>
      <View style={{ gap: SPACE.m }}>
        {groups.map((g, i) => (
          <View key={i} style={{ gap: SPACE.s }}>
            <Part b={b?.labels[i]}><T small muted bold>{g.title}</T></Part>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s }}>
              {g.chips.map(x => <Part key={x.label} b={b?.chips[chip++]}><Chip label={x.label} detail={x.total.toLocaleString()} onPress={noop} /></Part>)}
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

/** Scene 2: the question as it was asked, the answer a sentence at a time with its markers, and the paragraph one of
 *  them opens. The paragraph is drawn as lines, not written: no writer is given words here that are not theirs. */
function Answer({ b }: { b?: Motion['answer'] }) {
  const c = useColors()
  const mark: ViewStyle = { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }
  const markText: TextStyle = { color: c.accent, fontSize: 12, fontWeight: '700' }
  const line = (width: `${number}%`) => <View style={{ width, height: 7, borderRadius: 4, backgroundColor: c.muted, opacity: 0.32 }} />
  return (
    <View style={{ gap: SPACE.m }}>
      <Part b={b?.question} style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: c.accentSoft, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 }}>
        <Text style={{ color: c.text, fontSize: TYPE.body, lineHeight: 22 }}>{ASK.question}</Text>
      </Part>
      <View style={{ gap: 6 }}>
        {ANSWER.sentences.map((s, k) => (
          <Part key={k} b={b?.sentences[k]} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
            <Text style={{ flexShrink: 1, color: c.text, fontSize: 18, lineHeight: 28, ...face('serif') }}>{s}</Text>
            <View style={{ marginBottom: 4 }}>
              {k === ANSWER.opens ? <Part b={b?.ring} style={[{ position: 'absolute', left: -4, top: -4, width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: c.accent }, b ? null : HIDDEN]} /> : null}
              <Part b={b?.markers[k]} style={mark}><Text style={markText}>{k + 1}</Text></Part>
            </View>
          </Part>
        ))}
      </View>
      <Part b={b?.card}>
        <Card style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 14 }}>
          <View style={mark}><Text style={markText}>{ANSWER.opens + 1}</Text></View>
          <View style={{ flex: 1, gap: 8, paddingVertical: 6 }}>
            {line('94%')}
            <View style={{ gap: 8 }}>
              {/* the words the sentence rests on, marked in the paragraph */}
              <Part b={b?.tint} style={{ position: 'absolute', left: -5, right: 0, top: -5, bottom: -5, borderRadius: 6, backgroundColor: c.selected }} />
              {line('100%')}
              {line('68%')}
            </View>
            {line('90%')}
            {line('52%')}
          </View>
        </Card>
      </Part>
    </View>
  )
}

/** Scene 3: what the reader asks, a line of the Bible shown growing as the text size is changed for them, and the
 *  way back. */
function Hand({ b }: { b?: Motion['hand'] }) {
  const c = useColors()
  const grown = HAND.to / HAND.from
  return (
    <View style={{ gap: SPACE.l }}>
      <Part b={b?.request} style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: c.accentSoft, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 }}>
        <Text style={{ color: c.text, fontSize: TYPE.body, lineHeight: 22 }}>{t(HAND.request)}</Text>
      </Part>
      <Part b={b?.sample}>
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 22 }}>
          {/* it grows about its middle, so the column is narrow enough for the larger size to stay inside the card */}
          <Part b={b?.grow} style={[{ width: `${Math.floor(98 / grown)}%`, marginVertical: 8 }, b ? null : { transform: [{ scale: grown }] }]}>
            <Text style={{ color: c.text, fontSize: HAND.from, lineHeight: Math.round(HAND.from * 1.6), textAlign: 'center', ...face('serif') }}>{HAND.sample[peekText()]}</Text>
          </Part>
          <T small muted>{formatRef(HAND.ref)}</T>
        </Card>
      </Part>
      <Part b={b?.undo} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, borderRadius: 22, paddingLeft: 18, paddingRight: 6, backgroundColor: c.text }}>
        <Text style={{ color: c.bg, fontSize: TYPE.small, fontWeight: '500' }}>{`${t('Text size')} ${HAND.to}`}</Text>
        <View style={{ height: 32, borderRadius: 16, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: c.bg }}>
          <Text style={{ color: c.accent, fontSize: TYPE.small, fontWeight: '600' }}>{t('Undo')}</Text>
        </View>
      </Part>
    </View>
  )
}
