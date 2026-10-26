import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import express from 'express'
import { watchFile } from './watch.js'

export type Report = { type: string; [key: string]: any }

export type DevServerOptions = {
  /** Absolute path of the lab file. */
  lab: string
  port: number
  host: string
  /**
   * Sync the class on this server instead of the transport edrys-Lite was
   * built with (its .env), e.g. to work offline.
   */
  local?: boolean
}

export type DevServer = {
  port: number
  app: express.Express
  /**
   * `report` (Report): what a tab posted to /edrys-dev/bridge.
   * `connection` (boolean): the owner tab came or went, settled over SETTLE_MS.
   */
  bus: EventEmitter
  /** Whether the owner tab is connected, and the share link it reported last. */
  state(): { connected: boolean; share: string | null }
  close(): Promise<void>
}

// A reload closes the owner tab's stream and opens a new one within a moment;
// only a change that lasts this long counts.
const SETTLE_MS = 2000

/** The built edrys-Lite this package serves. */
export function edrysDist(): string {
  const require = createRequire(import.meta.url)
  return path.join(path.dirname(require.resolve('edrys-lite/package.json')), 'dist')
}

/** Requests from a page of another origin, e.g. a module's own site, are refused. */
export function sameOrigin(req: express.Request): boolean {
  const origin = req.headers.origin
  return origin === undefined || origin === `http://${req.headers.host}`
}

/**
 * Serves edrys-Lite with the endpoints its DevBridge talks to (see
 * edrys-Lite src/ts/DevBridge.ts), plus a sync server with `local`, all on
 * one port. When the port is taken, the next free one is used.
 */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const app = express()
  const bus = new EventEmitter()
  const clients = new Set<express.Response>()
  let share: string | null = null

  let reported = false
  let settling: NodeJS.Timeout | undefined
  const settle = () => {
    clearTimeout(settling)
    settling = setTimeout(() => {
      const connected = clients.size > 0
      if (connected !== reported) bus.emit('connection', (reported = connected))
    }, SETTLE_MS)
  }

  app.get('/edrys-dev/lab', async (req, res) => {
    res.json({
      path: options.lab,
      text: await fs.readFile(options.lab, 'utf8'),
      // Without it the class keeps its own (or edrys-Lite's default) transport.
      communication: options.local
        ? { communicationMethod: 'Websocket', websocketUrl: `ws://${req.headers.host}` }
        : undefined,
    })
  })

  app.get('/edrys-dev/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(': edrys-dev\n\n')
    clients.add(res)
    settle()
    req.on('close', () => {
      clients.delete(res)
      settle()
    })
  })

  app.post('/edrys-dev/bridge', express.json(), (req, res) => {
    if (!sameOrigin(req)) return res.sendStatus(403)
    const report: Report = req.body
    if (report.type === 'open' && typeof report.url === 'string') share = report.url
    bus.emit('report', report)
    res.sendStatus(204)
  })

  app.use(express.static(edrysDist()))

  const server = http.createServer(app)
  // Loaded only when used: edrys-websocket-server is an optional dependency.
  const stopSync = options.local ? (await import('./sync.js')).attachSync(server) : () => {}
  const stopWatching = watchFile(options.lab, () => {
    for (const client of clients) client.write('event: reload-lab\ndata: {}\n\n')
  })

  const port = await listen(server, options.port, options.host)

  return {
    port,
    app,
    bus,
    state: () => ({ connected: clients.size > 0, share }),
    async close() {
      clearTimeout(settling)
      await stopWatching()
      stopSync()
      for (const client of clients) client.end()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

async function listen(server: http.Server, port: number, host: string, tries = 20): Promise<number> {
  for (let next = port; next < port + tries; next++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(next, host, () => {
          server.off('error', reject)
          resolve()
        })
      })
      return next
    } catch (error: any) {
      if (error.code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error(`no free port in ${port}-${port + tries - 1}`)
}
