/**
 * The reasons a reader may give when reporting something, in the order the sheet offers them. They are the service's
 * policy, not the app's code (docs/BRAND.md): the server accepts exactly the reasons its own rules list
 * (rs/moderation/rules.json `report_reasons`), so the two are edited together.
 */
export type ReportReason = string
export const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'abuse', label: 'Abuse or harassment' },
  { value: 'hate', label: 'Hate' },
  { value: 'illegal', label: 'Illegal' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'violence', label: 'Violence' },
  { value: 'privacy', label: 'Private information' },
  { value: 'copyright', label: 'Copyright: this contains someone else’s text without permission' },
  { value: 'other', label: 'Other' },
]
