import { useState } from 'react'
import { Linking, Platform, View } from 'react-native'
import { Stack } from 'expo-router'
import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts'
import { hashContacts, ownContactHashes, regionFromLocale } from '@shared/contacts'
import { errMsg, useLoad } from '../../src/lib/community'
import { clearDiscoverable, inviteContact, loadFriends, matchContacts, setDiscoverable } from '../../src/lib/friends'
import { useAuth } from '../../src/store/auth'
import { useToast } from '../../src/store/toast'
import Avatar from '../../src/components/Avatar'
import SignInCard from '../../src/components/SignInCard'
import { MotionItem, Swap, useArrivals } from '../../src/components/motion/community'
import { Button, Card, Enter, ErrorText, H2, Input, Row, Screen, Spinner, T } from '../../src/components/ui'
import { BRAND } from '@shared/brand'

/** The device's region, for phone numbers written without their country code. */
const deviceRegion = (): string | null => { try { return regionFromLocale(Intl.DateTimeFormat().resolvedOptions().locale) } catch { return null } }

/**
 * Contacts, both ways and both opt-in. Find: this phone's contacts are read here, each number and email turned into a
 * salted SHA-256 fingerprint on the device, and only the fingerprints go to the server, which keeps none of them and
 * answers with the handles of people who chose to be found. Be found: your own number or email, fingerprinted the same
 * way, is all that is stored. The threat model is in docs/API.md and the privacy policy.
 */
export default function ContactsScreen() {
  const { user } = useAuth()
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'Contacts' }} />
      {user ? <><Find /><BeFound /></> : <SignInCard text="Sign in to find friends from your contacts." />}
    </Screen>
  )
}

type Match = { handle: string; display_name: string; avatar?: string }

function Find() {
  const toast = useToast()
  const [phase, setPhase] = useState<'idle' | 'reading' | 'done' | 'denied'>('idle')
  const [matches, setMatches] = useState<Match[]>([])
  const [counted, setCounted] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set())
  const arrivals = useArrivals(phase === 'done' ? matches.map(m => m.handle) : null)
  if (Platform.OS === 'web') {
    return (
      <Enter style={{ gap: 12 }}>
        <H2>Find friends from my contacts</H2>
        <Card><T small muted>This needs the {BRAND.name} app on a phone: the contacts are read there and never leave it.</T></Card>
      </Enter>
    )
  }
  const find = async () => {
    setErr(null); setPhase('reading')
    try {
      const p = await requestPermissionsAsync()
      if (!p.granted) { setPhase('denied'); return }
      const all = await Contact.getAllDetails([ContactField.PHONES, ContactField.EMAILS])
      const phones: string[] = [], emails: string[] = []
      for (const d of all) {
        for (const ph of d.phones ?? []) if (ph.number) phones.push(ph.number)
        for (const em of d.emails ?? []) if (em.address) emails.push(em.address)
      }
      const h = hashContacts({ phones, emails }, deviceRegion())
      setCounted(h.phones + h.emails)
      const r = h.hashes.length ? await matchContacts(h.hashes) : { matches: [] }
      setMatches(r.matches); setPhase('done')
    } catch (e) { setErr(errMsg(e)); setPhase('idle') }
  }
  const invite = async (m: Match) => {
    try {
      const r = await inviteContact(m.handle)
      setSent(s => new Set([...s, m.handle]))
      if (r.status === 'friends') toast.show(`You and ${m.display_name} are friends`)
    } catch (e) { toast.show(errMsg(e)) }
  }
  return (
    <Enter style={{ gap: 12 }}>
      <H2>Find friends from my contacts</H2>
      <Card>
        <T small muted>Your contacts are read on this phone. Each number and email is turned into a scrambled fingerprint here, and only the fingerprints are sent. They are not kept, and nobody is told you looked. You see only people who chose to be found by their contacts.</T>
        {phase === 'idle' || phase === 'denied' ? <Button primary title="Find friends from my contacts" onPress={() => { void find() }} style={{ alignSelf: 'flex-start' }} /> : null}
        {phase === 'reading' ? <Spinner label="Looking" /> : null}
        {phase === 'denied' ? <><T small muted>Contacts are off for {BRAND.name} in the system settings.</T><Button small title="Open system settings" onPress={() => { Linking.openSettings().catch(() => {}) }} style={{ alignSelf: 'flex-start' }} /></> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {phase === 'done' ? <Swap k={`done-${matches.length}`}><T small muted>{matches.length ? `${matches.length} of your contacts ${matches.length === 1 ? 'is' : 'are'} here and can be invited.` : `None of the ${counted} numbers and emails in your contacts belong to someone who chose to be found.`}</T></Swap> : null}
      </Card>
      {phase === 'done' ? matches.map((m, i) => (
        <MotionItem key={m.handle} {...arrivals.modeFor(m.handle, i)} gap={12}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={m.display_name} avatar={m.avatar} size={40} />
            <View style={{ flex: 1 }}><T bold numberOfLines={1}>{m.display_name}</T><T small muted>@{m.handle}</T></View>
            <Swap k={sent.has(m.handle) ? 'sent' : 'invite'}>
              {sent.has(m.handle) ? <T small muted>Invite sent</T> : <Button small primary title="Invite" onPress={() => { void invite(m) }} />}
            </Swap>
          </Card>
        </MotionItem>
      )) : null}
    </Enter>
  )
}

function BeFound() {
  const { state, reload } = useLoad(loadFriends, [])
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [errs, setErrs] = useState<{ phone?: string; email?: string; server?: string }>({})
  const [busy, setBusy] = useState(false)
  const on = state.kind === 'ready' && state.data.discoverable
  const save = async () => {
    const r = ownContactHashes(phone.trim() || null, email.trim() || null, deviceRegion())
    if (r.errors.phone || r.errors.email || !r.hashes.length) { setErrs(r.hashes.length ? r.errors : { ...r.errors, server: r.errors.phone || r.errors.email ? undefined : 'Enter a phone number or an email address.' }); return }
    setBusy(true); setErrs({})
    try { await setDiscoverable(r.hashes); setPhone(''); setEmail(''); reload() } catch (e) { setErrs({ server: errMsg(e) }) } finally { setBusy(false) }
  }
  const off = async () => { setBusy(true); try { await clearDiscoverable(); reload() } catch (e) { setErrs({ server: errMsg(e) }) } finally { setBusy(false) } }
  return (
    <Enter delay={120} style={{ gap: 12 }}>
      <H2>Let contacts find me</H2>
      <Card>
        {state.kind === 'loading' ? <Spinner /> : null}
        <Swap k={on ? 'on' : 'off'}>
          {on ? (
            <View style={{ gap: 10 }}>
              <T>On. People who have your number or email in their contacts can find your handle and invite you.</T>
              <Button title={busy ? 'Turning off…' : 'Turn off'} disabled={busy} onPress={() => { void off() }} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <T small muted>Enter your own phone number, email or both. Only a scrambled fingerprint of each is stored, never your contacts, and you can turn this off at any time.</T>
              <Input value={phone} onChangeText={setPhone} placeholder="Phone, such as +44 7700 900123" keyboardType="phone-pad" autoComplete="tel" accessibilityLabel="Your phone number" />
              {errs.phone ? <ErrorText>{errs.phone}</ErrorText> : null}
              <Input value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoComplete="email" accessibilityLabel="Your email address" />
              {errs.email ? <ErrorText>{errs.email}</ErrorText> : null}
              <Row><Button primary title={busy ? 'Saving…' : 'Let contacts find me'} disabled={busy} onPress={() => { void save() }} /></Row>
            </View>
          )}
        </Swap>
        {errs.server ? <ErrorText>{errs.server}</ErrorText> : null}
        <T small muted>A fingerprint of a phone number can be worked back by someone who tries every number, so turn this on only if you are happy to be found by people who know how to reach you.</T>
      </Card>
    </Enter>
  )
}
