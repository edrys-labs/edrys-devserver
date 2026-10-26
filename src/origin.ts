import type express from 'express'

/** Requests from a page of another origin, e.g. a module's own site, are refused. */
export function sameOrigin(req: express.Request): boolean {
  const origin = req.headers.origin
  return origin === undefined || origin === `http://${req.headers.host}`
}
