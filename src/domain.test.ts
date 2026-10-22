import { describe, expect, it } from 'vitest'
import { addToCart, checkout, cook, decide, householdAllergens, seedHousehold, suggestMeals } from './domain.js'
import type { Household } from './domain.js'

const now = new Date('2026-10-22T09:00:00Z')
let n = 0
const id = () => `id${++n}`

describe('spending rules', () => {
  it('holds a child’s candy for a parent, whatever the child says', () => {
    const h = seedHousehold('t', now)
    addToCart(h, 'mia', [{ name: 'gummy bears', qty: 2 }])
    const d = checkout(h, 'mia', id, now)
    expect(d.outcome).toBe('held_for_approval')
    expect(d.reason).toMatch(/a parent has to OK candy/)
    expect(d.approval?.approver).toBe('ada')
    expect(h.cartStatus).toBe('held_for_approval')
  })

  it('lets a teen buy groceries under their limit but not an energy drink', () => {
    const h = seedHousehold('t', now)
    addToCart(h, 'leo', [{ name: 'pasta' }, { name: 'tomatoes', qty: 3 }])
    expect(checkout(h, 'leo', id, now).outcome).toBe('ready_for_checkout')
    addToCart(h, 'leo', [{ name: 'energy drink' }])
    const d = checkout(h, 'leo', id, now)
    expect(d.outcome).toBe('held_for_approval')
    expect(d.reason).toMatch(/a parent has to OK energy drinks/)
  })

  it('holds a parent’s cart over their own limit for the other parent', () => {
    const h = seedHousehold('t', now)
    addToCart(h, 'ben', [{ name: 'video game gift card', qty: 4 }])
    const d = checkout(h, 'ben', id, now)
    expect(d.outcome).toBe('held_for_approval')
    expect(d.approval?.approver).toBe('ada')
  })

  it('holds anything a child asks for that is not on the price list', () => {
    for (const items of [[{ name: 'skittles' }], [{ name: 'beer', qty: 12 }], [{ name: 'a toy' }]]) {
      const h = seedHousehold('t', now)
      addToCart(h, 'mia', items)
      expect(checkout(h, 'mia', id, now).outcome).toBe('held_for_approval')
    }
  })

  it('knows singular and plural item names', () => {
    const h = seedHousehold('t', now)
    addToCart(h, 'mia', [{ name: 'gummy bear' }])
    expect(h.cart[0]).toMatchObject({ item: 'gummy bears', category: 'candy' })
    const h2 = seedHousehold('t', now)
    addToCart(h2, 'leo', [{ name: 'energy drinks', qty: 2 }])
    expect(checkout(h2, 'leo', id, now).reason).toMatch(/a parent has to OK energy drinks/)
  })

  it('a held list cannot be released by voice, not even by a parent', () => {
    const h = seedHousehold('t', now)
    addToCart(h, 'mia', [{ name: 'gummy bears' }])
    const a = checkout(h, 'mia', id, now).approval!
    const again = checkout(h, 'ben', id, now)
    expect(again).toMatchObject({ outcome: 'held_for_approval', alreadyHeld: true })
    expect(again.approval?.id).toBe(a.id)
    expect(h.cartStatus).toBe('held_for_approval')
    expect(h.approvals).toHaveLength(1)
  })

  it('a held list is frozen, so approving releases only what the parent saw', () => {
    const h: Household = seedHousehold('t', now)
    addToCart(h, 'mia', [{ name: 'gummy bears' }])
    const a = checkout(h, 'mia', id, now).approval!
    expect(() => addToCart(h, 'leo', [{ name: 'video game gift card', qty: 10 }])).toThrow(/waiting for Ada/)
    h.cart.push({ item: 'video game gift card', qty: 10, unitPrice: 50, addedBy: 'leo', category: 'gift cards' })
    decide(h, a.id, a.token, true, now)
    expect(h.cart.map((l) => l.item)).toEqual(['gummy bears'])
    expect(h.cartStatus).toBe('ready_for_checkout')
  })

  it('only the signed phone link releases a held cart', () => {
    const h = seedHousehold('t', now)
    addToCart(h, 'mia', [{ name: 'chocolate bar' }])
    const a = checkout(h, 'mia', id, now).approval!
    expect(() => decide(h, a.id, 'wrong-token', true, now)).toThrow(/bad token/)
    decide(h, a.id, a.token, true, now)
    expect(h.cartStatus).toBe('ready_for_checkout')
  })

  it('a declined cart is cleared', () => {
    const h = seedHousehold('t', now)
    addToCart(h, 'mia', [{ name: 'chocolate bar' }])
    const a = checkout(h, 'mia', id, now).approval!
    decide(h, a.id, a.token, false, now)
    expect(h.cart).toEqual([])
    expect(h.cartStatus).toBe('declined')
  })
})

describe('meals', () => {
  it('uses what goes off first and skips the household’s allergens', () => {
    const h = seedHousehold('t', now)
    expect(householdAllergens(h)).toEqual(['peanut'])
    const { meals, skipped } = suggestMeals(h, {}, now)
    expect(meals[0].usesSoon.join(' ')).toMatch(/spinach/)
    expect(meals.map((m) => m.id)).not.toContain('peanut-noodles')
    expect(skipped.map((s) => s.title)).toContain('Peanut noodles')
  })

  it('reads allergies written in everyday words', () => {
    const h = seedHousehold('t', now)
    h.notes.push({ about: 'leo', text: 'Leo is allergic to dairy and has to avoid gluten (celiac).', by: 'ada', at: now.toISOString() })
    expect(householdAllergens(h).sort()).toEqual(['milk', 'peanut', 'wheat'])
    const ids = suggestMeals(h, {}, now).meals.map((m) => m.id)
    expect(ids).not.toContain('veggie-omelette')
    expect(ids).not.toContain('tomato-spinach-pasta')
  })

  it('never plans a meal on food past its date', () => {
    const h = seedHousehold('t', now)
    const later = new Date(now.getTime() + 20 * 86_400_000)
    for (const m of suggestMeals(h, {}, later).meals) expect(m.usesSoon).toEqual([])
  })

  it('cooking takes ingredients out of the pantry', () => {
    const h = seedHousehold('t', now)
    cook(h, 'chicken-rice-bowls', 'ada', now)
    expect(h.pantry.find((p) => p.name === 'chicken thighs')).toBeUndefined()
    expect(h.pantry.find((p) => p.name === 'rice')?.qty).toBe(3)
  })
})
