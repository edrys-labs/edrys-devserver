import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'

/**
 * Reports a module's uncaught errors, rejected promises and console.error to
 * edrys-dev. Plain text without reading the answer, so the browser sends it to
 * another origin without asking first; `name` comes from the server, since a
 * module that edrys-Lite inlines runs on a data: URL.
 */
export function errorReporter(name: string, reportUrl: string): string {
  // a string literal that cannot end the script tag
  const literal = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c')
  return `<script>(function () {
  var send = function (kind, message) {
    try {
      // no-cors: the answer is of no use, and reading it would log a CORS error
      fetch(${literal(reportUrl)}, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({ module: ${literal(name)}, kind: kind, message: String(message).slice(0, 2000) }),
        keepalive: true
      }).catch(function () {})
    } catch (e) {}
  }
  addEventListener('error', function (e) {
    // a failed <img> or <script> load fires this too, without a message
    if (e.error || e.message) send('error', (e.error && e.error.stack) || e.message)
  })
  addEventListener('unhandledrejection', function (e) {
    send('error', (e.reason && e.reason.stack) || e.reason)
  })
  var original = console.error
  console.error = function () {
    send('console', [].map.call(arguments, function (a) {
      try { return typeof a === 'string' ? a : (a && a.stack) || JSON.stringify(a) } catch (_) { return String(a) }
    }).join(' '))
    return original.apply(console, arguments)
  }
})()</script>`
}

/** `script` as early in `html` as possible, before the module's own scripts. */
export function inject(html: string, script: string): string {
  // a function, so a $ in the script is no replacement pattern
  for (const tag of [/<head(\s[^>]*)?>/i, /<html(\s[^>]*)?>/i]) {
    if (tag.test(html)) return html.replace(tag, (match) => match + script)
  }
  return script + html
}

/**
 * Serves local modules (`dir/<name>/...`), on a port of their own: a module on
 * edrys-Lite's origin could read its storage, the owner's key included. Real
 * modules always come from another origin, so these do too. HTML pages get
 * the error reporter, which posts to `reportUrl`.
 */
export function moduleApp(dir: string, reportUrl: string): express.Express {
  const app = express()
  app.use((req, res, next) => {
    // edrys-Lite fetches a module from its own origin to read its meta tags
    res.setHeader('Access-Control-Allow-Origin', '*')
    // a reload must get the files as they are now
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.get(/(\/|\.html?)$/i, async (req, res, next) => {
    const file = path.resolve(dir, '.' + decodeURIComponent(req.path) + (req.path.endsWith('/') ? 'index.html' : ''))
    const name = path.relative(dir, file).split(path.sep)[0]
    if (!file.startsWith(dir + path.sep) || !name) return next()
    try {
      const html = await fs.readFile(file, 'utf8')
      res.type('html').send(inject(html, errorReporter(name, reportUrl)))
    } catch {
      next()
    }
  })

  app.use(express.static(dir, { etag: false, lastModified: false }))
  return app
}
