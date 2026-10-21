import { useEffect, useSyncExternalStore } from 'react'
import { AppState, Linking, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BRAND } from '@shared/brand'
import { noticeFor, type StoreInfo } from './storeUpdateCore'

/**
 * A newer version on Google Play (lib/storeUpdateCore.ts says when): Android installs from Play only, asked of Play
 * (modules/store-update, a call to the Play app on the phone) at start and at every return to the app. The last answer
 * is kept, so the line is there from the first frame. The web is always the site's current version, and an install
 * that is not Play's gets no answer from Play, so neither ever shows anything.
 */
interface Native { check(): Promise<StoreInfo | null> }
const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('StoreUpdate') : null
const installed = Constants.expoConfig?.android?.versionCode ?? 0
const KEY = 'storeUpdate'
interface Saved { installed: number; info: StoreInfo | null; dismissed: number | null }

let saved: Saved | null = null
let loaded: Promise<void> | null = null
let asking = false
/** Home's line (closed for a build by its ×), and the Settings footer's word (never closed) */
let notice: number | null = null
let offered: number | null = null
/** Play answered for this install, so it is Play's (Home's review ask is only for those) */
let fromPlay = false
const subs = new Set<() => void>()
const publish = () => {
  const info = saved?.installed === installed ? saved.info : null
  const n = noticeFor(info, installed, saved?.dismissed ?? null), o = noticeFor(info, installed, null)
  if (n === notice && o === offered && !!info === fromPlay) return
  notice = n; offered = o; fromPlay = !!info
  for (const s of subs) s()
}
const store = () => AsyncStorage.setItem(KEY, JSON.stringify(saved)).catch(() => {})
const load = () => loaded ??= AsyncStorage.getItem(KEY).then(s => { saved = s ? JSON.parse(s) as Saved : null }).catch(() => {})

async function refresh() {
  if (!native || asking) return
  await load()
  publish()
  asking = true
  try {
    const info = await native.check().catch(() => null)
    saved = { installed, info, dismissed: saved?.dismissed ?? null }
    void store()
    publish()
  } finally { asking = false }
}

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb) } }
/** The version code Play offers that the reader should hear of, or null; asks Play again on every return to the app.
 *  `closed`: also when the reader closed Home's line for it. */
export function useStoreUpdate(closed = false): number | null {
  useEffect(() => {
    if (!native) return
    void refresh()
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void refresh() })
    return () => sub.remove()
  }, [])
  return useSyncExternalStore(subscribe, closed ? () => offered : () => notice, () => null)
}

/** Whether this is an install from Google Play (Play answered for it); false on the web and before Play's first answer. */
export function usePlayInstall(): boolean {
  useEffect(() => { if (native) void refresh() }, [])
  return useSyncExternalStore(subscribe, () => fromPlay, () => false)
}

/** Closes the line until Play offers a later build than this one. */
export function dismissStoreUpdate(code: number) {
  saved = { installed, info: saved?.info ?? null, dismissed: code }
  void store()
  publish()
}

/** The app's page in the Play Store app, else on the web. */
export function openStore() {
  const id = BRAND.androidPackage
  Linking.openURL(`market://details?id=${id}`).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${id}`))
}
