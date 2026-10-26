import express from 'express'

/**
 * Serves local modules (`dir/<name>/...`), on a port of their own: a module on
 * edrys-Lite's origin could read its storage, the owner's key included. Real
 * modules always come from another origin, so these do too.
 */
export function moduleApp(dir: string): express.Express {
  const app = express()
  app.use((req, res, next) => {
    // edrys-Lite fetches a module from its own origin to read its meta tags
    res.setHeader('Access-Control-Allow-Origin', '*')
    // a reload must get the files as they are now
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use(express.static(dir, { etag: false, lastModified: false }))
  return app
}
