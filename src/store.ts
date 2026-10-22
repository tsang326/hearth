// Household state survives across sessions: Upstash Redis when configured, else memory
// (local dev). Each household is one JSON document; Hearth's writes are small and rare.
import { Redis } from '@upstash/redis'
import { seedHousehold, type Household } from './domain.js'

export interface Store {
  get(id: string): Promise<Household>
  put(h: Household): Promise<void>
  reset(id: string): Promise<Household>
}

const key = (id: string) => `hearth:household:${id}`

class MemoryStore implements Store {
  private m = new Map<string, Household>()
  async get(id: string) {
    if (!this.m.has(id)) this.m.set(id, seedHousehold(id))
    return structuredClone(this.m.get(id)!)
  }
  async put(h: Household) { this.m.set(h.id, structuredClone(h)) }
  async reset(id: string) { const h = seedHousehold(id); this.m.set(id, h); return structuredClone(h) }
}

class RedisStore implements Store {
  constructor(private r: Redis) {}
  async get(id: string) {
    const h = await this.r.get<Household>(key(id))
    if (h) return h
    const fresh = seedHousehold(id)
    await this.put(fresh)
    return fresh
  }
  async put(h: Household) {
    h.log = h.log.slice(-200)
    await this.r.set(key(h.id), h)
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
