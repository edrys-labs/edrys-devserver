import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import express from 'express'
import { unpack } from 'msgpackr'
import { watchFile, watchModules } from './watch.js'
import { moduleApp } from './modules.js'
import { hostGuard, hostNames, sameOrigin } from './origin.js'
import { Chat, panelFiles, panelScript } from './chat.js'

export type Report = { type: string; [key: string]: any }

export type ClassState = {
  room: string | null
  rooms: Record<string, { name: string; role: string; me?: true }[]>
  modules: { name: string; url: string; error?: string }[]
}

/** What the modules did, as the class tab saw it, and what local modules threw. */
export type LogEntry =
  | { t: number; kind: 'message'; subject: string; body: string; module?: string; from?: string }
  | { t: number; kind: 'error'; module: string; source: 'error' | 'console'; message: string }

// entries the log keeps, oldest first out
const LOG_MAX = 300
// a body in the log is cut to this many characters of JSON
const BODY_MAX = 1000

/**
 * A module message body as the agent can read it: edrys.js sends bodies as
 * base64 MessagePack, the class tab passes them on as they are.
 */
export function readableBody(body: unknown): string {
  let value = body
  if (typeof body === 'string' && body.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    try {
      value = unpack(Buffer.from(body, 'base64'))
    } catch {}
  }
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return text.length > BODY_MAX ? text.slice(0, BODY_MAX) + '…' : text
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
  /** An agent is connected (--mcp): the class tab gets its chat panel. */
  agent?: boolean
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
  /**
   * A question to the owner tab's DevBridge, e.g. read-state {room}: resolves
   * with its reply's value, rejects with its error or after `ms`.
   */
  request(event: string, data: object, ms?: number): Promise<any>
  /** The local modules folder and the address it is served at, if any. */
  modules: { dir: string; url: string } | null
  /** Module messages and errors, oldest first; `dropped` messages the tab skipped. */
  log(): { entries: LogEntry[]; dropped: number }
  close(): Promise<void>
}

// A reload closes the owner tab's stream and opens a new one within a moment;
// only a change that lasts this long counts.
const SETTLE_MS = 2000

/** The built edrys-Lite this package serves. */
export function edrysDist(): string {
  const require = createRequire(import.meta.url)
  return path.join(path.dirname(require.resolve('@edryslabs/edrys-lite/package.json')), 'dist')
}

/**
 * Serves edrys-Lite with the endpoints its DevBridge talks to (see
 * edrys-Lite src/ts/DevBridge.ts), plus a sync server with `local`, all on
 * one port. When the port is taken, the next free one is used.
 */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const app = express()
  // a page that rebinds its own domain to this machine would pass sameOrigin
  const names = hostNames(options.host)
  app.use(hostGuard(names))
  const bus = new EventEmitter()
  const clients = new Set<express.Response>()
  let share: string | null = null
  let classState: ClassState | null = null

  const log: LogEntry[] = []
  let dropped = 0
  const addLog = (entry: LogEntry) => {
    log.push(entry)
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX)
  }

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

  // questions to the owner tab, by id, until it replies
  const pending = new Map<string, (reply: Report) => void>()

  // a reply carries a room's whole state
  app.post('/edrys-dev/bridge', express.json({ limit: '2mb' }), (req, res) => {
    if (!sameOrigin(req)) return res.sendStatus(403)
    const report: Report = req.body
    if (report.type === 'reply') {
      pending.get(report.id)?.(report)
      return res.sendStatus(204)
    }
    if (report.type === 'open' && typeof report.url === 'string') share = report.url
    if (report.type === 'class') {
      const { type, ...state } = report
      classState = state as ClassState
    }
    if (report.type === 'messages' && Array.isArray(report.messages)) {
      for (const m of report.messages) addLog({ ...m, body: readableBody(m.body), kind: 'message' })
      dropped += Number(report.dropped) || 0
    }
    bus.emit('report', report)
    res.sendStatus(204)
  })

  // The error reporter of local modules (see modules.ts): from the module
  // server's origin, or "null" for a module edrys-Lite inlined. Any page can
  // be "null" (a sandboxed frame), so the reporter also carries the token,
  // which only local module pages hold.
  let moduleOrigins: string[] = []
  const reportToken = crypto.randomBytes(16).toString('hex')
  app.post('/edrys-dev/module-error/:token', express.text({ type: () => true }), (req, res) => {
    if (req.params.token !== reportToken || !moduleOrigins.includes(String(req.headers.origin))) {
      return res.sendStatus(403)
    }
    let error: any
    try {
      error = JSON.parse(req.body)
    } catch {
      return res.sendStatus(400)
    }
    const entry: LogEntry = {
      t: Date.now(),
      kind: 'error',
      module: String(error.module),
      source: error.kind === 'console' ? 'console' : 'error',
      message: String(error.message).slice(0, 2000),
    }
    addLog(entry)
    bus.emit('report', { type: 'module-error', ...entry })
    res.sendStatus(204)
  })

  const chat = new Chat(path.join(path.dirname(options.lab), '.edrys-dev', 'chat.json'))
  // without an agent, nobody would answer
  if (options.agent) chat.routes(app)
  panelFiles(app)

  // edrys-Lite's page, with panel.js (the chat shows only in the class tab)
  app.get(['/', '/index.html'], async (req, res) => {
    const page = await fs.readFile(path.join(edrysDist(), 'index.html'), 'utf8')
    res.type('html').send(page + panelScript(!!options.agent))
  })

  app.use(express.static(edrysDist()))

  const server = http.createServer(app)
  // Loaded only when used: @edryslabs/websocket-server is an optional dependency.
  const stopSync = options.local ? (await import('./sync.js')).attachSync(server, names) : () => {}
  const send = (event: string, data: object) => {
    for (const client of clients) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const request = (event: string, data: object, ms = 5000) =>
    new Promise<any>((resolve, reject) => {
      if (!clients.size) return reject(new Error('the class tab is not open'))
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`the class tab did not answer within ${ms / 1000} s`))
      }, ms)
      pending.set(id, (reply) => {
        clearTimeout(timer)
        pending.delete(id)
        if (reply.error !== undefined) reject(new Error(String(reply.error)))
        else resolve(reply.value)
      })
      send(event, { id, ...data })
    })
  const stopWatching = watchFile(options.lab, () => send('reload-lab', {}))

  const port = await listen(server, options.port, options.host)

  let modules: { dir: string; url: string } | null = null
  let stopModules = async () => {}
  if (options.modules) {
    const dir = options.modules
    // the class tab may use either local address
    const pageOrigins = [...new Set(['localhost', '127.0.0.1', options.host].map((host) => `http://${host}:${port}`))]
    const moduleServer = http.createServer(
      moduleApp(dir, `http://localhost:${port}/edrys-dev/module-error/${reportToken}`, pageOrigins, names)
    )
    const modulePort = await listen(moduleServer, port + 1, options.host)
    modules = { dir, url: `http://localhost:${modulePort}/` }
    moduleOrigins = [`http://localhost:${modulePort}`, `http://127.0.0.1:${modulePort}`, 'null']

    const stopWatchingModules = watchModules(dir, (name) => {
      // the lab may name either local address; one event, so the class tab
      // scrapes the module once
      send('reload-module', {
        urls: ['localhost', '127.0.0.1'].map((host) => `http://${host}:${modulePort}/${name}/`),
      })
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
    request,
    modules,
    log: () => ({ entries: log, dropped }),
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
