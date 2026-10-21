import { useEffect, useState } from 'react'
import { get, post } from './api'
import { usePlayInstall } from './storeUpdate'

/**
 * The owner's ask for a review (rs/src/review_ask.rs, docs/API.md "Review ask"): the server says whether this reader is
 * to be asked, which only happens while the owner has an ask running and the reader has read enough. Asked when Home
 * opens, signed in, on an Android install from Google Play; Home shows it (components/ReviewAsk.tsx).
 */
export type ReviewAnswer = 'like' | 'dislike' | 'later'
export const fetchReviewAsk = () => get<{ ask: number | null }>('/review-ask')
/** The answer, that the reader opened the store page, or the feedback message they sent from the ask. */
export const answerReviewAsk = (id: number, body: { answer?: ReviewAnswer; store?: true; feedback_id?: number }) => post<{ ok: true }>(`/review-ask/${id}`, body)

/** The ask to show, or null. */
export function useReviewAsk(signedIn: boolean): number | null {
  const play = usePlayInstall()
  const [ask, setAsk] = useState<number | null>(null)
  useEffect(() => {
    if (!signedIn || !play) { setAsk(null); return }
    let live = true
    fetchReviewAsk().then(r => { if (live) setAsk(r.ask) }, () => {})
    return () => { live = false }
  }, [signedIn, play])
  return ask
}
