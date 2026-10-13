import AsyncStorage from '@react-native-async-storage/async-storage'
import { pollPath, readMark, takeFresh, markSeen, type IncomingReply, type InviteLite, type InviteMark } from './inviteNoticePlan'

/**
 * The device's invite mark (`inviteNoticePlan.ts`), shared by the app and the background check. Updates run one at a
 * time within the process, so a check and the Friends screen opening at once cannot lose each other's ids.
 */
const MARK_KEY = 'berean_invite_mark'
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run }

async function load(uid: number): Promise<InviteMark> {
  try { const raw = await AsyncStorage.getItem(MARK_KEY); return readMark(raw ? JSON.parse(raw) : null, uid) } catch { return readMark(null, uid) }
}
const save = (m: InviteMark) => AsyncStorage.setItem(MARK_KEY, JSON.stringify(m)).catch(() => {})

/** One check: the invites new since the mark (none on a device's first check), and the mark moved past them. */
export function checkInvitesOnce(uid: number, fetchReply: (path: string) => Promise<IncomingReply>): Promise<{ fresh: InviteLite[]; open: boolean }> {
  return serial(async () => {
    const mark = await load(uid)
    const reply = await fetchReply(pollPath(mark))
    const next = takeFresh(reply, mark)
    await save(next.mark)
    return { fresh: next.fresh, open: reply.open }
  })
}

/** Invites the reader has seen on screen: never announced later. */
export function noteInvitesSeen(uid: number, invites: InviteLite[]): Promise<void> {
  if (!invites.length) return Promise.resolve()
  return serial(async () => {
    const mark = await load(uid)
    const next = markSeen(mark, invites)
    if (next !== mark) await save(next)
  })
}
