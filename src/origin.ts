import os from 'node:os'
import type http from 'node:http'
import type express from 'express'

const WILDCARDS = ['0.0.0.0', '::']

/**
 * The host names a server listening on `host` answers to: this machine's own,
 * plus every address of its network interfaces when it listens on all of them.
 * A page that rebinds its own domain to 127.0.0.1 sends that domain instead.
 */
export function hostNames(host: string): string[] {
  const names = ['localhost', '127.0.0.1', '[::1]']
  const add = (address: string) => names.push(address.includes(':') ? `[${address}]` : address)
  if (WILDCARDS.includes(host)) {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const { address } of addresses ?? []) add(address)
    }
  } else {
    add(host)
  }
  return [...new Set(names)]
}

/** Whether `host` listens on more than this machine's loopback addresses. */
export function reachable(host: string): boolean {
  return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)
}

// `value` (a Host, or an Origin without its scheme) is one of `names` on this server's port
function ours(req: http.IncomingMessage, names: string[], value: string | undefined): boolean {
  const port = req.socket.localPort
  // browsers leave out the default port
  return names.some((name) => value === `${name}:${port}` || (port === 80 && value === name))
}

/** Refuses requests whose Host header is not one of `names` on this server's port. */
export function hostGuard(names: string[]): express.RequestHandler {
  return (req, res, next) => (ours(req, names, req.headers.host) ? next() : res.sendStatus(403))
}

/**
 * Whether a WebSocket upgrade comes from one of edrys-dev's own pages. Browsers
 * send an Origin with every WebSocket, and let any site open one; a student
 * tab (127.0.0.1) connects to the owner's address (localhost), so any of
 * `names` will do, not only the Host.
 */
export function ownPage(req: http.IncomingMessage, names: string[]): boolean {
  const origin = req.headers.origin
  return (
    ours(req, names, req.headers.host) &&
    typeof origin === 'string' &&
    origin.startsWith('http://') &&
    ours(req, names, origin.slice('http://'.length))
  )
}

/**
 * Posts from edrys-Lite's page on this server only: browsers always send an
 * Origin with a POST, so one without it is no page of ours (another local user,
 * another program). Pages of another origin, e.g. a module's own site, are
 * refused too. Run after hostGuard, which vouches for the Host.
 */
export function sameOrigin(req: express.Request): boolean {
  return req.headers.origin === `http://${req.headers.host}`
}
