// A held list is approved on the parent's own device, outside the voice channel. The
// parent's phone view polls /api/approvals; if Resend is configured, an email with the
// signed approve/decline links is sent as well.
import { member, type Approval, type Household } from './domain.js'

export const escapeHtml = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function approvalLinks(a: Approval, baseUrl: string, householdId: string) {
  const q = (approve: boolean) => `${baseUrl}/api/decide?h=${encodeURIComponent(householdId)}&id=${a.id}&t=${a.token}&a=${approve ? 1 : 0}`
  return { approve: q(true), decline: q(false) }
}

export async function notifyApprover(h: Household, a: Approval, baseUrl: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const to = process.env.HEARTH_APPROVER_EMAIL
  if (!key || !to) return false
  const who = member(h, a.requestedBy).name
  const links = approvalLinks(a, baseUrl, h.id)
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.HEARTH_FROM_EMAIL ?? 'Hearth <onboarding@resend.dev>',
      to,
      subject: `${who} wants to buy: $${a.total}`,
      html: `<p>${escapeHtml(who)} asked Hearth to buy:</p><ul>${a.lines.map((l) => `<li>${l.qty} × ${escapeHtml(l.item)}</li>`).join('')}</ul><p>Why it needs you: ${escapeHtml(a.reason)}.</p><p><a href="${links.approve}">Approve</a> · <a href="${links.decline}">Decline</a></p>`,
    }),
  }).catch(() => undefined)
  return !!r?.ok
}
