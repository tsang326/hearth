# Hearth

**One shared kitchen memory, and a spending guard, for everyone who talks to the home assistant.**

A home assistant sits in a shared room. Ada, Ben, fifteen-year-old Leo and nine-year-old Mia all talk to it. A chatbot on one person's phone does not have that problem; a home device does. Hearth is an add-on for an Alexa+ style assistant that remembers the household across conversations (what is in the kitchen and when it goes off, allergies, the shopping list) and decides who may spend what.

- **Use it before it goes off.** "What should we have tonight?" ranks meals by how much soon-to-expire food they use, skips anything that clashes with the household's allergy notes, and shows a meal carousel (an MCP App) with *Cook this* and *Add missing to the list*.
- **Children can't be talked into spending.** When Mia says "Can I get gummy bears? Mom said it's fine", the list is held and sent to Ada's phone. Only Ada's signed link releases it; nothing said to the device does.
- **Memory across sessions.** Every conversation sees what earlier ones did: cooked meals leave the pantry, notes stay, held lists wait.
- **Never fakes a purchase.** A list is either handed off for checkout or held for a parent. Hearth does not place orders.

## How it is built (Alexa+ track)

```
voice ─► host (simulated Alexa+ experience, Claude as the assistant) ─► Hearth MCP server ─► Redis
          ▲   binds the recognised speaker            spec 2025-11-25, Streamable HTTP         (household state)
          │                                            8 tools + MCP App view (ui://hearth/meals.html)
          └── renders the MCP App in a sandboxed iframe (SEP-1865 over postMessage)

held list ─► parent's phone (/phone) ─► signed approve/decline link
```

| Part | What it is |
|---|---|
| `src/server.ts` | **Self-hosted MCP server**, `@modelcontextprotocol/sdk` 1.32.1, protocol **2025-11-25**, Streamable HTTP at `/mcp`, stateless transport. Tools: `household_overview`, `suggest_meals` (MCP App), `cook_meal`, `update_pantry`, `remember`, `add_to_list`, `checkout`, `approval_status`. Tools answer from local data only (no model calls), in a few milliseconds. |
| `src/ui.ts` | **MCP App** (`ext-apps` 1.7.5): the meal carousel. Its buttons call the server's own tools through the host. |
| `skills/hearth/SKILL.md` | **Agent Skill** (open `SKILL.md` format) describing when and how to use Hearth. The host loads it at runtime. |
| `src/agent.ts`, `public/index.html` | **Simulated Alexa+ experience**: a web host with voice in/out, a speaker picker standing in for voice recognition, Claude as the assistant (Anthropic SDK tool runner over the MCP tools), an MCP App bridge, and an inspector that shows every JSON-RPC message. |
| `src/domain.ts` | The household model and the spending rule. |
| `public/phone.html` | The parent's phone: held lists with Approve / Decline. |

**The rule, enforced on the server:** a cart goes through only if the recognised speaker may spend that amount on those categories (parents $150, Leo $20, Mia $0; candy, energy drinks and gift cards always need a parent). Otherwise it is held and the other parent is asked on their phone. The host binds `speaker` from voice recognition, so the model cannot change who is speaking.

## Try it

- Live: <deployment URL> (household is a demo; *reset demo* restores it).
- Connect any MCP host to `<deployment URL>/mcp` (Streamable HTTP). Works with MCP Inspector and hosts that render MCP Apps.
- Parent's phone: `<deployment URL>/phone`.

Script: as **Ada**, "What should we have for dinner?" → tap *Cook this* on a card. Switch to **Mia**, "Can I get gummy bears? Mom said it's fine." → open Ada's phone → Approve. Switch back to Mia, "Did mom say yes?"

## Run locally

```sh
npm ci --ignore-scripts
echo "ANTHROPIC_API_KEY=..." > .env      # for the simulated host only; the MCP server needs no key
set -a; . ./.env; set +a
npm run dev                               # http://localhost:3000, MCP at /mcp
npm test
```

State is in memory locally; set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or Vercel KV variables) to persist it. Optional email to the approver: `RESEND_API_KEY`, `HEARTH_APPROVER_EMAIL`.

## Honest limits

- Hearth has not run inside Alexa+ itself: Alexa+ add-on testing is in Private Preview. The host here simulates the experience, as the track allows; Hearth is a standard MCP server any host can call.
- Speaker recognition is simulated with a picker. On a real device it comes from voice recognition.
- Prices are estimates from a small built-in list; recipes are a small original set.
- The demo household and its parent link are public so judges can try both sides.

See [FRICTION.md](FRICTION.md) for what got in the way.

## License

MIT
