/**
 * The device this app runs on, for bans only (rs/src/bans.rs: a banned person's device cannot make a new account,
 * and an account seen on it is ban evasion). Android: the Android id, which is per app signing key and survives a
 * reinstall; iOS: the vendor id; web: a random id kept in storage. Sent only by signed-in or signing-in requests
 * (api.ts), so a reader without an account still sends nothing; the server keeps only a SHA-256 of it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import { Platform } from 'react-native'

const KEY = 'jottings_device_id'
let id: Promise<string | null> | null = null

function random(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

export function deviceId(): Promise<string | null> {
  id ??= (async () => {
    try {
      if (Platform.OS === 'android') { const a = Application.getAndroidId(); if (a) return `a:${a}` }
      if (Platform.OS === 'ios') { const v = await Application.getIosIdForVendorAsync(); if (v) return `i:${v}` }
    } catch { /* a platform without the id falls back to a stored one */ }
    try {
      let r = await AsyncStorage.getItem(KEY)
      if (!r) { r = random(); await AsyncStorage.setItem(KEY, r) }
      return `r:${r}`
    } catch { return null }
  })()
  return id
}
