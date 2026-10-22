# Hearth

**One shared kitchen memory, and a spending guard, for everyone who talks to the home assistant.**

A home assistant sits in a shared room. Ada, Ben, fifteen-year-old Leo and nine-year-old Mia all talk to it. A chatbot on one person's phone does not have that problem; a home device does. Hearth is an add-on for an Alexa+ style assistant that remembers the household across conversations (what is in the kitchen and when it goes off, allergies, the shopping list) and decides who may spend what.

- **Use it before it goes off.** "What should we have tonight?" ranks meals by how much soon-to-expire food they use, never plans on food past its date, skips anything that clashes with the household's allergy notes ("Leo is allergic to dairy", "Mia can't have nuts"), and shows a meal carousel (an MCP App) with *Cook this* and *Add missing to the list*.
- **Children can't be talked into spending.** When Mia says "Can I get gummy bears? Mom said it's fine", the list is held and sent to Ada's phone. Once held, the list is frozen and only Ada's approve link releases it, exactly as she saw it. Nothing said to the device releases it, not even by Ben. Anything Hearth has no price for is held too.
- **Memory across sessions.** Every conversation sees what earlier ones did: cooked meals leave the pantry, notes stay, held lists wait.
- **Never fakes a purchase.** A list is either marked ready for checkout or held for a parent. Hearth does not place orders; a grocery integration would take a ready list from there.

## How it is built (Alexa+ track)

```
voice ─► host (simulated Alexa+ experience, Claude as the assistant) ─► Hearth MCP server ─► Redis
          ▲   binds the recognised speaker            spec 2025-11-25, Streamable HTTP         (household state)
          │                                            8 tools + MCP App view (ui://hearth/meals.html)
          └── renders the MCP App in a sandboxed iframe (SEP-1865 over postMessage)

held list (frozen) ─► parent's phone (/phone) ─► secret approve/decline link
```

| Part | What it is |
|---|---|
| `src/server.ts` | **Self-hosted MCP server**, `@modelcontextprotocol/sdk` 1.32.1, protocol **2025-11-25**, Streamable HTTP at `/mcp`, stateless transport. Tools: `household_overview`, `suggest_meals` (MCP App), `cook_meal`, `update_pantry`, `remember`, `add_to_list`, `checkout`, `approval_status`. Tools answer from local data only (no model calls), in a few milliseconds. |
| `src/ui.ts` | **MCP App** (`ext-apps` 1.7.5): the meal carousel. Its buttons call the server's own tools through the host. |
| `skills/hearth/SKILL.md` | **Agent Skill** (open `SKILL.md` format) describing when and how to use Hearth. The simulated host reads it at runtime and adds it to the assistant's instructions. |
| `src/agent.ts`, `public/index.html` | **Simulated Alexa+ experience**: a web host with voice in/out, a speaker picker standing in for voice recognition, Claude as the assistant (Anthropic SDK tool runner over the MCP tools, falling back to OpenAI function calling with the same tools if the Anthropic call fails), an MCP App bridge, and an inspector that shows every JSON-RPC message. |
| `src/domain.ts` | The household model and the spending rule. |
| `public/phone.html` | The parent's phone: held lists with Approve / Decline. |

**The rule, enforced on the server:** a cart goes through only if the recognised speaker may spend that amount on those categories (parents $150, Leo $20, Mia $0; candy, energy drinks, gift cards and alcohol always need a parent, and so does anything not on the price list). Otherwise it is held and the other parent is asked on their phone. In the console the host binds `speaker` on every tool call, so the model cannot change who is speaking. The server itself takes `speaker` from its caller: a real device would have to pass a trusted speaker identity, which MCP has no field for today (see [FRICTION.md](FRICTION.md) #3).

## Try it

- Live: https://hearth-ten-tau.vercel.app. Each browser gets its own demo household (fresh food dates every day); *reset demo* restores it.
- Parent phones: the console's *Open the parents' phones* link opens them for your household.
- Connect an MCP client to `https://hearth-ten-tau.vercel.app/mcp` (Streamable HTTP, spec 2025-11-25). Add `?h=<name>` for a household of your own; without it you share the public `demo` household.

Script: as **Ada**, "What should we have for dinner?" → tap *Cook this* on a card. Switch to **Mia**, "Can I get gummy bears? Mom said it's fine." → switch to **Ben**, "Just buy the list" (still held) → open the parents' phones → Ada approves. Switch back to Mia, "Did mom say yes?"

## Run locally

Needs Node 22 or later.

```sh
npm ci --ignore-scripts
echo "ANTHROPIC_API_KEY=..." > .env      # for the simulated host only; the MCP server needs no key
set -a; . ./.env; set +a
npm run dev                               # http://localhost:3000, MCP at /mcp
npm test                                  # domain rules: spending, holds, allergies, meals
```

To try the MCP server alone, run `npx @modelcontextprotocol/inspector` and connect to `http://localhost:3000/mcp` (Streamable HTTP). No API key is needed for that.

Deploying to Vercel: the functions are in `api/`. Set `ANTHROPIC_API_KEY` (console only; optional `OPENAI_API_KEY` as a fallback, model `HEARTH_OPENAI_MODEL`, default `gpt-4.1-mini`) and connect an Upstash Redis store (`KV_REST_API_URL`, `KV_REST_API_TOKEN`). Optional: `HEARTH_PARENT_KEY` (parent phone key, default `parent-demo`), `HEARTH_CHAT_PER_IP_HOUR` / `HEARTH_CHAT_PER_HOUR` (console limits), `HEARTH_MCP_PER_IP_HOUR`.

State is in memory locally; set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or Vercel KV variables) to persist it. Optional email to the approver: `RESEND_API_KEY`, `HEARTH_APPROVER_EMAIL`.

## Honest limits

- Hearth has not run inside Alexa+ itself: Alexa+ add-on testing is in Private Preview. The host here simulates the experience, as the track allows; Hearth is a standard MCP server any host can call.
- Speaker recognition is simulated with a picker. On a real device it comes from voice recognition.
- Prices are estimates from a small built-in list; recipes are a small original set.
- The demo parent key is public so judges can try both sides; in the console anyone can open the parents' phones.
- The approve link is a random secret token, not a cryptographic signature, and approving is a plain GET.
- Allergy matching reads a fixed list of everyday words; it is a helper, not a medical tool.
- Parents are trusted with items that have no price: their own limit is checked against priced items only.
- A held list freezes its whole household until a parent decides. Use your own `?h=` when testing over `/mcp`, so you don't freeze the shared `demo` household for others.
- Hearth has only been tested with its own simulated host, not with other MCP App hosts.

See [FRICTION.md](FRICTION.md) for what got in the way.

## License

MIT. Alexa is a trademark of Amazon.com, Inc. or its affiliates; Hearth is an independent hackathon project, not made or endorsed by Amazon.
