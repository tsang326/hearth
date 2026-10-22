// Household state survives across sessions: Upstash Redis when configured, else memory
// (local dev). Each household is one JSON document; Hearth's writes are small and rare.
import { Redis } from '@upstash/redis'
import { seedHousehold, type Household } from './domain.js'

export interface Store {
  /** Count one use of `key` in the current hour; returns the count so far. */
  hit(key: string): Promise<number>
  get(id: string): Promise<Household>
  put(h: Household): Promise<void>
  reset(id: string): Promise<Household>
}

const key = (id: string) => `hearth:household:${id}`
// Demo households expire after a week unused, and reseed a day after seeding so the
// "goes off tomorrow" food is always tomorrow, whenever a judge opens the demo.
const TTL_SECONDS = 7 * 86_400
const stale = (h: Household) => !h.seededAt || Date.now() - Date.parse(h.seededAt) > 86_400_000

const hourKey = (k: string) => `hearth:rl:${k}:${new Date().toISOString().slice(0, 13)}`

class MemoryStore implements Store {
  private m = new Map<string, Household>()
  private hits = new Map<string, number>()
  async hit(k: string) { const key = hourKey(k); const n = (this.hits.get(key) ?? 0) + 1; this.hits.set(key, n); return n }
  async get(id: string) {
    if (!this.m.has(id) || stale(this.m.get(id)!)) this.m.set(id, seedHousehold(id))
    return structuredClone(this.m.get(id)!)
  }
  async put(h: Household) { this.m.set(h.id, structuredClone(h)) }
  async reset(id: string) { const h = seedHousehold(id); this.m.set(id, h); return structuredClone(h) }
}

class RedisStore implements Store {
  constructor(private r: Redis) {}
  async hit(k: string) { const key = hourKey(k); const n = await this.r.incr(key); if (n === 1) await this.r.expire(key, 3600); return n }
  async get(id: string) {
    const h = await this.r.get<Household>(key(id))
    if (h && !stale(h)) return h
    const fresh = seedHousehold(id)
    await this.put(fresh)
    return fresh
  }
  async put(h: Household) {
    h.log = h.log.slice(-200)
    await this.r.set(key(h.id), h, { ex: TTL_SECONDS })
  }
  async reset(id: string) { const h = seedHousehold(id); await this.put(h); return h }
}

let store: Store | undefined
export function getStore(): Store {
  if (store) return store
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
  store = url && token ? new RedisStore(new Redis({ url, token })) : new MemoryStore()
  return store
}
