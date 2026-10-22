// The MCP App (SEP-1865) shown with suggest_meals: a carousel of meal cards. "Cook this"
// and "Add missing to the list" call the server's own tools from inside the card.
// The MCP Apps client runtime is inlined so the view needs no network access.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

export const MEALS_URI = 'ui://hearth/meals.html'

let cached: string | undefined

function appRuntime(): string {
  const require = createRequire(import.meta.url)
  const file = require.resolve('@modelcontextprotocol/ext-apps/app-with-deps')
  const src = readFileSync(file, 'utf8')
  const m = src.match(/export\{([^}]*)\};?\s*$/)
  if (!m) throw new Error('Unexpected ext-apps bundle format')
  const local = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)).find(([, alias]) => alias === 'App')?.[0]
  if (!local) throw new Error('App export not found in ext-apps bundle')
  return src.slice(0, m.index) + `\nconst HearthApp = ${local};\n`
}

export function mealsHtml(): string {
  if (cached) return cached
  cached = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#14161c;--muted:#5b6170;--card:#f4f5f8;--accent:#e8590c;--ok:#2b8a3e}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--fg:#eef0f4;--muted:#9aa1b0;--card:#1b1e26}}
body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--fg)}
.row{display:flex;gap:12px;overflow-x:auto;padding:12px;scroll-snap-type:x mandatory}
.card{flex:0 0 220px;scroll-snap-align:start;background:var(--card);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px}
.emoji{font-size:34px}.t{font-weight:700;font-size:15px}.m{font-size:12px;color:var(--muted)}
.soon{font-size:12px;color:var(--accent)}.miss{font-size:12px;color:var(--muted)}
button{border:0;border-radius:10px;padding:8px 10px;font-weight:600;cursor:pointer;background:var(--accent);color:#fff}
button.sec{background:transparent;color:var(--fg);border:1px solid var(--muted)}
.done{color:var(--ok);font-size:12px;font-weight:600}.head{padding:10px 14px 0;font-size:13px;color:var(--muted)}
</style></head><body><div class="head" id="head">Loading meals…</div><div class="row" id="row"></div>
<script type="module">
${appRuntime()}
const app = new HearthApp({ name: 'Hearth meals', version: '1.0.0' }, {})
let speaker = 'ada'
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
function render(data) {
  speaker = data.speaker || speaker
  document.getElementById('head').textContent = data.meals.length ? 'Uses what is about to go off first' : 'No meals fit right now'
  const row = document.getElementById('row')
  row.innerHTML = data.meals.map((m) => '<div class="card" data-id="' + esc(m.id) + '"><div class="emoji">' + esc(m.emoji) + '</div><div class="t">' + esc(m.title) + '</div><div class="m">' + m.minutes + ' min</div>' +
    (m.usesSoon.length ? '<div class="soon">Uses ' + m.usesSoon.map(esc).join(', ') + '</div>' : '') +
    (m.missing.length ? '<div class="miss">Missing: ' + m.missing.map((x) => esc(x.name)).join(', ') + '</div>' : '<div class="miss">Everything is in the kitchen</div>') +
    '<button data-act="cook">Cook this</button>' + (m.missing.length ? '<button class="sec" data-act="list">Add missing to the list</button>' : '') + '<div class="done"></div></div>').join('')
  app.sendSizeChanged?.({ height: document.body.scrollHeight }).catch?.(() => {})
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return
  const card = b.closest('.card'); const id = card.dataset.id; const done = card.querySelector('.done')
  b.disabled = true
  try {
    if (b.dataset.act === 'cook') {
      const r = await app.callServerTool({ name: 'cook_meal', arguments: { speaker, mealId: id } })
      done.textContent = r.isError ? 'Could not log it' : 'Logged — pantry updated'
    } else {
      const missing = [...card.querySelectorAll('.miss')].map((x) => x.textContent.replace('Missing: ', '')).join(',').split(',').map((s) => s.trim()).filter(Boolean)
      const r = await app.callServerTool({ name: 'add_to_list', arguments: { speaker, items: missing.map((name) => ({ name })) } })
      done.textContent = r.isError ? 'Could not add' : 'Added to the shopping list'
    }
  } catch { done.textContent = 'Something went wrong' } finally { b.disabled = false }
})
app.ontoolresult = (p) => { if (p.structuredContent) render(p.structuredContent) }
await app.connect()
</script></body></html>`
  return cached
}
