import type { Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { setupWSConnection } from '@edryslabs/websocket-server/utils'
import { ownPage } from './origin.js'

/**
 * Yjs sync on the dev server's own port (`--local`), as in the edrys
 * websocket-server: every path is a doc named after it. Only edrys-dev's own
 * pages may connect (`names`, see hostGuard), not any site the user visits.
 * Returns a function that shuts it down.
 */
export function attachSync(server: Server, names: string[]): () => void {
  const docs = new WebSocketServer({ noServer: true })
  docs.on('connection', setupWSConnection)

  server.on('upgrade', (request, socket, head) => {
    if (!ownPage(request, names)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    docs.handleUpgrade(request, socket, head, (ws) => docs.emit('connection', ws, request))
  })

  return () => docs.close()
}
