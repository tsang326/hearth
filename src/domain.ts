// Hearth domain: one shared household, several people talking to the same agent.
// Everything here is deterministic and fast (no model calls): MCP tool calls must
// answer well under Alexa+'s 500 ms budget.

export type Role = 'parent' | 'teen' | 'child'

export interface Member {
  id: string
  name: string
  role: Role
  /** Spend this person may confirm alone, per cart, in USD. */
  spendLimit: number
}

export interface PantryItem {
  name: string
  qty: number
  unit: string
  /** ISO date; undefined for shelf-stable items. */
  expires?: string
}

export interface Note {
  about: string
  text: string
  by: string
  at: string
}

export interface CartLine {
  item: string
  qty: number
  unitPrice: number
  addedBy: string
  category: string
}

export type CartStatus = 'open' | 'ready_for_checkout' | 'held_for_approval' | 'declined'

export interface Approval {
  id: string
  token: string
  requestedBy: string
  approver: string
  lines: CartLine[]
  total: number
  reason: string
  status: 'pending' | 'approved' | 'declined'
  createdAt: string
  decidedAt?: string
}

export interface Household {
  id: string
  name: string
  members: Member[]
  pantry: PantryItem[]
  notes: Note[]
  cart: CartLine[]
  cartStatus: CartStatus
  approvals: Approval[]
  cooked: { recipeId: string; by: string; at: string }[]
  log: { at: string; by: string; event: string }[]
}

export interface Recipe {
  id: string
  title: string
  minutes: number
  serves: number
  ingredients: { name: string; qty: number; unit: string }[]
  steps: string[]
  allergens: string[]
  emoji: string
}

/** Small, original recipe set written for this project. */
export const RECIPES: Recipe[] = [
  { id: 'spinach-egg-fried-rice', title: 'Spinach & egg fried rice', minutes: 20, serves: 4, emoji: '🍳',
    ingredients: [{ name: 'rice', qty: 2, unit: 'cup' }, { name: 'eggs', qty: 4, unit: 'pc' }, { name: 'spinach', qty: 1, unit: 'bag' }, { name: 'soy sauce', qty: 1, unit: 'tbsp' }],
    steps: ['Cook the rice, or use yesterday’s.', 'Scramble the eggs, set aside.', 'Wilt the spinach, add rice and eggs, season with soy sauce.'], allergens: ['egg', 'soy'] },
  { id: 'chicken-tomato-stew', title: 'Chicken & tomato stew', minutes: 40, serves: 4, emoji: '🍲',
    ingredients: [{ name: 'chicken thighs', qty: 1, unit: 'lb' }, { name: 'tomatoes', qty: 4, unit: 'pc' }, { name: 'onion', qty: 1, unit: 'pc' }, { name: 'rice', qty: 2, unit: 'cup' }],
    steps: ['Brown the chicken.', 'Add onion and chopped tomatoes, simmer 25 minutes.', 'Serve over rice.'], allergens: [] },
  { id: 'yogurt-berry-bowls', title: 'Yogurt berry bowls', minutes: 5, serves: 4, emoji: '🫐',
    ingredients: [{ name: 'yogurt', qty: 1, unit: 'tub' }, { name: 'berries', qty: 1, unit: 'box' }, { name: 'oats', qty: 1, unit: 'cup' }],
    steps: ['Spoon yogurt into bowls.', 'Top with berries and oats.'], allergens: ['milk'] },
  { id: 'tomato-spinach-pasta', title: 'Tomato spinach pasta', minutes: 25, serves: 4, emoji: '🍝',
    ingredients: [{ name: 'pasta', qty: 1, unit: 'lb' }, { name: 'tomatoes', qty: 3, unit: 'pc' }, { name: 'spinach', qty: 1, unit: 'bag' }, { name: 'parmesan', qty: 1, unit: 'cup' }],
    steps: ['Boil the pasta.', 'Cook tomatoes down into a sauce, stir in spinach.', 'Toss with pasta and parmesan.'], allergens: ['wheat', 'milk'] },
  { id: 'peanut-noodles', title: 'Peanut noodles', minutes: 15, serves: 4, emoji: '🥜',
    ingredients: [{ name: 'noodles', qty: 1, unit: 'pack' }, { name: 'peanut butter', qty: 0.5, unit: 'cup' }, { name: 'soy sauce', qty: 2, unit: 'tbsp' }, { name: 'spinach', qty: 1, unit: 'bag' }],
    steps: ['Cook noodles.', 'Whisk peanut butter, soy sauce and hot water.', 'Toss with noodles and spinach.'], allergens: ['peanut', 'soy', 'wheat'] },
  { id: 'banana-oat-pancakes', title: 'Banana oat pancakes', minutes: 20, serves: 4, emoji: '🥞',
    ingredients: [{ name: 'bananas', qty: 3, unit: 'pc' }, { name: 'eggs', qty: 3, unit: 'pc' }, { name: 'oats', qty: 1, unit: 'cup' }],
    steps: ['Blend bananas, eggs and oats.', 'Cook small pancakes on a hot pan.'], allergens: ['egg'] },
  { id: 'chicken-rice-bowls', title: 'Chicken rice bowls', minutes: 30, serves: 4, emoji: '🍚',
    ingredients: [{ name: 'chicken thighs', qty: 1, unit: 'lb' }, { name: 'rice', qty: 2, unit: 'cup' }, { name: 'spinach', qty: 1, unit: 'bag' }, { name: 'soy sauce', qty: 2, unit: 'tbsp' }],
    steps: ['Cook rice.', 'Pan-fry sliced chicken with soy sauce.', 'Serve on rice with wilted spinach.'], allergens: ['soy'] },
  { id: 'veggie-omelette', title: 'Veggie omelette', minutes: 12, serves: 2, emoji: '🥚',
    ingredients: [{ name: 'eggs', qty: 4, unit: 'pc' }, { name: 'tomatoes', qty: 1, unit: 'pc' }, { name: 'spinach', qty: 1, unit: 'bag' }, { name: 'cheddar', qty: 0.5, unit: 'cup' }],
    steps: ['Whisk eggs.', 'Cook with chopped tomato and spinach, fold in cheddar.'], allergens: ['egg', 'milk'] },
]

/** Price list used to estimate a cart. Estimates only: Hearth never places orders. */
export const CATALOG: Record<string, { price: number; category: string }> = {
  rice: { price: 4.5, category: 'pantry' }, eggs: { price: 3.9, category: 'dairy' }, spinach: { price: 2.99, category: 'produce' },
  'soy sauce': { price: 3.49, category: 'pantry' }, 'chicken thighs': { price: 6.99, category: 'meat' }, tomatoes: { price: 0.79, category: 'produce' },
  onion: { price: 0.99, category: 'produce' }, yogurt: { price: 4.29, category: 'dairy' }, berries: { price: 4.99, category: 'produce' },
  oats: { price: 3.79, category: 'pantry' }, pasta: { price: 1.99, category: 'pantry' }, parmesan: { price: 5.49, category: 'dairy' },
  noodles: { price: 2.49, category: 'pantry' }, 'peanut butter': { price: 3.99, category: 'pantry' }, bananas: { price: 0.29, category: 'produce' },
  cheddar: { price: 4.49, category: 'dairy' }, milk: { price: 3.59, category: 'dairy' },
  'gummy bears': { price: 3.99, category: 'candy' }, 'chocolate bar': { price: 2.49, category: 'candy' }, 'energy drink': { price: 2.99, category: 'energy drinks' },
  'video game gift card': { price: 50, category: 'gift cards' },
}

/** Categories that always need a parent, whoever asks and whatever the amount. */
export const PARENT_ONLY = ['candy', 'energy drinks', 'gift cards', 'alcohol']

const day = 86_400_000
const inDays = (now: Date, n: number) => new Date(now.getTime() + n * day).toISOString().slice(0, 10)

export function seedHousehold(id: string, now = new Date()): Household {
  return {
    id,
    name: 'The Okafor household',
    members: [
      { id: 'ada', name: 'Ada', role: 'parent', spendLimit: 150 },
      { id: 'ben', name: 'Ben', role: 'parent', spendLimit: 150 },
      { id: 'leo', name: 'Leo', role: 'teen', spendLimit: 20 },
      { id: 'mia', name: 'Mia', role: 'child', spendLimit: 0 },
    ],
    pantry: [
      { name: 'spinach', qty: 1, unit: 'bag', expires: inDays(now, 1) },
      { name: 'chicken thighs', qty: 1, unit: 'lb', expires: inDays(now, 2) },
      { name: 'yogurt', qty: 1, unit: 'tub', expires: inDays(now, 3) },
      { name: 'eggs', qty: 6, unit: 'pc', expires: inDays(now, 9) },
      { name: 'tomatoes', qty: 2, unit: 'pc', expires: inDays(now, 4) },
      { name: 'rice', qty: 5, unit: 'cup' },
      { name: 'soy sauce', qty: 10, unit: 'tbsp' },
      { name: 'oats', qty: 3, unit: 'cup' },
      { name: 'peanut butter', qty: 1, unit: 'cup' },
      { name: 'noodles', qty: 1, unit: 'pack' },
    ],
    notes: [
      { about: 'mia', text: 'Mia is allergic to peanuts.', by: 'ada', at: now.toISOString() },
    ],
    cart: [],
    cartStatus: 'open',
    approvals: [],
    cooked: [],
    log: [],
  }
}

export const member = (h: Household, id: string) => {
  const m = h.members.find((x) => x.id === id.toLowerCase())
  if (!m) throw new Error(`Unknown household member "${id}". Members: ${h.members.map((x) => x.id).join(', ')}`)
  return m
}

export const daysLeft = (item: PantryItem, now = new Date()) =>
  item.expires ? Math.round((Date.parse(item.expires) - Date.parse(now.toISOString().slice(0, 10))) / day) : Infinity

/** Allergens the household has told Hearth about, from free-text notes. */
export function householdAllergens(h: Household): string[] {
  const all = ['peanut', 'egg', 'milk', 'wheat', 'soy', 'shellfish', 'sesame']
  const text = h.notes.map((n) => n.text.toLowerCase()).join(' ')
  return all.filter((a) => new RegExp(`\\b${a}s?\\b`).test(text) && /allerg/.test(text))
}

export interface MealSuggestion {
  id: string
  title: string
  emoji: string
  minutes: number
  usesSoon: string[]
  missing: { name: string; qty: number; unit: string; estPrice: number }[]
  excludedFor?: string
  score: number
}

/** Rank recipes by how much soon-to-expire food they use, minus what must be bought. */
export function suggestMeals(h: Household, opts: { maxMinutes?: number } = {}, now = new Date()): { meals: MealSuggestion[]; skipped: { title: string; reason: string }[] } {
  const allergens = householdAllergens(h)
  const have = new Map(h.pantry.map((p) => [p.name, p]))
  const skipped: { title: string; reason: string }[] = []
  const meals: MealSuggestion[] = []
  for (const r of RECIPES) {
    const clash = r.allergens.find((a) => allergens.includes(a))
    if (clash) { skipped.push({ title: r.title, reason: `contains ${clash} (household allergy note)` }); continue }
    if (opts.maxMinutes && r.minutes > opts.maxMinutes) continue
    const usesSoon: string[] = []
    const missing: MealSuggestion['missing'] = []
    let score = 0
    for (const ing of r.ingredients) {
      const p = have.get(ing.name)
      if (p && p.qty > 0) {
        const d = daysLeft(p, now)
        if (d <= 3) { usesSoon.push(`${p.name} (${d <= 0 ? 'today' : d === 1 ? '1 day left' : `${d} days left`})`); score += 10 - d * 2 }
        else score += 1
      } else {
        missing.push({ ...ing, estPrice: CATALOG[ing.name]?.price ?? 0 })
        score -= 3
      }
    }
    meals.push({ id: r.id, title: r.title, emoji: r.emoji, minutes: r.minutes, usesSoon, missing, score })
  }
  meals.sort((a, b) => b.score - a.score)
  return { meals: meals.slice(0, 4), skipped }
}

export function cook(h: Household, recipeId: string, by: string, now = new Date()) {
  const r = RECIPES.find((x) => x.id === recipeId)
  if (!r) throw new Error(`Unknown recipe "${recipeId}"`)
  const used: string[] = []
  for (const ing of r.ingredients) {
    const p = h.pantry.find((x) => x.name === ing.name)
    if (!p) continue
    p.qty = Math.max(0, +(p.qty - ing.qty).toFixed(2))
    used.push(ing.name)
  }
  h.pantry = h.pantry.filter((p) => p.qty > 0)
  h.cooked.push({ recipeId, by, at: now.toISOString() })
  return { recipe: r, used }
}

export const cartTotal = (lines: CartLine[]) => +lines.reduce((s, l) => s + l.qty * l.unitPrice, 0).toFixed(2)

export function addToCart(h: Household, by: string, items: { name: string; qty?: number }[]) {
  const added: CartLine[] = []
  for (const it of items) {
    const name = it.name.toLowerCase().trim()
    const cat = CATALOG[name]
    const line = h.cart.find((l) => l.item === name)
    if (line) { line.qty += it.qty ?? 1; added.push(line); continue }
    const l: CartLine = { item: name, qty: it.qty ?? 1, unitPrice: cat?.price ?? 0, addedBy: by, category: cat?.category ?? 'other' }
    h.cart.push(l)
    added.push(l)
  }
  if (h.cartStatus !== 'held_for_approval') h.cartStatus = 'open'
  return added
}

export interface CheckoutDecision {
  outcome: 'ready_for_checkout' | 'held_for_approval' | 'empty'
  total: number
  reason: string
  approval?: Approval
}

/**
 * The rule the whole product is about. Whoever is speaking, a cart goes through only if
 * that person may spend that much on those categories. Otherwise it is held and the
 * approver is asked on their own phone; nothing said to the speaker can approve it.
 */
export function checkout(h: Household, speakerId: string, newId: () => string, now = new Date()): CheckoutDecision {
  const sp = member(h, speakerId)
  if (h.cart.length === 0) return { outcome: 'empty', total: 0, reason: 'The cart is empty.' }
  const total = cartTotal(h.cart)
  const restricted = [...new Set(h.cart.filter((l) => PARENT_ONLY.includes(l.category)).map((l) => l.category))]
  const reasons: string[] = []
  if (sp.role !== 'parent' && restricted.length) reasons.push(`${restricted.join(', ')} need a parent`)
  if (total > sp.spendLimit) reasons.push(`$${total} is over ${sp.name}'s limit of $${sp.spendLimit}`)
  if (!reasons.length) {
    h.cartStatus = 'ready_for_checkout'
    return { outcome: 'ready_for_checkout', total, reason: `Within ${sp.name}'s limit.` }
  }
  const approver = h.members.find((m) => m.role === 'parent' && m.id !== sp.id) ?? h.members.find((m) => m.role === 'parent')!
  const approval: Approval = {
    id: newId(), token: newId() + newId(), requestedBy: sp.id, approver: approver.id,
    lines: h.cart.map((l) => ({ ...l })), total, reason: reasons.join('; '), status: 'pending', createdAt: now.toISOString(),
  }
  h.approvals.push(approval)
  h.cartStatus = 'held_for_approval'
  return { outcome: 'held_for_approval', total, reason: approval.reason, approval }
}

/** Only reachable from the approver's own device (signed link), never from the voice channel. */
export function decide(h: Household, approvalId: string, token: string, approve: boolean, now = new Date()) {
  const a = h.approvals.find((x) => x.id === approvalId)
  if (!a || a.token !== token) throw new Error('Unknown approval or bad token')
  if (a.status !== 'pending') return a
  a.status = approve ? 'approved' : 'declined'
  a.decidedAt = now.toISOString()
  h.cartStatus = approve ? 'ready_for_checkout' : 'declined'
  if (!approve) h.cart = []
  return a
}

export const publicApproval = (a: Approval) => ({ id: a.id, requestedBy: a.requestedBy, approver: a.approver, total: a.total, reason: a.reason, status: a.status, items: a.lines.map((l) => `${l.qty} × ${l.item}`), createdAt: a.createdAt, decidedAt: a.decidedAt })
