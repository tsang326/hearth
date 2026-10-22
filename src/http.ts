// HTTP handlers shared by the Vercel functions (api/*) and the local dev server.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildServer } from './server.js'
import { getStore } from './store.js'
import { decide, member, publicApproval } from './domain.js'
import { approvalLinks } from './notify.js'

export const DEMO_HOUSEHOLD = 'demo'

export const baseUrl = (req: IncomingMessage) => {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost:3000'
  const proto = req.headers['x-forwarded-proto'] ?? (String(host).startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export async function readBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) return req.body
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

/** POST /mcp — MCP Streamable HTTP, stateless (one transport per request). */
export async function handleMcp(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-protocol-version, mcp-session-id, authorization')
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }
  if (req.method !== 'POST') return json(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Use POST (stateless Streamable HTTP)' }, id: null })
  const url = new URL(req.url ?? '/', 'http://x')
  const household = url.searchParams.get('h') ?? DEMO_HOUSEHOLD
  const server = buildServer(household, baseUrl(req))
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => { transport.close(); server.close() })
  await server.connect(transport)
  await transport.handleRequest(req, res, await readBody(req))
}

/** GET /api/approvals?h=&key= — the parent phone view. */
export async function handleApprovals(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x')
  const id = url.searchParams.get('h') ?? DEMO_HOUSEHOLD
  if (url.searchParams.get('key') !== (process.env.HEARTH_PARENT_KEY ?? 'parent-demo')) return json(res, 403, { error: 'This view belongs to a parent device' })
  const h = await getStore().get(id)
  json(res, 200, {
    household: h.name,
    approvals: h.approvals.slice(-10).reverse().map((a) => ({ ...publicApproval(a), requestedByName: member(h, a.requestedBy).name, approverName: member(h, a.approver).name, links: a.status === 'pending' ? approvalLinks(a, baseUrl(req), id) : undefined })),
  })
}

/** GET /api/decide?h=&id=&t=&a=1|0 — signed approve/decline link. */
export async function handleDecide(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x')
  const id = url.searchParams.get('h') ?? DEMO_HOUSEHOLD
  const store = getStore()
  const h = await store.get(id)
  try {
    const a = decide(h, url.searchParams.get('id') ?? '', url.searchParams.get('t') ?? '', url.searchParams.get('a') === '1')
    h.log.push({ at: new Date().toISOString(), by: a.approver, event: `approval ${a.status} (phone)` })
    await store.put(h)
    if ((req.headers.accept ?? '').includes('application/json')) return json(res, 200, publicApproval(a))
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:24px"><h2>${a.status === 'approved' ? 'Approved' : 'Declined'}</h2><p>$${a.total}: ${a.lines.map((l) => l.item).join(', ')}</p></body>`)
  } catch (e) {
    json(res, 400, { error: (e as Error).message })
  }
}

/** POST /api/reset?h= — restore the demo household (for repeatable demos). */
export async function handleReset(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x')
  const id = url.searchParams.get('h') ?? DEMO_HOUSEHOLD
  if (req.method !== 'POST') return json(res, 405, { error: 'POST' })
  await getStore().reset(id)
  json(res, 200, { ok: true })
}

// ---- simulated Alexa+ console -------------------------------------------------------
import { proxy, runTurn } from './agent.js'

const mcpUrlFor = (req: IncomingMessage, household: string) => `${process.env.HEARTH_MCP_URL ?? baseUrl(req) + '/mcp'}?h=${encodeURIComponent(household)}`
const MEMBER_IDS = ['ada', 'ben', 'leo', 'mia']

/** POST /api/chat {speaker, utterance, history, h} */
export async function handleChat(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST' })
  const b = (await readBody(req)) as { speaker?: string; utterance?: string; history?: unknown; h?: string }
  if (!b?.utterance || !MEMBER_IDS.includes(String(b.speaker))) return json(res, 400, { error: 'speaker and utterance required' })
  if (b.utterance.length > 500) return json(res, 400, { error: 'too long' })
  const household = b.h ?? DEMO_HOUSEHOLD
  // The console spends the deployer's model credits: cap it per visitor and overall
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'local').split(',')[0].trim()
  const store = getStore()
  if ((await store.hit(`ip:${ip}`)) > Number(process.env.HEARTH_CHAT_PER_IP_HOUR ?? 40) || (await store.hit('all')) > Number(process.env.HEARTH_CHAT_PER_HOUR ?? 400))
    return json(res, 429, { error: 'The demo is busy, try again in a while. The MCP server at /mcp stays open.' })
  try {
    const out = await runTurn({ mcpUrl: mcpUrlFor(req, household), speaker: String(b.speaker), utterance: b.utterance, history: Array.isArray(b.history) ? (b.history as never[]).slice(-8) : [] })
    json(res, 200, out)
  } catch (e) {
    json(res, 500, { error: (e as Error).message })
  }
}

/** POST /api/proxy {kind:'tool'|'resource', ...} — host side of the MCP App bridge. */
export async function handleProxy(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST' })
  const b = (await readBody(req)) as { kind: 'tool' | 'resource'; name?: string; args?: Record<string, unknown>; uri?: string; h?: string; speaker?: string }
  const household = b.h ?? DEMO_HOUSEHOLD
  try {
    if (b.kind === 'resource') return json(res, 200, await proxy(mcpUrlFor(req, household), { kind: 'resource', uri: String(b.uri) }))
    // The console binds the speaker here too: a view cannot act as someone else.
    const args = { ...(b.args ?? {}), ...(MEMBER_IDS.includes(String(b.speaker)) ? { speaker: b.speaker } : {}) }
    json(res, 200, await proxy(mcpUrlFor(req, household), { kind: 'tool', name: String(b.name), args }))
  } catch (e) {
    json(res, 500, { error: (e as Error).message })
  }
}

/** GET /api/state?h= — the console's side panel (kitchen, list, notes). Read-only. */
export async function handleState(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x')
  const h = await getStore().get(url.searchParams.get('h') ?? DEMO_HOUSEHOLD)
  json(res, 200, { name: h.name, pantry: h.pantry, notes: h.notes, cart: h.cart, cartStatus: h.cartStatus, pending: h.approvals.filter((a) => a.status === 'pending').length, log: h.log.slice(-12).reverse() })
}
