/**
 * "Continue with Google". Client ids normally come from app.json (`extra.googleClientIds`); when the web
 * id is missing there, the server's `GET /api/auth/config` supplies it (the first id in
 * BEREAN_GOOGLE_CLIENT_IDS). The ID token the provider returns is exchanged at `POST /api/auth/google`.
 */
import { useEffect, useState } from 'react'
import type { User } from '@shared/types'
import { get, post } from './api'
import { googleClientIds } from './config'

export interface GoogleClientIds { ios?: string; android?: string; web?: string }
export interface GoogleServerConfig { google_client_id: string | null; google_enabled: boolean }

export const hasAnyClientId = (ids: GoogleClientIds) => Boolean(ids.ios || ids.android || ids.web)

export async function fetchGoogleConfig(): Promise<GoogleServerConfig> {
  return get<GoogleServerConfig>('/auth/config')
}

/** app.json ids, with the server's web id filling a missing `web`. Never rejects: offline means "app.json only". */
export async function resolveGoogleClientIds(): Promise<GoogleClientIds> {
  const ids: GoogleClientIds = { ...googleClientIds }
  if (ids.web) return ids
  try {
    const cfg = await fetchGoogleConfig()
    if (cfg.google_enabled && cfg.google_client_id) ids.web = cfg.google_client_id
  } catch { /* unreachable server: the button follows app.json alone */ }
  return ids
}

/** `null` until resolved so the caller can keep the button hidden rather than flash it. */
export function useGoogleClientIds(): GoogleClientIds | null {
  const [ids, setIds] = useState<GoogleClientIds | null>(null)
  useEffect(() => {
    let cancelled = false
    resolveGoogleClientIds().then(r => { if (!cancelled) setIds(r) })
    return () => { cancelled = true }
  }, [])
  return ids
}

/** Server-side verification of the ID token; the result is what the auth store's `accept` expects. */
export function exchangeGoogleToken(idToken: string): Promise<{ user: User; token: string; created?: boolean }> {
  return post<{ user: User; token: string; created?: boolean }>('/auth/google', { id_token: idToken })
}
