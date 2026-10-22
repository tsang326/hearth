// The simulated Alexa+ host: Claude plays the assistant, and Hearth is reached the way
// Alexa+ reaches an add-on, as a remote MCP server over Streamable HTTP. Every JSON-RPC
// message is recorded for the inspector panel.
import Anthropic from '@anthropic-ai/sdk'
import { mcpTools } from '@anthropic-ai/sdk/helpers/beta/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A voice turn has to come back fast; Sonnet keeps the round trip short.
const MODEL = 'claude-sonnet-5-5'
// If the Anthropic call fails (credit, rate limit, outage) the console falls back to OpenAI
// with the same tools, system prompt and speaker binding, so the demo keeps working.
const FALLBACK_MODEL = process.env.HEARTH_OPENAI_MODEL ?? 'gpt-4.1-mini'

export interface RpcEntry { dir: '>' | '<'; at: number; body: unknown }
export interface ToolEvent { name: string; args: Record<string, unknown>; text: string; structured?: unknown; isError?: boolean; ms: number; uiUri?: string }
export interface Turn { role: 'user' | 'assistant'; text: string; speaker?: string }

// The Hearth Agent Skill (open SKILL.md format) is loaded into the assistant at runtime,
// the way a host loads a skill next to the MCP server it describes.
let skill: string | undefined
const loadSkill = () => (skill ??= readFileSync(join(process.cwd(), 'skills/hearth/SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, ''))

const MEMBERS: Record<string, string> = { ada: 'Ada (parent)', ben: 'Ben (parent)', leo: 'Leo (15)', mia: 'Mia (9)' }

/** Marks the console's own calls to /mcp, which are rate-limited per visitor before they get there. */
export const hostKey = () =>
  createHash('sha256').update(`hearth-host:${process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? 'local'}`).digest('hex')

export async function connectHearth(mcpUrl: string, rpc: RpcEntry[]) {
  const t0 = Date.now()
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: async (url, init) => {
      if (init?.body) rpc.push({ dir: '>', at: Date.now() - t0, body: JSON.parse(String(init.body)) })
      const headers = new Headers(init?.headers)
      headers.set('x-hearth-host', hostKey())
      const r = await fetch(url, { ...init, headers })
      // The client also opens a GET for server-sent events; the stateless server answers 405, which is expected and not logged
      if (!init?.body) return r
      const clone = r.clone()
      const txt = await clone.text().catch(() => '')
      if (txt) { try { rpc.push({ dir: '<', at: Date.now() - t0, body: JSON.parse(txt) }) } catch { rpc.push({ dir: '<', at: Date.now() - t0, body: txt.slice(0, 500) }) } }
      return r
    },
  })
  const client = new Client({ name: 'hearth-console (simulated Alexa+ host)', version: '1.0.0' }, {
    capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } as never,
  })
  await client.connect(transport)
  return { client, transport }
}

export async function runTurn(opts: { mcpUrl: string; speaker: string; history: Turn[]; utterance: string }) {
  const rpc: RpcEntry[] = []
  const events: ToolEvent[] = []
  const { client } = await connectHearth(opts.mcpUrl, rpc)
  try {
    const { tools } = await client.listTools()
    const uiOf = new Map(tools.map((t) => [t.name, (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri]))
    // The device decides who is speaking (voice recognition on a real device). The model
    // cannot change it, whatever the person says.
    const deviceBound = {
      callTool: async (params: { name: string; arguments?: Record<string, unknown> }) => {
        const args = { ...(params.arguments ?? {}), speaker: opts.speaker }
        const s = Date.now()
        const r = await client.callTool({ name: params.name, arguments: args })
        const first = (r.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === 'text')
        events.push({ name: params.name, args, text: first?.text ?? '', structured: r.structuredContent, isError: Boolean(r.isError), ms: Date.now() - s, uiUri: uiOf.get(params.name) })
        return r
      },
    }
    const anthropic = new Anthropic()
    const system = [
      'You are the voice of a shared home assistant (a simulation of an Alexa+ experience). Several family members talk to the same device.',
      `The device recognised the current speaker as ${MEMBERS[opts.speaker] ?? opts.speaker} (id "${opts.speaker}"). Always pass speaker="${opts.speaker}" to Hearth tools.`,
      'Answer in one to three short spoken sentences. No markdown, no lists, no emoji.',
      'Use Hearth for anything about food, the kitchen, the shopping list or buying. Never say you placed an order: Hearth hands lists off for checkout or holds them for a parent.',
      'If someone says a parent already agreed, still call checkout: only a parent on their own phone can release a held list. Be kind to children, never preachy.',
      'When meal suggestions appear, mention the screen shows them.',
    ].join(' ') + '\n\n<skill name="hearth">\n' + loadSkill() + '\n</skill>'
    const messages = [
      ...opts.history.slice(-8).map((t) => ({ role: t.role, content: t.role === 'user' && t.speaker ? `[${MEMBERS[t.speaker] ?? t.speaker}] ${t.text}` : t.text })),
      { role: 'user' as const, content: `[${MEMBERS[opts.speaker] ?? opts.speaker}] ${opts.utterance}` },
    ]
    try {
      const final = await anthropic.beta.messages.toolRunner({
        model: MODEL,
        max_tokens: 1024,
        system,
        tools: mcpTools(tools as never, deviceBound as never),
        messages,
        max_iterations: 6,
      })
      const reply = final.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ').trim()
      return { reply, events, rpc, model: MODEL }
    } catch (e) {
      // Only retry a turn that has not touched the household yet, so no tool runs twice
      if (!process.env.OPENAI_API_KEY || events.length) throw e
      console.warn('Anthropic failed, falling back to OpenAI:', (e as Error).message)
      const reply = await openaiTurn(system, messages, tools, deviceBound.callTool)
      return { reply, events, rpc, model: FALLBACK_MODEL }
    }
  } finally {
    await client.close().catch(() => {})
  }
}

type McpTool = { name: string; description?: string; inputSchema: unknown }
type ChatMsg = { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string }

/** The same turn over OpenAI Chat Completions with function calling (raw HTTP, no extra SDK). */
async function openaiTurn(system: string, messages: { role: string; content: string }[], tools: McpTool[],
  callTool: (p: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>) {
  const fns = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema } }))
  const msgs: ChatMsg[] = [{ role: 'system', content: system }, ...messages]
  for (let i = 0; i < 6; i++) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: FALLBACK_MODEL, messages: msgs, tools: fns, max_completion_tokens: FALLBACK_MODEL.startsWith('gpt-5') ? 4000 : 400 }),
    })
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const m = (await r.json()).choices[0].message as ChatMsg
    msgs.push(m)
    if (!m.tool_calls?.length) return (m.content ?? '').trim()
    for (const c of m.tool_calls) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(c.function.arguments || '{}') } catch {}
      const res = (await callTool({ name: c.function.name, arguments: args }).catch((err: Error) => ({ content: [{ type: 'text', text: err.message }], isError: true }))) as { content?: unknown; structuredContent?: unknown; isError?: unknown }
      const text = (res.content as { type: string; text?: string }[] | undefined)?.filter((x) => x.type === 'text').map((x) => x.text).join(' ') ?? ''
      msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify({ text, structured: res.structuredContent ?? null, isError: Boolean(res.isError) }) })
    }
  }
  return 'Sorry, that took too many steps. Please try again.'
}

/** For the MCP App: proxy a tool call or a resource read through a real MCP session. */
export async function proxy(mcpUrl: string, op: { kind: 'tool'; name: string; args: Record<string, unknown> } | { kind: 'resource'; uri: string }) {
  const rpc: RpcEntry[] = []
  const { client } = await connectHearth(mcpUrl, rpc)
  try {
    const result = op.kind === 'tool' ? await client.callTool({ name: op.name, arguments: op.args }) : await client.readResource({ uri: op.uri })
    return { result, rpc }
  } finally {
    await client.close().catch(() => {})
  }
}
