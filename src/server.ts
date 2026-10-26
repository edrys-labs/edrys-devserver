import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
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
  /** What the browser tabs report (POST /edrys-dev/bridge). */
  onReport?: (report: Report) => void
}

export type DevServer = {
  port: number
  close(): Promise<void>
}

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
  const clients = new Set<express.Response>()

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
    req.on('close', () => clients.delete(res))
  })

  app.post('/edrys-dev/bridge', express.json(), (req, res) => {
    options.onReport?.(req.body)
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
    async close() {
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
