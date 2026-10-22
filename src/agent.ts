// The simulated Alexa+ host: Claude plays the assistant, and Hearth is reached the way
// Alexa+ reaches an add-on, as a remote MCP server over Streamable HTTP. Every JSON-RPC
// message is recorded for the inspector panel.
import Anthropic from '@anthropic-ai/sdk'
import { mcpTools } from '@anthropic-ai/sdk/helpers/beta/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A voice turn has to come back fast; Sonnet keeps the round trip short.
const MODEL = 'claude-sonnet-5-5'

export interface RpcEntry { dir: '>' | '<'; at: number; body: unknown }
export interface ToolEvent { name: string; args: Record<string, unknown>; text: string; structured?: unknown; isError?: boolean; ms: number; uiUri?: string }
export interface Turn { role: 'user' | 'assistant'; text: string; speaker?: string }

// The Hearth Agent Skill (open SKILL.md format) is loaded into the assistant at runtime,
// the way a host loads a skill next to the MCP server it describes.
let skill: string | undefined
const loadSkill = () => (skill ??= readFileSync(join(process.cwd(), 'skills/hearth/SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, ''))

const MEMBERS: Record<string, string> = { ada: 'Ada (parent)', ben: 'Ben (parent)', leo: 'Leo (15)', mia: 'Mia (9)' }

export async function connectHearth(mcpUrl: string, rpc: RpcEntry[]) {
  const t0 = Date.now()
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: async (url, init) => {
      if (init?.body) rpc.push({ dir: '>', at: Date.now() - t0, body: JSON.parse(String(init.body)) })
      const r = await fetch(url, init)
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
    const final = await anthropic.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: mcpTools(tools as never, deviceBound as never),
      messages,
      max_iterations: 6,
    })
    const reply = final.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ').trim()
    return { reply, events, rpc }
  } finally {
    await client.close().catch(() => {})
  }
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
