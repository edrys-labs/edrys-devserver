import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import express from 'express'
import { watchFile, watchModules } from './watch.js'
import { moduleApp } from './modules.js'
import { sameOrigin } from './origin.js'
import { Chat, PANEL_SCRIPT } from './chat.js'

export type Report = { type: string; [key: string]: any }

export type ClassState = {
  room: string | null
  rooms: Record<string, { name: string; role: string; me?: true }[]>
  modules: string[]
}

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
  /** Absolute path of a folder of local modules, one per subfolder. */
  modules?: string
}

export type DevServer = {
  port: number
  app: express.Express
  /**
   * `report` (Report): what a tab posted to /edrys-dev/bridge.
   * `connection` (boolean): the owner tab came or went, settled over SETTLE_MS.
   */
  bus: EventEmitter
  /** The agent chat over the class tab. */
  chat: Chat
  /**
   * Whether the owner tab is connected, the share link and the class (own
   * room, who is in which room, modules) it reported last.
   */
  state(): { connected: boolean; share: string | null; class: ClassState | null }
  /** A command to the owner tab's DevBridge, e.g. goto {room}. */
  send(event: string, data: object): void
  /** The local modules folder and the address it is served at, if any. */
  modules: { dir: string; url: string } | null
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
  let classState: ClassState | null = null

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

  // Student and station tabs have no DevBridge: they only learn that a local
  // module changed, and load the page again. Not counted as the owner tab.
  const others = new Set<express.Response>()
  app.get('/edrys-dev/reload', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(': edrys-dev\n\n')
    others.add(res)
    req.on('close', () => others.delete(res))
  })

  app.post('/edrys-dev/bridge', express.json(), (req, res) => {
    if (!sameOrigin(req)) return res.sendStatus(403)
    const report: Report = req.body
    if (report.type === 'open' && typeof report.url === 'string') share = report.url
    if (report.type === 'class') {
      const { type, ...state } = report
      classState = state as ClassState
    }
    bus.emit('report', report)
    res.sendStatus(204)
  })

  const chat = new Chat(path.join(path.dirname(options.lab), '.edrys-dev', 'chat.json'))
  chat.routes(app)

  // edrys-Lite's page, with the chat panel (it shows only in the class tab)
  app.get(['/', '/index.html'], async (req, res) => {
    const page = await fs.readFile(path.join(edrysDist(), 'index.html'), 'utf8')
    res.type('html').send(page + PANEL_SCRIPT)
  })

  app.use(express.static(edrysDist()))

  const server = http.createServer(app)
  // Loaded only when used: edrys-websocket-server is an optional dependency.
  const stopSync = options.local ? (await import('./sync.js')).attachSync(server) : () => {}
  const send = (event: string, data: object) => {
    for (const client of clients) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const stopWatching = watchFile(options.lab, () => send('reload-lab', {}))

  const port = await listen(server, options.port, options.host)

  let modules: { dir: string; url: string } | null = null
  let stopModules = async () => {}
  if (options.modules) {
    const dir = options.modules
    const moduleServer = http.createServer(moduleApp(dir))
    const modulePort = await listen(moduleServer, port + 1, options.host)
    modules = { dir, url: `http://localhost:${modulePort}/` }

    const stopWatchingModules = watchModules(dir, (name) => {
      // the lab may name either local address
      for (const host of ['localhost', '127.0.0.1']) {
        send('reload-module', { url: `http://${host}:${modulePort}/${name}/` })
      }
      for (const other of others) other.write('event: reload-module\ndata: {}\n\n')
      bus.emit('module-changed', name)
    })
    stopModules = async () => {
      await stopWatchingModules()
      moduleServer.closeAllConnections()
      await new Promise((resolve) => moduleServer.close(resolve))
    }
  }

  return {
    port,
    app,
    bus,
    chat,
    state: () => ({ connected: clients.size > 0, share, class: classState }),
    send,
    modules,
    async close() {
      clearTimeout(settling)
      await stopWatching()
      await stopModules()
      stopSync()
      for (const client of [...clients, ...others]) client.end()
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
