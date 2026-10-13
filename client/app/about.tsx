import { useMemo, useState, type ReactNode } from 'react'
import { Linking, Text, View, type TextStyle } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import type { Ref } from '@shared/ref'
import { useColors } from '../src/hooks/useTheme'
import { usePrefs } from '../src/store/prefs'
import { refParams } from '../src/components/FootnoteText'
import { LinkRow, Rule, Sc } from '../src/components/ChronologyTable'
import { parseSection, superscript, type Block, type IntroSection, type Note, type Row, type Span } from '../src/lib/intro'
import { face, proseStyle } from '../src/theme'
import { useEdition } from '../src/lib/edition'
import { NEUTERED } from '../src/lib/buildFlags'
import { hasChronology, noticeSections, type Meta1890, type NoticeSection } from '../src/lib/editionCore'
import { Card, Enter, H, RADIUS, Screen, T, Tap } from '../src/components/ui'
import { easeNextLayout, useReduceMotion } from '../src/components/motion/nav'

// shipped in this route's chunk (no network); the server's /api/intro serves the same files: the 1961 edition's notices,
// and the 1890 edition's own when the data has them (client/public/bible1890/notices.json, null without)
import intro from '../../data/ccel/intro.json'
import notices1890 from '../public/bible1890/notices.json'

interface Intro { sections: NoticeSection[]; source: string }
const d: Intro = intro
const own1890 = notices1890 as { sections: NoticeSection[] } | null

/** Faces and colours one notice is set in: the reading face (OpenDyslexic when that is the reader's choice), the accent for links. */
interface Ink {
  body: TextStyle; italic: TextStyle; bold: TextStyle
  text: string; muted: string; accent: string
  onRef: (r: Ref) => void
  onNote: (id: string) => void
}

/** Inline spans: italics, links into the reader, footnote callers as superior figures in the accent. */
function Inline({ spans, ink, underline = true }: { spans: Span[]; ink: Ink; underline?: boolean }) {
  return spans.map((s, i) => {
    const style = s.italic ? ink.italic : undefined
    if (s.note !== undefined) {
      return <Text key={i} accessibilityRole="button" accessibilityLabel={`Footnote ${s.note}`} onPress={() => ink.onNote(s.note!)} style={[style, { color: ink.accent }]}>{s.text}</Text>
    }
    if (s.ref) {
      const ref = s.ref
      return <Text key={i} accessibilityRole="link" onPress={() => ink.onRef(ref)} style={[style, { color: ink.accent, textDecorationLine: underline ? 'underline' : 'none' }]}>{s.text}</Text>
    }
    return <Text key={i} style={style}>{s.text}</Text>
  })
}

/** A control-like inset inside the card: the page colour, radius 14, as STYLE asks of anything set into a card. */
function Inset({ children, bg, gap = 8 }: { children: ReactNode; bg: string; gap?: number }) {
  return <View style={{ backgroundColor: bg, borderRadius: RADIUS.control, paddingHorizontal: 14, paddingVertical: 12, gap }}>{children}</View>
}

function NoteText({ note, ink }: { note: Note; ink: Ink }) {
  return (
    <Text style={[ink.body, { color: ink.muted, fontSize: 14, lineHeight: 21 }]}>
      <Text style={{ color: ink.accent }}>{superscript(note.id)} </Text>
      <Inline spans={note.spans} ink={ink} />
    </Text>
  )
}

/** The year summary as a two-column table in the chronology page's booktabs style; "-----" and "=====" are sum rules over the figures. */
function YearTable({ head, rows, ink }: { head: string; rows: Row[]; ink: Ink }) {
  const FIG = 64
  const cell = { paddingHorizontal: 6, paddingVertical: 5 }
  return (
    <View style={{ paddingVertical: 4 }}>
      <Rule heavy />
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1 }} />
        <View style={[cell, { width: FIG }]}><Sc color={ink.text} size={13} align="right">{head}</Sc></View>
      </View>
      <Rule />
      {rows.map((r, i) => {
        if (r.kind === 'rule') {
          return (
            <View key={i} style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1 }} />
              <View style={{ width: FIG, paddingHorizontal: 6, gap: 2, paddingVertical: 2 }}><Rule />{r.double ? <Rule /> : null}</View>
            </View>
          )
        }
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={[cell, { flex: 1 }]}>
              <Text style={[r.total ? ink.italic : ink.body, { color: ink.text, fontSize: 14, lineHeight: 20 }]}><Inline spans={r.label} ink={ink} underline={false} /></Text>
            </View>
            <View style={[cell, { width: FIG }]}>
              <Text style={[r.total ? ink.bold : ink.body, { color: ink.text, fontSize: 14, lineHeight: 20, textAlign: 'right', fontVariant: ['tabular-nums', 'lining-nums'] }]}>{r.value}</Text>
            </View>
          </View>
        )
      })}
      <Rule heavy />
    </View>
  )
}

function BlockView({ b, ink, bg, openNote, notes }: { b: Block; ink: Ink; bg: string; openNote: string | null; notes: Note[] }) {
  const router = useRouter()
  const reading = [ink.body, { color: ink.text }]
  switch (b.kind) {
    case 'p': {
      if (b.muted) return <Text style={[ink.italic, { color: ink.muted, fontSize: 14, lineHeight: 21 }]}><Inline spans={b.spans} ink={ink} /></Text>
      // a tapped footnote caller opens its note under the paragraph, the way the reader opens a verse's note
      const open = openNote !== null && b.spans.some(s => s.note === openNote) ? notes.find(n => n.id === openNote) : undefined
      return (
        <View style={{ gap: 8 }}>
          <Text style={reading}><Inline spans={b.spans} ink={ink} /></Text>
          {open ? <Enter><Inset bg={bg}><NoteText note={open} ink={ink} /></Inset></Enter> : null}
        </View>
      )
    }
    case 'h':
      return <Text accessibilityRole="header" style={[ink.bold, { color: ink.text, fontSize: 18, lineHeight: 24, marginTop: 8 }]}>{b.text}</Text>
    case 'chronology':
      if (!hasChronology()) return null
      return (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Inset bg={bg}><LinkRow title={b.title} hint={b.hint} onPress={() => router.push('/chronology')} /></Inset>
        </View>
      )
    case 'defs':
      return (
        <Inset bg={bg} gap={4}>
          {b.items.map((it, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
              <Text style={[ink.body, { color: ink.text, width: 72 }]}><Inline spans={it.term} ink={ink} /></Text>
              <Text style={[ink.body, { color: ink.text, flex: 1 }]}><Inline spans={it.def} ink={ink} /></Text>
            </View>
          ))}
        </Inset>
      )
    case 'refs':
      return (
        <Inset bg={bg} gap={10}>
          {b.entries.map((e, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text style={{ color: ink.text, fontSize: 14, ...face('sans', { bold: true }) }}>{e.book}</Text>
              <Text style={[ink.body, { color: ink.muted, fontSize: 15, lineHeight: 23 }]}><Inline spans={e.spans} ink={ink} underline={false} /></Text>
            </View>
          ))}
        </Inset>
      )
    case 'table':
      return <YearTable head={b.head} rows={b.rows} ink={ink} />
  }
}

function SectionBody({ s, ink, bg }: { s: IntroSection; ink: Ink; bg: string }) {
  const [openNote, setOpenNote] = useState<string | null>(null)
  const reduce = useReduceMotion()
  const ink2: Ink = { ...ink, onNote: id => { easeNextLayout(reduce); setOpenNote(o => o === id ? null : id) } }
  return (
    <>
      {s.blocks.map((b, j) => <BlockView key={j} b={b} ink={ink2} bg={bg} openNote={openNote} notes={s.notes} />)}
      {s.notes.length ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          <Rule />
          <Text accessibilityRole="header" style={{ color: ink.muted, fontSize: 13, marginTop: 4, ...face('sans', { bold: true }) }}>Notes</Text>
          {s.notes.map(n => <NoteText key={n.id} note={n} ink={ink2} />)}
        </View>
      ) : null}
    </>
  )
}

export default function About() {
  const router = useRouter()
  const c = useColors()
  const { prefs } = usePrefs()
  const [open, setOpenState] = useState(0)
  // the notice open on arrival is content, not a response: only a tapped-open notice fades in
  const [touched, setTouched] = useState(false)
  const reduce = useReduceMotion()
  const setOpen = (i: number) => { easeNextLayout(reduce); setTouched(true); setOpenState(i) }
  const Body = touched ? Enter : View
  // a neutered build (docs/EDITION.md, "Production build") carries the 1890 material only, whatever the server serves
  const live = useEdition()
  const edition = NEUTERED ? '1890' : live
  const sections = useMemo(() => noticeSections(edition, d, own1890).map(s => parseSection(s.title, s.html)), [edition])
  // the reader's font, added fonts included; OpenDyslexic keeps its own floor: line height 1.8, letter spacing 0.03 em
  const font = prefs.font
  const ink: Ink = {
    body: proseStyle(font, 16, 25 / 16), italic: { ...face(font, { italic: true }) }, bold: { ...face(font, { bold: true }) },
    text: c.text, muted: c.muted, accent: c.accent,
    onRef: r => router.push(refParams(r)),
    onNote: () => {},
  }
  return (
    // one orchestrated moment: the heading and its lead paragraph; the notices below are instant
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'About' }} />
      <Enter><H>About this translation</H></Enter>
      <Enter delay={70}><T muted style={{ lineHeight: 22 }}>J. N. Darby’s <T muted style={face('serif', { italic: true })}>The Holy Scriptures: A New Translation from the Original Languages</T> (New Testament 1884, Old Testament 1890). <T muted style={{ color: c.accent, textDecorationLine: 'underline' }} accessibilityRole="link" onPress={() => router.push('/credits')}>Sources are listed in Credits.</T></T></Enter>
      {hasChronology(edition) ? (
        <Card>
          <LinkRow title="Chronological table" hint="Kings and prophets of Judah and Israel, governors, the kings of Persia" onPress={() => router.push('/chronology')} />
        </Card>
      ) : null}
      {sections.map((s, i) => {
        const on = open === i
        return (
          <Card key={i} style={{ gap: 0 }}>
            <Tap onPress={() => setOpen(on ? -1 : i)} scaleTo={0.985} accessibilityRole="button" accessibilityState={{ expanded: on }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ color: c.text, fontWeight: '600', fontSize: 16, flex: 1 }}>{s.title}</Text>
              <Text style={{ color: c.muted, fontSize: 20 }}>{on ? '−' : '+'}</Text>
            </Tap>
            {on && (
              // opening a notice answers the tap: its text fades in (and the card eases open on native)
              <Body style={{ gap: 12, marginTop: 12 }}>
                <SectionBody s={s} ink={ink} bg={c.bg} />
              </Body>
            )}
          </Card>
        )
      })}
      {edition === '1961' ? (
        <T small muted>
          Source: <T small style={{ color: c.accent, textDecorationLine: 'underline' }} accessibilityRole="link" onPress={() => { Linking.openURL(d.source).catch(() => {}) }}>Darby Bible at ccel.org</T>, 1961 edition
        </T>
      ) : null}
      <View style={{ height: 24 }} />
    </Screen>
  )
}
