import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { parseRef } from '@shared/ref'
import { useColors } from '../hooks/useTheme'
import { usePref } from '../store/prefs'
import { face } from '../theme'
import { refParams } from './FootnoteText'

export interface KRow { pj?: string; kj?: string; rj?: string; bj?: number; ref?: string; bi?: number; ki?: string; ri?: string; pi?: string }
export interface GRow { prophet?: string; governor: string; bc: number; ref?: string }
export interface PRow { bc: number; event: string; ref?: string }
export interface Chron { source: string; title: string; subtitle: string; kingdoms: { columns: string[]; rows: KRow[] }; governors: { title: string; columns: string[]; rows: GRow[] }; persia: { title: string; rows: PRow[] } }

/** Rows whose Israel cell is a narrative ("Shalmaneser ... puts an end to the kingdom") rather than a king. */
export const isEvent = (r: KRow) => !!r.ki && /\.|reigns|captivity|destroys|Assyria/i.test(r.ki)

/*
 * Typeset like a LaTeX booktabs table: a heavy rule above and below, a light rule under the headings,
 * no vertical rules, headings in small capitals, text in the reader's font, figures tabular and right-aligned.
 * The theme supplies every colour; rules are drawn in the text colour at low weight so they sit in any theme.
 */
const RULE_HEAVY = 1.5
const RULE_LIGHT = 0.75
/** The reader's font (Serif unless changed in Settings → Text): regular, italic, bold. */
function useFaces() {
  const font = usePref('font')
  return useMemo(() => ({ r: face(font), i: face(font, { italic: true }), b: face(font, { bold: true }) }), [font])
}

/** "1 Kings 14:20-21; Ezra 1:8-10" -> tappable links into the reader (Darby's "Neh. 1:1" and "2 Chron. 25.15" forms included). */
export function RefLinks({ s, small }: { s?: string; small?: boolean }) {
  const c = useColors()
  const f = useFaces()
  const router = useRouter()
  if (!s) return null
  return (
    <Text style={{ color: c.muted, fontSize: small ? 13 : 14, ...f.r }}>
      {s.split(';').map((part, i) => {
        const t = part.trim()
        // "2 Chron. 25.15" -> "2 Chron 25:15": a dot between digits is a verse separator, any other dot is an abbreviation
        const r = parseRef(t.replace(/(\d)\.(\d)/g, '$1:$2').replace(/\./g, ''))
        return (
          <Text key={i}>
            {i > 0 ? '; ' : ''}
            {r ? <Text accessibilityRole="link" style={{ color: c.accent }} onPress={() => router.push(refParams(r))}>{t}</Text> : t}
          </Text>
        )
      })}
    </Text>
  )
}

const Prophet = ({ name, style }: { name?: string; style?: StyleProp<ViewStyle> }) => {
  const c = useColors()
  const f = useFaces()
  return <View style={style}>{name ? <Text style={{ color: c.text, fontSize: 14, lineHeight: 19, ...f.i }}>{name}</Text> : null}</View>
}
const King = ({ name, reign, event, style }: { name?: string; reign?: string; event?: boolean; style?: StyleProp<ViewStyle> }) => {
  const c = useColors()
  const f = useFaces()
  if (!name) return <View style={style} />
  return (
    <View style={style}>
      <Text style={event ? { color: c.muted, fontSize: 14, lineHeight: 19, ...f.i } : { color: c.text, fontSize: 15, lineHeight: 20, ...f.r }}>{name}</Text>
      {reign && !event ? <Text style={{ color: c.muted, fontSize: 13, lineHeight: 17, ...f.r }}>{reign}</Text> : null}
    </View>
  )
}
const Year = ({ y, style }: { y?: number; style?: StyleProp<ViewStyle> }) => {
  const c = useColors()
  const f = useFaces()
  return <View style={style}><Text style={{ color: c.text, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'], ...f.r }}>{y ?? ''}</Text></View>
}
/** Column heading in small capitals, as \textsc{} would set it. */
const Th = ({ children, style, align = 'left' }: { children: string; style?: StyleProp<ViewStyle>; align?: TextStyle['textAlign'] }) => {
  const c = useColors()
  return <View style={style}><Sc color={c.text} size={13} align={align}>{children}</Sc></View>
}
/** Small capitals set by hand (uppercase at ~82% size, tracked): Android has no small-cap feature for Literata,
 *  so fontVariant small-caps rendered plain lowercase there. */
export const Sc = ({ children, color, size, align, bold }: { children: string; color: string; size: number; align?: TextStyle['textAlign']; bold?: boolean }) => {
  const f = useFaces()
  return <Text style={{ color, fontSize: Math.round(size * 0.82), letterSpacing: size * 0.08, textAlign: align, ...(bold ? f.b : f.r) }}>{children.toUpperCase()}</Text>
}
/** A horizontal rule: heavy for \toprule and \bottomrule, light for \midrule; `inset` trims it like \cmidrule(lr). */
export const Rule = ({ heavy, inset = 0, flex }: { heavy?: boolean; inset?: number; flex?: number }) => {
  const c = useColors()
  return <View style={{ flex, height: heavy ? RULE_HEAVY : RULE_LIGHT, backgroundColor: c.text, opacity: heavy ? 0.85 : 0.5, marginHorizontal: inset }} />
}

// column weights; the two kingdom groups must sum alike so the spanning headings line up with the columns below
const J = { prophets: 1.35, king: 1.45, bc: 0.55, ref: 1.15 }   // 4.5
const I = { bc: 0.55, king: 2.1, prophets: 1.35 }                 // 4.0
const GAP = 0.3
const SUM_J = J.prophets + J.king + J.bc + J.ref, SUM_I = I.bc + I.king + I.prophets

/** Wide layout: one table, Judah on the left and Israel on the right, scrolling sideways if it must. */
/** `width` is the container's width: a horizontal ScrollView gives its child no width constraint, so the table sets its own. */
export function KingdomsTable({ rows, width }: { rows: KRow[]; width: number }) {
  const c = useColors()
  const cell = (flex: number, extra?: ViewStyle): ViewStyle => ({ flex, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center', ...extra })
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ width: Math.max(760, Math.floor(width)), paddingVertical: 4 }}>
        <Rule heavy />
        {/* \multicolumn headings with \cmidrule under each kingdom */}
        <View style={styles.row}>
          <View style={cell(SUM_J, { alignItems: 'center', paddingTop: 10, paddingBottom: 4 })}><Sc color={c.text} size={15} bold>Judah</Sc></View>
          <View style={{ flex: GAP }} />
          <View style={cell(SUM_I, { alignItems: 'center', paddingTop: 10, paddingBottom: 4 })}><Sc color={c.text} size={15} bold>Israel</Sc></View>
        </View>
        <View style={styles.row}><Rule flex={SUM_J} inset={8} /><View style={{ flex: GAP }} /><Rule flex={SUM_I} inset={8} /></View>
        <View style={styles.row}>
          <Th style={cell(J.prophets)}>Prophets</Th><Th style={cell(J.king)}>King</Th><Th style={cell(J.bc)} align="right">B.C.</Th><Th style={cell(J.ref)}>Reference</Th>
          <View style={{ flex: GAP }} />
          <Th style={cell(I.bc)} align="right">B.C.</Th><Th style={cell(I.king)}>King</Th><Th style={cell(I.prophets)}>Prophets</Th>
        </View>
        <Rule />
        {rows.map((r, i) => {
          const ev = isEvent(r)
          return (
            <View key={i} style={[styles.row, { backgroundColor: ev ? c.selected : undefined }]}>
              <Prophet name={r.pj} style={cell(J.prophets)} />
              <King name={r.kj} reign={r.rj} style={cell(J.king)} />
              <Year y={r.bj} style={cell(J.bc)} />
              <View style={cell(J.ref)}><RefLinks s={r.ref} small /></View>
              <View style={{ flex: GAP }} />
              <Year y={r.bi} style={cell(I.bc)} />
              <King name={r.ki} reign={r.ri} event={ev} style={cell(I.king)} />
              <Prophet name={r.pi} style={cell(I.prophets)} />
            </View>
          )
        })}
        <Rule heavy />
      </View>
    </ScrollView>
  )
}

/** Narrow layout: each row becomes a Judah entry beside (or above) an Israel entry, so nothing scrolls sideways. */
export function KingdomCards({ rows }: { rows: KRow[] }) {
  const c = useColors()
  const f = useFaces()
  const label = (s: string) => <Sc color={c.muted} size={13}>{s}</Sc>
  const year = (y?: number) => y ? <Text style={{ color: c.muted, fontSize: 13, fontVariant: ['tabular-nums'], ...f.r }}>{y} <Sc color={c.muted} size={13}>b.c.</Sc></Text> : null
  return (
    <View>
      <Rule heavy />
      {rows.map((r, i) => {
        const ev = isEvent(r)
        const hasJ = !!(r.kj || r.pj || r.bj), hasI = !!(r.ki || r.pi || r.bi)
        return (
          <View key={i} style={{ paddingVertical: 8, gap: 6, borderBottomWidth: RULE_LIGHT, borderBottomColor: c.border }}>
            {hasJ ? (
              <View style={[styles.entry, { borderLeftColor: c.accent }]}>
                <View style={styles.entryHead}>{label('judah')}{year(r.bj)}</View>
                <King name={r.kj} reign={r.rj} />
                {r.pj ? <Text style={{ color: c.muted, fontSize: 13, ...f.r }}>Prophet <Text style={{ color: c.text, ...f.i }}>{r.pj}</Text></Text> : null}
              </View>
            ) : null}
            {hasI ? (
              <View style={[styles.entry, { borderLeftColor: c.muted, backgroundColor: ev ? c.selected : undefined }]}>
                <View style={styles.entryHead}>{label('israel')}{year(r.bi)}</View>
                <King name={r.ki} reign={r.ri} event={ev} />
                {r.pi ? <Text style={{ color: c.muted, fontSize: 13, ...f.r }}>Prophet <Text style={{ color: c.text, ...f.i }}>{r.pi}</Text></Text> : null}
              </View>
            ) : null}
            {r.ref ? <View style={{ paddingLeft: 12 }}><RefLinks s={r.ref} /></View> : null}
          </View>
        )
      })}
      <Rule heavy />
    </View>
  )
}

export function GovernorsTable({ rows }: { rows: GRow[] }) {
  const c = useColors()
  const cell = (flex: number): ViewStyle => ({ flex, paddingHorizontal: 6, paddingVertical: 6, justifyContent: 'center' })
  return (
    <View style={{ paddingVertical: 4 }}>
      <Rule heavy />
      <View style={styles.row}>
        <Th style={cell(1.1)}>Prophet</Th><Th style={cell(1.1)}>Governor</Th><Th style={cell(0.5)} align="right">B.C.</Th><Th style={cell(1)}>Reference</Th>
      </View>
      <Rule />
      {rows.map((r, i) => {
        const ev = r.governor.includes('Messiah')
        return (
          <View key={i} style={[styles.row, { backgroundColor: ev ? c.selected : undefined }]}>
            <Prophet name={r.prophet} style={cell(1.1)} />
            <King name={r.governor} style={cell(1.1)} />
            <Year y={r.bc} style={cell(0.5)} />
            <View style={cell(1)}><RefLinks s={r.ref} small /></View>
          </View>
        )
      })}
      <Rule heavy />
    </View>
  )
}

/** The captivity and the Persian kings as a two-column list: year, then the event and its reference. */
export function PersiaTimeline({ rows }: { rows: PRow[] }) {
  const c = useColors()
  const f = useFaces()
  return (
    <View style={{ paddingVertical: 4 }}>
      <Rule heavy />
      <View style={styles.row}>
        <Th style={{ width: 56, paddingHorizontal: 6, paddingVertical: 6 }} align="right">B.C.</Th>
        <Th style={{ flex: 1, paddingHorizontal: 6, paddingVertical: 6 }}>Event</Th>
      </View>
      <Rule />
      {rows.map((r, i) => (
        <View key={i} style={styles.row}>
          <View style={{ width: 56, paddingHorizontal: 6, paddingVertical: 6 }}><Text style={{ color: c.text, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'], ...f.r }}>{r.bc}</Text></View>
          <View style={{ flex: 1, paddingHorizontal: 6, paddingVertical: 6, gap: 2 }}>
            <Text style={{ color: c.text, fontSize: 14, lineHeight: 20, ...f.r }}>{r.event}</Text>
            <RefLinks s={r.ref} small />
          </View>
        </View>
      ))}
      <Rule heavy />
    </View>
  )
}

/** A tappable link row used by both reference pages. */
export function LinkRow({ title, hint, onPress }: { title: string; hint?: string; onPress: () => void }) {
  const c = useColors()
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.accent, fontWeight: '600', fontSize: 16 }}>{title}</Text>
        {hint ? <Text style={{ color: c.muted, fontSize: 13 }}>{hint}</Text> : null}
      </View>
      <Text style={{ color: c.muted, fontSize: 18 }}>›</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  entry: { borderLeftWidth: 2, paddingLeft: 10, paddingVertical: 2, gap: 2 },
  entryHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
})
