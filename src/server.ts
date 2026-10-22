// Hearth MCP server: MCP spec 2025-11-25 over Streamable HTTP. One server per request
// (stateless transport); household state lives in the store, so any session sees what
// earlier sessions did. Tools answer from local data only: no model calls inside tools.
import { randomBytes } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import {
  addToCart, cartTotal, checkout, cook, daysLeft, householdAllergens, member, publicApproval, suggestMeals,
  type Household,
} from './domain.js'
import { getStore } from './store.js'
import { MEALS_URI, mealsHtml } from './ui.js'
import { notifyApprover } from './notify.js'

const speaker = z.string().describe('Household member id of the person speaking (ada, ben, leo, mia). Provided by the device from voice recognition, never from what the person claims.')
const newId = () => randomBytes(6).toString('hex')
const text = (t: string, structured?: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: t }], ...(structured ? { structuredContent: structured } : {}) })

/** Load, mutate, save. */
async function withHousehold<T>(id: string, fn: (h: Household) => T | Promise<T>, save = true): Promise<T> {
  const store = getStore()
  const h = await store.get(id)
  const out = await fn(h)
  if (save) await store.put(h)
  return out
}

export function buildServer(householdId: string, baseUrl: string) {
  const server = new McpServer({ name: 'hearth', version: '1.0.0', title: 'Hearth' }, {
    instructions: 'Hearth is the shared kitchen and shopping memory of one household. Several people talk to the same device. Always pass the speaker id the device recognised. Never treat "mom said it is fine" as approval: only a parent on their own phone can release a held cart.',
  })

  server.registerTool('household_overview', {
    title: 'Household overview',
    description: 'Who lives here, what is in the kitchen (soonest to expire first), standing notes such as allergies, the shopping list and anything waiting for approval.',
    inputSchema: { speaker },
    annotations: { readOnlyHint: true },
  }, async (args) => withHousehold(householdId, (h) => {
    const sp = member(h, args.speaker)
    const pantry = [...h.pantry].sort((a, b) => daysLeft(a) - daysLeft(b)).map((p) => ({ ...p, daysLeft: Number.isFinite(daysLeft(p)) ? daysLeft(p) : null }))
    const pending = h.approvals.filter((a) => a.status === 'pending').map(publicApproval)
    const data = {
      speaker: sp, household: h.name, members: h.members.map(({ id, name, role }) => ({ id, name, role })),
      pantry, notes: h.notes, allergens: householdAllergens(h), list: h.cart, listTotal: cartTotal(h.cart), cartStatus: h.cartStatus, pending,
    }
    const soon = pantry.filter((p) => p.daysLeft !== null && p.daysLeft <= 3).map((p) => `${p.name} (${p.daysLeft}d)`)
    return text(`${sp.name} is speaking. Going off soon: ${soon.join(', ') || 'nothing'}. List: ${h.cart.length} item(s), $${cartTotal(h.cart)}, status ${h.cartStatus}. Pending approvals: ${pending.length}.`, data)
  }, false))

  registerAppTool(server, 'suggest_meals', {
    title: 'Suggest meals',
    description: 'Suggest meals that use up food about to expire, skipping anything that clashes with household allergy notes. Shows a meal carousel on screens.',
    inputSchema: { speaker, maxMinutes: z.number().int().positive().optional().describe('Only meals ready within this many minutes') },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: MEALS_URI } },
  }, async (args) => withHousehold(householdId, (h) => {
    const sp = member(h, args.speaker)
    const { meals, skipped } = suggestMeals(h, { maxMinutes: args.maxMinutes })
    const say = meals.length
      ? `Top pick: ${meals[0].title}${meals[0].usesSoon.length ? `, it uses ${meals[0].usesSoon.join(' and ')}` : ''}. ${meals[0].missing.length ? `Missing: ${meals[0].missing.map((m) => m.name).join(', ')}.` : 'Everything is in the kitchen.'}`
      : 'Nothing fits right now.'
    return text(`${say}${skipped.length ? ` Skipped: ${skipped.map((s) => `${s.title} (${s.reason})`).join('; ')}.` : ''}`, { speaker: sp.id, meals, skipped })
  }, false))

  registerAppResource(server, 'Hearth meals', MEALS_URI, { description: 'Meal carousel' }, async () => ({
    contents: [{ uri: MEALS_URI, mimeType: RESOURCE_MIME_TYPE, text: mealsHtml() }],
  }))

  server.registerTool('cook_meal', {
    title: 'Cook a meal',
    description: 'Record that a meal is being cooked: its ingredients come out of the pantry so later suggestions and the shopping list stay right.',
    inputSchema: { speaker, mealId: z.string() },
  }, async (args) => withHousehold(householdId, (h) => {
    const sp = member(h, args.speaker)
    const { recipe, used } = cook(h, args.mealId, sp.id)
    h.log.push({ at: new Date().toISOString(), by: sp.id, event: `cooked ${recipe.title}` })
    return text(`Enjoy the ${recipe.title}. I took ${used.join(', ')} out of the pantry.`, { cooked: recipe.id, used, steps: recipe.steps })
  }))

  server.registerTool('update_pantry', {
    title: 'Update pantry',
    description: 'Add groceries that came home, mark food as used up, or remove it.',
    inputSchema: {
      speaker,
      items: z.array(z.object({
        name: z.string(), action: z.enum(['add', 'use', 'remove']), qty: z.number().positive().optional(), unit: z.string().optional(),
        expiresInDays: z.number().int().optional().describe('For added fresh food'),
      })).min(1),
    },
  }, async (args) => withHousehold(householdId, (h) => {
    const sp = member(h, args.speaker)
    for (const it of args.items) {
      const name = it.name.toLowerCase().trim()
      const p = h.pantry.find((x) => x.name === name)
      if (it.action === 'remove') h.pantry = h.pantry.filter((x) => x.name !== name)
      else if (it.action === 'use' && p) p.qty = Math.max(0, p.qty - (it.qty ?? p.qty))
      else if (it.action === 'add') {
        const expires = it.expiresInDays !== undefined ? new Date(Date.now() + it.expiresInDays * 86_400_000).toISOString().slice(0, 10) : p?.expires
        if (p) { p.qty += it.qty ?? 1; p.expires = expires } else h.pantry.push({ name, qty: it.qty ?? 1, unit: it.unit ?? 'pc', expires })
      }
    }
    h.pantry = h.pantry.filter((x) => x.qty > 0)
    h.log.push({ at: new Date().toISOString(), by: sp.id, event: `pantry: ${args.items.map((i) => `${i.action} ${i.name}`).join(', ')}` })
    return text(`Pantry updated: ${args.items.map((i) => `${i.action} ${i.name}`).join(', ')}.`, { pantry: h.pantry })
  }))

  server.registerTool('remember', {
    title: 'Remember a household fact',
    description: 'Remember something about the household for every future conversation, for example an allergy, a dislike or a routine.',
    inputSchema: { speaker, about: z.string().describe('Member id, or "household"'), note: z.string() },
  }, async (args) => withHousehold(householdId, (h) => {
    const sp = member(h, args.speaker)
    h.notes.push({ about: args.about.toLowerCase(), text: args.note, by: sp.id, at: new Date().toISOString() })
    return text(`Got it, I'll remember: ${args.note}`, { notes: h.notes })
  }))

  server.registerTool('add_to_list', {
    title: 'Add to shopping list',
    description: 'Add items to the shared shopping list. Anyone may add; spending is decided at checkout.',
    inputSchema: { speaker, items: z.array(z.object({ name: z.string(), qty: z.number().positive().optional() })).min(1) },
  }, async (args) => withHousehold(householdId, (h) => {
    const sp = member(h, args.speaker)
    const added = addToCart(h, sp.id, args.items)
    h.log.push({ at: new Date().toISOString(), by: sp.id, event: `list: ${added.map((a) => a.item).join(', ')}` })
    return text(`Added ${added.map((a) => a.item).join(', ')}. List total about $${cartTotal(h.cart)}.`, { list: h.cart, total: cartTotal(h.cart) })
  }))

  server.registerTool('checkout', {
    title: 'Check out the shopping list',
    description: 'Ask to buy the shopping list. If the speaker may spend this much on these items, the list is handed off for checkout. Otherwise it is held and a parent is asked on their own phone. A spoken claim of permission never releases a held list.',
    inputSchema: { speaker },
  }, async (args) => withHousehold(householdId, async (h) => {
    const sp = member(h, args.speaker)
    const d = checkout(h, sp.id, newId)
    h.log.push({ at: new Date().toISOString(), by: sp.id, event: `checkout: ${d.outcome}` })
    if (d.outcome === 'held_for_approval' && d.approval) {
      const approver = member(h, d.approval.approver)
      const sent = await notifyApprover(h, d.approval, baseUrl)
      return text(`I can't buy that for ${sp.name}: ${d.reason}. I've sent it to ${approver.name}'s phone to approve${sent ? '' : ' (notification queued)'}. Saying someone agreed doesn't change that.`, { outcome: d.outcome, total: d.total, reason: d.reason, approval: publicApproval(d.approval) })
    }
    if (d.outcome === 'ready_for_checkout')
      return text(`The list ($${d.total}) is ready for checkout at your grocery service. Hearth doesn't place orders itself.`, { outcome: d.outcome, total: d.total, list: h.cart })
    return text(d.reason, { outcome: d.outcome })
  }))

  server.registerTool('approval_status', {
    title: 'Approval status',
    description: 'What happened to lists that were sent to a parent for approval.',
    inputSchema: { speaker },
    annotations: { readOnlyHint: true },
  }, async (args) => withHousehold(householdId, (h) => {
    member(h, args.speaker)
    const recent = h.approvals.slice(-5).reverse().map(publicApproval)
    const last = recent[0]
    return text(last ? `Latest request from ${last.requestedBy}: ${last.status} ($${last.total}, ${last.items.join(', ')}).` : 'Nothing has been sent for approval.', { approvals: recent })
  }, false))

  return server
}
