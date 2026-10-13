import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

/**
 * A layer above whatever is showing, for the tour and its theme blob. A sheet is a Modal (its own window on Android
 * and iOS, a portal on the web), so anything meant to sit over an open sheet has to be drawn inside it: the root and
 * every open sheet mount a host, and only the newest host draws the layer. Content is published by key and drawn in
 * key order.
 */
type Listener = () => void
const listeners = new Set<Listener>()
const emit = () => listeners.forEach(l => l())
const subscribe = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l) } }

let hosts: number[] = []
let nextHost = 1
const content = new Map<string, ReactNode>()
let version = 0
const getVersion = () => version
const topHost = () => hosts[hosts.length - 1] ?? 0

/** Draws `node` in the top layer under `key` (null removes it). */
export function publishOverlay(key: string, node: ReactNode | null) {
  if (node === null) { if (!content.delete(key)) return }
  else content.set(key, node)
  version++
  emit()
}

/** Mounted by the root layout (always) and by each open sheet (inside its Modal, above the sheet). */
export function OverlayHost() {
  const id = useRef(0)
  const [, force] = useState(0)
  useEffect(() => {
    id.current = nextHost++
    hosts = [...hosts, id.current]
    version++; emit()
    return () => { hosts = hosts.filter(h => h !== id.current); version++; emit() }
  }, [])
  useSyncExternalStore(subscribe, getVersion, getVersion)
  useEffect(() => { force(n => n + 1) }, [])
  if (!id.current || topHost() !== id.current || content.size === 0) return null
  // no wrapping view: on the web a box-none wrapper turns every descendant back on for touches, and the tour needs
  // its spotlight to let taps through to the app while its veil takes none
  return <>{[...content.keys()].sort().map(k => <Fragment key={k}>{content.get(k)}</Fragment>)}</>
}
