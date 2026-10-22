import { describe, expect, it } from 'vitest'
import { addToCart, checkout, cook, decide, householdAllergens, seedHousehold, suggestMeals } from './domain.js'

const now = new Date('2026-10-22T09:00:00Z')
let n = 0
const id = () => `id${++n}`

describe('spending rules', () => {
  it('holds a child’s candy for a parent, whatever the child says', () => {
    const h = seedHousehold('t', now)
    addToCart(h, 'mia', [{ name: 'gummy bears', qty: 2 }])
    const d = checkout(h, 'mia', id, now)
    expect(d.outcome).toBe('held_for_approval')
    expect(d.reason).toMatch(/candy need a parent/)
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
    expect(d.reason).toMatch(/energy drinks need a parent/)
  })

  it('holds a parent’s cart over their own limit for the other parent', () => {
    const h = seedHousehold('t', now)
    addToCart(h, 'ben', [{ name: 'video game gift card', qty: 4 }])
    const d = checkout(h, 'ben', id, now)
    expect(d.outcome).toBe('held_for_approval')
    expect(d.approval?.approver).toBe('ada')
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

  it('cooking takes ingredients out of the pantry', () => {
    const h = seedHousehold('t', now)
    cook(h, 'chicken-rice-bowls', 'ada', now)
    expect(h.pantry.find((p) => p.name === 'chicken thighs')).toBeUndefined()
    expect(h.pantry.find((p) => p.name === 'rice')?.qty).toBe(3)
  })
})
