import { useEffect, useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'
import type { Outline } from '@shared/types'
import {
  FONT_PT_MAX, FONT_PT_MIN, MARGIN_MAX, MARGIN_MIN, PAPERS, PRINT_DEFAULTS, PRINT_STYLES, loadPrintSettings, paperById, printOutline, savePrintSettings,
  type PaperId, type PrintMode, type PrintSettings, type VerseRow,
} from '../lib/outlines'
import { useColors } from '../hooks/useTheme'
import { Button, ErrorText, H2, Row, Segmented, Sheet, T } from './ui'
import PrintLayoutPreview, { PREVIEW_H } from './PrintLayoutPreview'
import { tourRef } from '../store/tour'
import { NOUN } from '@shared/brand'

interface Props { open: boolean; onClose: () => void; outline: Outline; verses: Map<string, VerseRow[]>; loading: boolean }

/**
 * A layout preview of the printed pages, then paper / margin / font / columns / style for the printable document.
 * Settings persist across outlines. Web prints through the browser dialog (Save as PDF lives there); native sends
 * it to the system print dialog or renders a PDF for the share sheet.
 */
export default function OutlinePrintSheet({ open, onClose, outline, verses, loading }: Props) {
  const [s, setS] = useState<PrintSettings>(PRINT_DEFAULTS)
  const [busy, setBusy] = useState<PrintMode | null>(null)
  const [err, setErr] = useState('')
  // the preview waits for the saved settings: drawing the defaults first would re-flow it as the sheet opens
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!open) { setReady(false); return }
    setErr('')
    let live = true
    loadPrintSettings().then(v => { if (live) setS(v) }).catch(() => {}).finally(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [open])
  const set = <K extends keyof PrintSettings>(k: K, v: PrintSettings[K]) => setS(prev => ({ ...prev, [k]: v }))
  const paper = paperById(s.paper)
  const round = (n: number, step: number) => Math.round(n / step) * step

  const run = async (mode: PrintMode) => {
    setErr(''); setBusy(mode)
    void savePrintSettings(s)
    try {
      // web branch opens the window synchronously, inside the click: popup blockers allow it
      await printOutline(outline, verses, s, mode)
      if (Platform.OS !== 'web') onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not print'
      // the user dismissing the native share/print dialog is not an error
      if (!/cancel|dismiss/i.test(msg)) setErr(msg)
    } finally { setBusy(null) }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Print / Save PDF" maxHeight="90%">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }} keyboardShouldPersistTaps="handled">
        <View ref={tourRef('print-sheet')}>{ready ? <PrintLayoutPreview outline={outline} verses={verses} settings={s} /> : <View style={{ height: PREVIEW_H }} />}</View>

        <H2>Paper</H2>
        <Segmented<PaperId> value={s.paper} options={PAPERS.map(p => ({ value: p.id, label: p.label }))} onChange={v => set('paper', v)} />
        <T small muted>{paper.size}</T>

        <Stepper label="Margins" shown={`${s.margin.toFixed(2)} in`} onDown={() => set('margin', Math.max(MARGIN_MIN, round(s.margin - 0.05, 0.05)))} onUp={() => set('margin', Math.min(MARGIN_MAX, round(s.margin + 0.05, 0.05)))} canDown={s.margin > MARGIN_MIN} canUp={s.margin < MARGIN_MAX} />
        <Stepper label="Font size" shown={`${s.font} pt`} onDown={() => set('font', Math.max(FONT_PT_MIN, round(s.font - 0.5, 0.5)))} onUp={() => set('font', Math.min(FONT_PT_MAX, round(s.font + 0.5, 0.5)))} canDown={s.font > FONT_PT_MIN} canUp={s.font < FONT_PT_MAX} />

        <H2>Columns</H2>
        <Segmented<'1' | '2'> value={s.columns === 2 ? '2' : '1'} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }]} onChange={v => set('columns', v === '2' ? 2 : 1)} />

        <H2>Style</H2>
        <Segmented<PrintSettings['style']> value={s.style} options={[{ value: '', label: `${NOUN.One} default` }, ...PRINT_STYLES]} onChange={v => set('style', v)} />

      </ScrollView>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
        {err ? <ErrorText>{err}</ErrorText> : null}
        {loading ? <T small muted>Loading verse text…</T> : null}
        <Row>
          {Platform.OS === 'web'
            ? <Button primary title="Print" disabled={loading || !!busy} onPress={() => { void run('pdf') }} />
            : <>
              <Button primary title={busy === 'print' ? 'Preparing…' : 'Print'} disabled={loading || !!busy} onPress={() => { void run('print') }} />
              <Button title={busy === 'pdf' ? 'Preparing…' : 'Share PDF'} disabled={loading || !!busy} onPress={() => { void run('pdf') }} />
            </>}
          <Button title="Close" onPress={onClose} />
        </Row>
      </View>
    </Sheet>
  )
}

function Stepper({ label, shown, onDown, onUp, canDown, canUp }: { label: string; shown: string; onDown: () => void; onUp: () => void; canDown: boolean; canUp: boolean }) {
  const c = useColors()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
      <T style={{ flex: 1 }}>{label}</T>
      <Button small icon title="−" accessibilityLabel={`${label} smaller`} disabled={!canDown} onPress={onDown} />
      <T style={{ minWidth: 64, textAlign: 'center', color: c.muted, fontVariant: ['tabular-nums'] }}>{shown}</T>
      <Button small icon title="+" accessibilityLabel={`${label} larger`} disabled={!canUp} onPress={onUp} />
    </View>
  )
}
