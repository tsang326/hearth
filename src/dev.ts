// Local dev server: same handlers as the Vercel functions, plus static files from public/.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { handleApprovals, handleChat, handleDecide, handleMcp, handleProxy, handleReset, handleState } from './http.js'

const routes: Record<string, (req: any, res: any) => Promise<unknown>> = {
  '/mcp': handleMcp, '/api/mcp': handleMcp, '/api/approvals': handleApprovals, '/api/decide': handleDecide, '/api/reset': handleReset, '/api/chat': handleChat, '/api/proxy': handleProxy, '/api/state': handleState,
}
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

export function startDev(port = Number(process.env.PORT ?? 3000), extra: Record<string, (req: any, res: any) => Promise<unknown>> = {}) {
  const all = { ...routes, ...extra }
  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    try {
      const h = all[path]
      if (h) return void (await h(req, res))
      const file = join('public', path === '/' ? 'index.html' : path.replace(/^\/+/, ''))
      if (!file.startsWith('public')) { res.statusCode = 400; return res.end() }
      const body = await readFile(file).catch(() => readFile(file + '.html'))
      res.setHeader('Content-Type', types[extname(file)] ?? 'text/html; charset=utf-8')
      res.end(body)
    } catch (e) {
      if (!res.headersSent) { res.statusCode = 404; res.end('Not found') }
      else console.error(e)
    }
  }).listen(port, () => console.log(`Hearth dev on http://localhost:${port}`))
}

if (import.meta.url === `file://${process.argv[1]}`) startDev()
