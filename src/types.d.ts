// edrys-websocket-server ships plain JS without types for this entry.
declare module 'edrys-websocket-server/utils' {
  import type { WebSocket } from 'ws'
  import type { IncomingMessage } from 'node:http'
  export function setupWSConnection(conn: WebSocket, req: IncomingMessage): void
}
