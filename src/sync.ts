import type { Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { setupWSConnection } from 'edrys-websocket-server/utils'

/**
 * Yjs sync on the dev server's own port (`--local`), as in the edrys
 * websocket-server: every path is a doc named after it. Returns a function
 * that shuts it down.
 */
export function attachSync(server: Server): () => void {
  const docs = new WebSocketServer({ noServer: true })
  docs.on('connection', setupWSConnection)

  server.on('upgrade', (request, socket, head) => {
    docs.handleUpgrade(request, socket, head, (ws) => docs.emit('connection', ws, request))
  })

  return () => docs.close()
}
