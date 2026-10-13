import { useSyncExternalStore } from 'react'
import type { TargetId } from '../lib/tour'

/**
 * What the tour needs from the screens it walks through, without reaching into them: the elements it points at
 * (registered by ref where they are drawn), the note it opens for a moment in the reader, and requests to start.
 */

type Listener = () => void
const store = <T,>(initial: T) => {
  let value = initial
  const ls = new Set<Listener>()
  return {
    get: () => value,
    set: (v: T) => { if (Object.is(v, value)) return; value = v; ls.forEach(l => l()) },
    subscribe: (l: Listener) => { ls.add(l); return () => { ls.delete(l) } },
  }
}

// ---- targets ----

/** Anything React Native can measure in window coordinates (a host view). */
export interface Measurable { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void }
const targets = new Map<TargetId, Set<Measurable>>()
type TourRef = (el: unknown) => (() => void) | void
const refs = new Map<TargetId, TourRef>()

/**
 * A stable ref for an element the tour may point at. Several can share an id (the reader keeps the chapters either
 * side mounted): the tour takes the one on screen. Costs nothing when no tour runs.
 */
export function tourRef(id: TargetId): TourRef {
  let r = refs.get(id)
  if (!r) {
    r = raw => {
      const el = raw as Measurable | null
      if (!el || typeof el.measureInWindow !== 'function') return
      let set = targets.get(id)
      if (!set) targets.set(id, (set = new Set()))
      set.add(el)
      return () => { set!.delete(el) }
    }
    refs.set(id, r)
  }
  return r
}
export const tourTargets = (id: TargetId): Measurable[] => [...(targets.get(id) ?? [])]

// ---- the note the tour opens ----

const note = store<number | null>(null)
export const setTourNote = note.set
/** The note id the tour is showing open, if any; the reader opens it as if tapped. */
export function useTourNote(): number | null { return useSyncExternalStore(note.subscribe, note.get, note.get) }

// ---- starting ----

export interface TourRequest { n: number; chapter: { book: number; chapter: number } | null; full: boolean }
const request = store<TourRequest>({ n: 0, chapter: null, full: false })
/**
 * Starts the tour: after the welcome (with the chapter it chose, if any) or from Settings. `full` goes straight
 * through everything; otherwise it is the short tour, which offers the rest at its end.
 */
export function startTour(chapter: { book: number; chapter: number } | null = null, full = false) { request.set({ n: request.get().n + 1, chapter, full }) }
export function useTourRequest(): TourRequest { return useSyncExternalStore(request.subscribe, request.get, request.get) }

// ---- what the full tour can open and close on the screens it walks through ----

export interface TourControls {
  /**
   * The reader: select a verse (the action bar; one with ministry when the chapter has some) or clear the selection;
   * open one of its sheets or close it: More, themes, the word sheet on a word of the chapter, the Ministry sheet on the
   * selected verse. Resolves false when the sheet has nothing to show here (no tagged word), so the step is passed.
   */
  reader?: {
    select: (on: boolean) => Promise<void>; sheet: (which: 'more' | 'themes' | 'word' | 'ministry' | null) => Promise<boolean>
    /** Scroll the chapter to its end, or back to where it was before. */
    end: (on: boolean) => void
  }
  /** The read-aloud bar: its listening settings sheet. */
  player?: { settings: (open: boolean) => void }
  /** The outline editor: its print sheet. */
  editor?: { print: (open: boolean) => void }
}
const controls: TourControls = {}
/** A screen offers its controls while it is focused; the returned function withdraws them. */
export function offerTourControls<K extends keyof TourControls>(k: K, c: NonNullable<TourControls[K]>): () => void {
  controls[k] = c
  return () => { if (controls[k] === c) delete controls[k] }
}
export const tourControls = (): TourControls => controls

// ---- the theme step: a swatch tap goes to the tour's blob instead of switching at once ----

export type ThemePick = (id: string, from: Measurable) => void
let themePick: ThemePick | null = null
export const setThemePick = (p: ThemePick | null) => { themePick = p }
export const tourThemePick = () => themePick

// ---- the sample outline the full tour makes for the editor steps, and removes again ----

const sample = store<number | null>(null)
export const setTourSample = sample.set
export function useTourSample(): number | null { return useSyncExternalStore(sample.subscribe, sample.get, sample.get) }

// ---- screens that scroll: the tour brings a target into view in them (native; the web scrolls the element itself) ----

export interface Scroller { scrollTo: (o: { y: number; animated?: boolean }) => void; getInnerViewRef?: () => unknown; getInnerViewNode?: () => unknown }
const scrollers = new Set<Scroller>()
/** Ref for a screen's ScrollView (ui.tsx `Screen` registers every one). */
export function tourScroller(el: unknown): (() => void) | void {
  const s = el as Scroller | null
  if (!s || typeof s.scrollTo !== 'function') return
  scrollers.add(s)
  return () => { scrollers.delete(s) }
}
export const tourScrollers = (): Scroller[] => [...scrollers]
