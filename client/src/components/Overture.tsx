import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, BackHandler, Easing, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type TextStyle, type ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BRAND } from '@shared/brand'
import { formatRef } from '@shared/ref'
import { useColors, useFill } from '../hooks/useTheme'
import { NAME_MAX, usePrefsStore, useReduceMotion } from '../store/prefs'
import { startTour } from '../store/tour'
import { face } from '../theme'
import { MARK_FACE, WORDMARK, arc, assign, baselineIn, inCubic, inOutCubic, keys, linear, mapKeys, outCubic, schedule, tween, type Keys, type Pt } from '../lib/overture'
import ChapterPicker from './ChapterPicker'
import SkipPill from './SkipPill'
import { makeDriver, type Bound, type Playback } from './motion/track'
import { fixedSpeed } from './motion/speed'
import { Button, Card, Input, T, Tap, TYPE } from './ui'

/*
 * The welcome, shown once per device over Home (and again from Settings). Three beats, then the hand-off:
 *
 *   1. In the beginning: Genesis 1 opens as the reader opens a chapter, and its first verse settles word by word at
 *      the pace of a slow reading voice.
 *   2. The note: the caller after "God" appears, and Darby's note on Elohim blooms out of it in place.
 *   3. The name: each word folds into a jot of ink; the jots fly together into the name, and the last one, from
 *      "God", drops onto the ı as its tittle, in the rubric accent. A brand without a wordmark (shared/brand.json)
 *      has its name fade in as plain text where the letters would have formed, and nothing flies.
 *   Then the name lifts and the first steps arrive: a name, where to begin, and sign in later.
 *
 * The timeline is four stages run in sequence (lib/overture.ts `schedule`); every moving part is a keyframe track
 * played by motion/track.ts, on the native driver in the apps and by one frame loop on the web. Reduce animation gets
 * a still page and a crossfade.
 */

const WORDS = ['In', 'the', 'beginning', 'God', 'created', 'the', 'heavens', 'and', 'the', 'earth.']
const GOD = 3
/** The name's letters, each carried in by a word's jot: a name longer than the verse has words to give is set plain. */
const MARK = WORDMARK && WORDMARK.letters.length < WORDS.length ? WORDMARK : null
const S = schedule(WORDS, GOD)
const NOTE: { t: string; i?: boolean }[] = [
  { t: 'Heb. ' }, { t: 'Elohim', i: true }, { t: ', the plural of ' }, { t: 'Eloah', i: true }, { t: ', ‘the Supreme’. It is Deity in the absolute sense.' },
]
const NO_READS: ReadonlySet<string> = new Set()
/** Reduce animation: the page fades in, rests, and crossfades to the hand-off. */
const STILL = { pageIn: 500, pageOut: [3700, 4200] as const, handoffIn: [3900, 4500] as const, end: 4500 }

type Phase = 'measure' | 'play' | 'handoff'
interface Box { x: number; y: number; w: number; h: number }
interface Geo { words: Box[]; caller: Box; note: Box; mark: Box }
type Choice = { book: number; chapter: number } | null

const at = (v: Animated.Value, k: Keys) => v.interpolate({ inputRange: k.input, outputRange: k.output, extrapolate: 'clamp' })
const run = (v: Animated.Value, ms: number) => Animated.timing(v, fixedSpeed({ toValue: ms, duration: ms, easing: Easing.linear, useNativeDriver: true }))

/** The welcome itself, loaded only when it is due (components/Welcome.tsx). */
export default function Overture({ replay, onClose }: { replay: boolean; onClose: () => void }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const store = usePrefsStore()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width: W, height: H } = useWindowDimensions()
  const narrow = W < 360
  const size = { verse: narrow ? 21 : 24, mark: narrow ? 48 : 56 }
  const verseLine = Math.round(size.verse * 1.6)
  const markLine = Math.ceil((MARK_FACE.ascent + MARK_FACE.descent) * size.mark) + 2

  const clocks = useRef({ still: new Animated.Value(0), skip: new Animated.Value(reduce ? 1 : 0), out: new Animated.Value(1) }).current
  const [phase, setPhase] = useState<Phase>(reduce ? 'play' : 'measure')
  const [geo, setGeo] = useState<Geo | null>(null)
  const anim = useRef<Playback | null>(null)
  const closing = useRef(false)

  // ---- measure once laid out: every position the jots need, before anything has a transform ----
  const rootRef = useRef<View>(null)
  const wordRefs = useRef<(View | null)[]>([])
  const callerRef = useRef<View>(null), noteRef = useRef<View | null>(null), markRef = useRef<View>(null)
  const measure = useCallback(() => {
    const root = rootRef.current
    const nodes = [...wordRefs.current.slice(0, WORDS.length), callerRef.current, noteRef.current, markRef.current]
    if (!root || nodes.length !== WORDS.length + 3 || nodes.some(n => !n)) return
    const boxes: Box[] = []
    let left = nodes.length
    nodes.forEach((n, i) => n!.measureLayout(root, (x, y, w, h) => {
      boxes[i] = { x, y, w, h }
      if (--left > 0) return
      const n0 = WORDS.length
      setGeo(g => g ?? { words: boxes.slice(0, n0), caller: boxes[n0], note: boxes[n0 + 1], mark: boxes[n0 + 2] })
    }, () => {}))
  }, [])
  const onRootLayout = useCallback(() => { if (phase === 'measure') requestAnimationFrame(measure) }, [phase, measure])

  // ---- motion: built once from the measured page; before that everything waits unseen ----
  const m = useMemo(() => (geo && !reduce ? motion(geo, size.mark, markLine) : null), [geo, reduce, size.mark, markLine])

  // ---- the clocks ----
  const toHandoff = useCallback(() => {
    if (!m) return
    setPhase('handoff')
    anim.current = m.play(['handoff'])
  }, [m])
  useEffect(() => {
    Animated.timing(clocks.skip, fixedSpeed({ toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true })).start()
  }, [clocks])
  useEffect(() => {
    if (reduce) {
      const a = run(clocks.still, STILL.end)
      anim.current = a
      const t = setTimeout(() => setPhase('handoff'), STILL.handoffIn[0])
      a.start()
      return () => { clearTimeout(t); a.stop() }
    }
    if (!m) return
    setPhase('play')
    const a = m.play(['page', 'condense', 'gather'], toHandoff)
    anim.current = a
    return () => a.stop()
  }, [m, reduce, clocks, toHandoff])
  // a window resized mid-flight would strand the jots: go straight to the hand-off instead
  const dims = useRef({ W, H })
  useEffect(() => {
    if (dims.current.W === W && dims.current.H === H) return
    dims.current = { W, H }
    if (phase === 'play' && m) { anim.current?.stop(); m.finish(['page', 'condense', 'gather']); toHandoff() }
  }, [W, H, phase, m, toHandoff])

  // ---- leaving ----
  const [name, setName] = useState(() => store.get().readerName)
  const [choice, setChoice] = useState<Choice>(null)
  const [picker, setPicker] = useState(false)
  const leave = useCallback((go: Choice | 'home' | null) => {
    if (closing.current) return
    closing.current = true
    anim.current?.stop()
    // the tour follows a Begin on a device that has not had it; a Skip skips both
    const tour = !!go && !store.get().toured
    store.set({ onboarded: true, readerName: name.trim().slice(0, NAME_MAX), ...(go ? null : { toured: true }) })
    if (go && go !== 'home') router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(go.book), chapter: String(go.chapter), v: '' } })
    else if (go === 'home' && replay) router.navigate('/')
    const done = () => { onClose(); if (tour) startTour(go && go !== 'home' ? go : null) }
    if (reduce) { done(); return }
    Animated.timing(clocks.out, fixedSpeed({ toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true })).start(() => done())
  }, [store, name, router, replay, reduce, clocks, onClose])
  const skip = useCallback(() => leave(null), [leave])
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (picker) return false; skip(); return true })
    if (Platform.OS !== 'web' || typeof window === 'undefined') return () => sub.remove()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !picker) skip() }
    window.addEventListener('keydown', key)
    return () => { sub.remove(); window.removeEventListener('keydown', key) }
  }, [skip, picker])

  const still = useMemo(() => reduce ? {
    page: { opacity: at(clocks.still, keys([[0, 0], [STILL.pageIn, 1], [STILL.pageOut[0], 1], [STILL.pageOut[1], 0]])) },
    handoff: { opacity: at(clocks.still, tween(STILL.handoffIn[0], STILL.handoffIn[1], 0, 1, outCubic)) },
  } : null, [reduce, clocks])
  // before the page is measured nothing shows; under Reduce animation everything is simply there
  const hidden = !m && !reduce ? HIDDEN : null

  const verseText: TextStyle = { color: c.text, fontSize: size.verse, lineHeight: verseLine, ...face('serif') }
  const mark: TextStyle = { color: c.accent, fontSize: Math.round(size.verse * 0.6), lineHeight: verseLine, ...face('sans', { bold: true }) }
  const letter: TextStyle = { position: 'absolute', top: 0, color: c.text, fontSize: size.mark, lineHeight: markLine, ...face('serif', { bold: true }) }
  const plainName: TextStyle = { color: c.text, fontSize: size.mark, lineHeight: markLine, ...face('serif', { bold: true }) }
  const dotClip = baselineIn(size.mark, markLine) - 0.56 * size.mark
  const top = insets.top + Math.round(Math.min(120, Math.max(56, H * 0.12)))
  const interactive = phase === 'handoff'
  const label = choice ? `Read ${formatRef({ book: choice.book, chapter: choice.chapter })}` : 'Begin'

  return (
    <Animated.View ref={rootRef} onLayout={onRootLayout} accessibilityViewIsModal style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity: clocks.out }]}>
      {/* the hand-off: the name (which the jots fly into) and the first steps under it */}
      <ScrollView style={StyleSheet.absoluteFill} scrollEnabled={interactive} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingTop: top, paddingBottom: insets.bottom + 32, paddingHorizontal: 20 }}>
        <Animated.View accessibilityElementsHidden={!interactive} importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
          style={[{ width: '100%', maxWidth: 440, gap: 18, pointerEvents: interactive ? 'auto' : 'none' }, still?.handoff]}>
          <Animated.View ref={m?.lift.ref} style={[{ alignItems: 'center', gap: 2, marginBottom: 10 }, m?.lift.style]}>
            {MARK ? (
              <View ref={markRef} accessible accessibilityRole="header" accessibilityLabel={BRAND.name} style={{ width: Math.ceil(MARK.width * size.mark), height: markLine }}>
                {MARK.letters.map((ch, i) => (
                  <Animated.Text key={i} allowFontScaling={false} ref={m?.letters[i].ref} style={[letter, { left: MARK.x[i] * size.mark }, m?.letters[i].style ?? hidden]}>{ch}</Animated.Text>
                ))}
                {/* the tittle: the i's own dot, cut from a full "i" in the accent, so it sits exactly where the font puts it.
                    The name is set by the font's own measurements (WORDMARK), so it must not grow with the phone's font
                    size setting: scaled, the letters left their places, the jot landed beside the ı, and the cut let
                    the accent i's stem show over it. */}
                {MARK.dot ? (
                  <Animated.View ref={m?.dot?.ref} style={[{ position: 'absolute', top: 0, left: MARK.x[MARK.dot.letter] * size.mark, width: MARK.advance[MARK.dot.letter] * size.mark, height: dotClip, overflow: 'hidden' }, m?.dot?.style ?? hidden]}>
                    <Text allowFontScaling={false} style={[letter, { left: 0, color: c.accent }]}>{MARK.dot.glyph}</Text>
                  </Animated.View>
                ) : null}
              </View>
            ) : (
              <View ref={markRef} style={{ height: markLine }}>
                <Animated.Text accessibilityRole="header" allowFontScaling={false} ref={m?.name?.ref} style={[plainName, m?.name?.style ?? hidden]}>{BRAND.name}</Animated.Text>
              </View>
            )}
            <Animated.Text ref={m?.subtitle.ref} style={[{ color: c.muted, fontSize: 17, ...face('serif', { italic: true }) }, m?.subtitle.style ?? hidden]}>J. N. Darby’s New Translation</Animated.Text>
          </Animated.View>

          <Animated.View style={[{ gap: 8 }, m?.form[0].style ?? hidden]} ref={m?.form[0].ref}>
            <T small muted>Your name</T>
            <Input value={name} onChangeText={setName} placeholder="Optional" maxLength={NAME_MAX} autoCapitalize="words" autoCorrect={false}
              autoComplete="given-name" textContentType="givenName" returnKeyType="done" accessibilityLabel="Your name, optional" />
            <T small muted>For a greeting on Home. It stays on this device.</T>
          </Animated.View>

          <Animated.View style={[{ gap: 8 }, m?.form[1].style ?? hidden]} ref={m?.form[1].ref}>
            <T small muted>Where to begin</T>
            <Card style={{ gap: 0, paddingVertical: 6 }}>
              <Option on={!choice} title="Home" detail={replay ? 'Today’s verse and where you left off' : 'Today’s verse, with John 1 to start'} onPress={() => setChoice(null)} />
              <Option on={!!choice} title={choice ? formatRef({ book: choice.book, chapter: choice.chapter }) : 'A book of your choice'} detail={choice ? 'Tap to choose another' : 'Any book and chapter'} onPress={() => setPicker(true)} />
            </Card>
          </Animated.View>

          <Animated.View style={[{ gap: 14, marginTop: 4 }, m?.form[2].style ?? hidden]} ref={m?.form[2].ref}>
            <Button primary title={label} onPress={() => leave(choice ?? 'home')} />
            <T small muted style={{ textAlign: 'center' }}>Sign in later, from Settings, to keep a streak and read with a group.</T>
          </Animated.View>
        </Animated.View>
      </ScrollView>

      {/* the page: Genesis 1:1 and its first note, centred a little above the middle */}
      <Animated.View accessibilityElementsHidden={interactive} importantForAccessibility={interactive ? 'no-hide-descendants' : 'auto'}
        style={[StyleSheet.absoluteFill, { pointerEvents: 'none', alignItems: 'center', justifyContent: 'center', paddingBottom: Math.round(H * 0.08), paddingHorizontal: 28 }, still?.page]}>
        <View style={{ width: '100%', maxWidth: 440 }} accessible accessibilityLabel={`Genesis 1:1. ${WORDS.join(' ')}`}>
          <Animated.View ref={m?.head.ref} style={[{ alignItems: 'center', marginBottom: 22 }, m?.head.style]}>
            <Animated.Text ref={m?.book.ref} style={[{ color: c.muted, fontSize: 17, ...face('serif', { italic: true }) }, m?.book.style ?? hidden]}>Genesis</Animated.Text>
            <Animated.Text style={[{ color: c.accent, fontSize: TYPE.numeral, lineHeight: Math.round(TYPE.numeral * 1.08), letterSpacing: -TYPE.numeral * 0.02, fontVariant: ['lining-nums'], ...face('serif', { bold: true }) }, m?.numeral.style ?? hidden]} ref={m?.numeral.ref}>1</Animated.Text>
          </Animated.View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Animated.View ref={m?.verseNo.outer.ref} style={[{ marginRight: 5, marginTop: -3 }, m?.verseNo.outer.style]}>
              <Animated.Text ref={m?.verseNo.inner.ref} style={[mark, m?.verseNo.inner.style ?? hidden]}>1</Animated.Text>
            </Animated.View>
            {WORDS.map((w, i) => (
              <Animated.View key={i} ref={(el: View | null) => { wordRefs.current[i] = el; m?.words[i].outer.ref?.(el) }} style={[{ marginRight: Math.round(size.verse * 0.2) }, m?.words[i].outer.style]}>
                {i === GOD ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <Animated.View style={[StyleSheet.absoluteFill, { left: -3, right: -3, top: 4, bottom: 4, borderRadius: 6, backgroundColor: c.selected }, m?.tint.style ?? hidden]} ref={m?.tint.ref} />
                    {/* the mark and the word settle together; the web driver writes one element per binding, so each has its own */}
                    <Animated.View ref={m?.words[i].inner.ref} style={[{ flexDirection: 'row', alignItems: 'flex-start' }, m?.words[i].inner.style ?? hidden]}>
                      <Text style={verseText}>{w}</Text>
                    </Animated.View>
                    <View ref={callerRef} style={{ marginLeft: 1, marginTop: -3 }}>
                      <Animated.View style={[RING_BASE, { borderColor: c.accent, left: '50%', top: verseLine / 2 - 13 }, m?.ring.style ?? HIDDEN]} ref={m?.ring.ref} />
                      <Animated.Text ref={m?.caller.ref} style={[mark, m?.caller.style ?? hidden]}>a</Animated.Text>
                    </View>
                  </View>
                ) : <Animated.Text ref={m?.words[i].inner.ref} style={[verseText, m?.words[i].inner.style ?? hidden]}>{w}</Animated.Text>}
              </Animated.View>
            ))}
          </View>
          <Animated.View ref={m?.note.outer.ref} style={[{ marginTop: 14, marginLeft: 10 }, m?.note.outer.style]}>
            <Animated.View ref={(el: View | null) => { noteRef.current = el; m?.note.card.ref?.(el) }} style={[{ backgroundColor: c.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }, m?.note.card.style ?? hidden]}>
              <Animated.Text ref={m?.noteText.ref} style={[{ color: c.text, fontSize: 15, lineHeight: 22, ...face('serif') }, m?.noteText.style ?? hidden]}>
                <Text style={{ color: c.accent, ...face('sans', { bold: true }) }}>a  </Text>
                {NOTE.map((r, i) => <Text key={i} style={r.i ? face('serif', { italic: true }) : null}>{r.t}</Text>)}
              </Animated.Text>
            </Animated.View>
          </Animated.View>
        </View>
      </Animated.View>

      {/* the jots, in page coordinates: a dot where each word folded, carried into its letter */}
      {m ? (
        <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
          {m.jots.map((j, i) => (
            <Animated.View key={i} ref={j.outer.ref} style={[{ position: 'absolute', left: j.at.x - j.size / 2, top: j.at.y - j.size / 2, width: j.size, height: j.size }, j.outer.style]}>
              <Animated.View ref={j.inner.ref} style={[{ flex: 1, borderRadius: j.size / 2, backgroundColor: j.tittle ? c.accent : c.text }, j.inner.style]} />
            </Animated.View>
          ))}
        </View>
      ) : null}

      {/* from the first frame, fading in gently so it never competes with the page */}
      <SkipPill onPress={skip} label="Skip the welcome" style={{ position: 'absolute', top: insets.top + 12, right: insets.right + 16, opacity: clocks.skip }} />
      <ChapterPicker open={picker} book={choice?.book ?? 43} chapter={choice?.chapter ?? 1} readSet={NO_READS} onClose={() => setPicker(false)}
        onPick={(book, chapter) => { setChoice({ book, chapter }); setPicker(false) }} />
    </Animated.View>
  )
}

const HIDDEN = { opacity: 0 } as const
const RING_BASE: ViewStyle = { position: 'absolute', width: 26, height: 26, marginLeft: -13, borderRadius: 13, borderWidth: 1.5 }

/** One choice in "Where to begin": a round mark that fills with the accent, a title and one line. */
function Option({ on, title, detail, onPress }: { on: boolean; title: string; detail: string; onPress: () => void }) {
  const c = useColors()
  const fill = useFill()
  return (
    <Tap onPress={onPress} scaleTo={0.985} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${title}. ${detail}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 6 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: on ? c.accent : fill, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accentText }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: c.text, fontSize: TYPE.body, fontWeight: '500' }}>{title}</Text>
        <Text style={{ color: c.muted, fontSize: TYPE.small }}>{detail}</Text>
      </View>
    </Tap>
  )
}

type Stage = 'page' | 'condense' | 'gather' | 'handoff'
interface Jot { at: Pt; size: number; tittle: boolean; outer: Bound; inner: Bound }

/**
 * Every moving part of the welcome, bound to a driver (components/motion/track.ts), from the measured page. Built once
 * per layout: the keyframes here are the whole choreography, as numbers.
 */
function motion(geo: Geo, markSize: number, markLine: number) {
  const D = makeDriver<Stage>({ page: S.page.end, condense: S.condense.end, gather: S.gather.end, handoff: S.handoff.end })
  const centre = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
  /** Opacity `from` → `to` with a vertical travel, eased alike. */
  const fade = (stage: Stage, t0: number, t1: number, from: number, to: number, y: [number, number], ease = outCubic) =>
    D.bind(stage, { opacity: tween(t0, t1, from, to, ease), y: tween(t0, t1, y[0], y[1], ease) })
  const p = S.page

  // beat 1: the chapter opening, as the reader opens one but slower, then the words at reading pace
  const book = fade('page', p.book[0], p.book[1], 0, 1, [-6, 0])
  const numeral = D.bind('page', { opacity: tween(p.numeral[0], p.numeral[1], 0, 1), y: tween(p.numeral[0], p.numeral[1] + 120, 10, 0), scale: tween(p.numeral[0], p.numeral[1] + 120, 0.92, 1) })
  const verseNoIn = D.bind('page', { opacity: tween(p.verseNo[0], p.verseNo[1], 0, 1) })
  const settle = (t: number) => fade('page', t, t + p.wordIn + 80, 0, 1, [6, 0])

  // beat 2: the caller pops with one ring, the word takes the selection tint, the note blooms out of the caller
  const tint = D.bind('page', { opacity: tween(p.tint, p.tint + 400, 0, 1) })
  const caller = D.bind('page', { opacity: tween(p.caller, p.caller + 120, 0, 1, linear), scale: keys([[p.caller, 0.2], [p.caller + 180, 1.3], [p.caller + 320, 0.92], [p.caller + 440, 1]]) })
  const ring = D.bind('page', { opacity: keys([[p.ring, 0], [p.ring + 60, 0.8], [p.ring + 700, 0]]), scale: tween(p.ring, p.ring + 700, 0.4, 2.2) })
  // it opens from the caller's side and grows downward, so it never passes over the verse on its way:
  // scaled about that point = scaled about the centre, then shifted by (origin - centre) * (1 - s)
  const origin = { x: centre(geo.caller).x, y: geo.note.y }, mid = centre(geo.note)
  const bloom = keys([[p.note, 0.12], [p.note + 380, 1.015], [p.note + 560, 1]])
  const card = D.bind('page', { opacity: tween(p.note, p.note + 300, 0, 1, linear), x: mapKeys(bloom, s => (origin.x - mid.x) * (1 - s)), y: mapKeys(bloom, s => (origin.y - mid.y) * (1 - s)), scale: bloom })
  const noteText = D.bind('page', { opacity: tween(p.noteText, p.noteText + 420, 0, 1) })

  // beat 3, first half: the page lets go; word k folds into its jot (the verse number folds with nothing to carry)
  const head = fade('condense', 0, 420, 1, 0, [0, -8], inCubic)
  const noteOut = fade('condense', 60, 480, 1, 0, [0, -8], inCubic)
  const fold = (k: number) => {
    const t0 = k * S.condense.step, t1 = t0 + S.condense.fold
    return D.bind('condense', { opacity: tween(t0, t1, 1, 0, inCubic), scale: tween(t0, t1, 1, 0.3, inCubic) })
  }
  const verseNo = { outer: fold(0), inner: verseNoIn }
  const words = WORDS.map((_, i) => ({ outer: fold(i + 1), inner: settle(p.onsets[i]) }))
  const jotIn = (k: number) => { const t = k * S.condense.step + 140; return D.bind('condense', { scale: tween(t, t + 180, 0, 1) }) }

  // beat 3: the name forms where the verse was, then lifts to its place above the first steps
  const verseMid = (Math.min(...geo.words.map(w => w.y)) + Math.max(...geo.words.map(w => w.y + w.h))) / 2
  const dy = verseMid - (geo.mark.y + markLine / 2)
  const lift = D.bind('handoff', { y: tween(S.handoff.lift[0], S.handoff.lift[1], dy, 0, inOutCubic) })
  const base = baselineIn(markSize, markLine)

  const g = S.gather
  const sources = geo.words.map(centre)
  const jots: Jot[] = []
  let letters: Bound[] = [], dot: Bound | null = null, name: Bound | null = null
  if (MARK) {
    const letterAt = (i: number): Pt => ({ x: geo.mark.x + (MARK.x[i] + MARK.advance[i] / 2) * markSize, y: geo.mark.y + dy + base - 0.28 * markSize })
    const pool = sources.map((_, i) => i).filter(i => i !== GOD)
    const pick = assign(pool.map(i => sources[i]), MARK.letters.map((_, j) => letterAt(j)))
    letters = MARK.letters.map((_, j) => {
      const src = pool[pick[j]], t0 = j * g.step, t1 = t0 + g.fly, to = letterAt(j)
      const path = arc(sources[src], to, 36 + Math.abs(to.x - sources[src].x) * 0.12, t0, t1)
      jots.push({ at: sources[src], size: 7, tittle: false, inner: jotIn(src + 1), outer: D.bind('gather', { opacity: tween(t1 - 160, t1, 1, 0, linear), x: path.x, y: path.y, scale: tween(t0, t1, 1, 0.7) }) })
      const b = t1 - 150
      return D.bind('gather', { opacity: tween(b, b + 180, 0, 1), y: tween(b, b + g.bloom, 4, 0), scale: keys([[b, 0.5], [b + 200, 1.06], [b + g.bloom, 1]]) })
    })
    // the tittle: "God" folds into an accent jot that waits, rises highest, and drops onto the ı last
    const d = MARK.dot
    if (d) {
      const land = g.tittle + g.tittleFly
      const dotAt: Pt = { x: geo.mark.x + (MARK.x[d.letter] + d.x) * markSize, y: geo.mark.y + dy + base - d.y * markSize }
      const drop = arc(sources[GOD], dotAt, 90, g.tittle, land, inOutCubic, 16)
      jots.push({
        at: sources[GOD], size: d.size * markSize, tittle: true, inner: jotIn(GOD + 1),
        outer: D.bind('gather', { opacity: tween(land + 200, land + 320, 1, 0, linear), x: drop.x, y: drop.y, scale: keys([[land, 1], [land + 80, 1.3], [land + 200, 1]]) }),
      })
      dot = D.bind('gather', { opacity: tween(land + 180, land + 300, 0, 1, linear) })
    }
  } else {
    // no wordmark: the name appears whole, when its first letter would have
    const b = g.fly - 150
    name = fade('gather', b, b + g.bloom, 0, 1, [4, 0])
  }
  const subtitle = fade('gather', g.subtitle, g.subtitle + 500, 0, 1, [6, 0])

  const h = S.handoff
  const form = [0, 1, 2].map(k => fade('handoff', h.form + k * h.formStep, h.form + k * h.formStep + h.formIn, 0, 1, [8, 0]))

  return { play: D.play, finish: D.finish, head, book, numeral, verseNo, words, tint, caller, ring, note: { outer: noteOut, card }, noteText, jots, letters, dot, name, subtitle, lift, form }
}
