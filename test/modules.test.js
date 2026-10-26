import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { pack } from 'msgpackr'
import { startDevServer, readableBody } from '../dist/server.js'
import { localUrls } from '../dist/mcp.js'
import vm from 'node:vm'
import { inject, runner } from '../dist/modules.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edrys-dev-modules-'))
const lab = path.join(dir, 'lab.yml')
const modules = path.join(dir, 'modules')
let server, base

before(async () => {
  fs.writeFileSync(lab, 'name: One\n')
  fs.mkdirSync(path.join(modules, 'term'), { recursive: true })
  fs.writeFileSync(path.join(modules, 'term', 'index.html'), '<title>Term</title>')
  server = await startDevServer({ lab, port: 3250, host: '127.0.0.1', modules })
  base = `http://127.0.0.1:${server.port}`
})

after(async () => {
  await server.close()
  fs.rmSync(dir, { recursive: true })
})

// lines of `event:` from a server-sent event stream
async function listen(url) {
  const events = []
  const request = http.get(url)
  const response = await new Promise((resolve) => request.on('response', resolve))
  response.setEncoding('utf8')
  response.on('data', (chunk) => {
    for (const block of chunk.split('\n\n')) {
      const event = block.match(/^event: (.+)$/m)?.[1]
      if (event) events.push({ event, data: JSON.parse(block.match(/^data: (.+)$/m)[1]) })
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  return { events, close: () => request.destroy() }
}

test('serves local modules on the next port, for other origins, never cached', async () => {
  assert.deepEqual(server.modules, { dir: modules, url: `http://localhost:${server.port + 1}/` })
  const response = await fetch(`http://127.0.0.1:${server.port + 1}/term/index.html`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /<title>Term<\/title>$/)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('a save in a module folder reloads that module, once', async () => {
  const student = await listen(base + '/edrys-dev/reload')
  // the other tabs do not count as the class tab
  assert.equal(server.state().connected, false)
  const owner = await listen(base + '/edrys-dev/events')

  fs.writeFileSync(path.join(modules, 'term', 'index.html'), '<title>Term 2</title>')
  fs.writeFileSync(path.join(modules, 'term', 'app.js'), '1')
  fs.writeFileSync(path.join(modules, 'README.md'), 'not a module')
  await new Promise((resolve) => setTimeout(resolve, 700))
  owner.close()
  student.close()

  const port = server.port + 1
  assert.deepEqual(owner.events, [
    { event: 'reload-module', data: { url: `http://localhost:${port}/term/` } },
    { event: 'reload-module', data: { url: `http://127.0.0.1:${port}/term/` } },
  ])
  assert.deepEqual(student.events, [{ event: 'reload-module', data: {} }])
})

test('no module server without a modules folder', async () => {
  const plain = await startDevServer({ lab, port: 3240, host: '127.0.0.1' })
  try {
    assert.equal(plain.modules, null)
  } finally {
    await plain.close()
  }
})

test('localUrls finds what only this machine can load', () => {
  const text = `modules:
  - url: http://localhost:3211/term/index.html
  - url: "http://127.0.0.1:3211/editor/"
  - url: https://edrys-labs.github.io/module-markdown-it/index.html
  - url: http://localhost:3211/term/index.html
config: {"x": "http://[::1]:8080/a"}`
  assert.deepEqual(localUrls(text), [
    'http://localhost:3211/term/index.html',
    'http://127.0.0.1:3211/editor/',
    'http://[::1]:8080/a',
  ])
})

test('HTML pages of local modules report their errors, other files stay as they are', async () => {
  const moduleBase = `http://127.0.0.1:${server.port + 1}`
  fs.writeFileSync(path.join(modules, 'term', 'index.html'), '<html><head><title>T</title></head><body></body></html>')
  fs.writeFileSync(path.join(modules, 'term', 'app.js'), 'console.log(1)')

  for (const url of [`${moduleBase}/term/`, `${moduleBase}/term/index.html`]) {
    const html = await (await fetch(url)).text()
    assert.match(html, /^<html><head><script>\(function \(\) \{/, url)
    assert.match(html, /module: "term"/)
    assert.match(html, new RegExp(`fetch\\("http://localhost:${server.port}/edrys-dev/module-error"`))
    // the runner takes code from edrys-Lite's page only
    assert.ok(html.includes(`var origins = ["http://localhost:${server.port}","http://127.0.0.1:${server.port}"]`))
  }
  assert.equal(await (await fetch(`${moduleBase}/term/app.js`)).text(), 'console.log(1)')
  // nothing outside the folder
  assert.equal((await fetch(`${moduleBase}/%2e%2e/lab.yml`)).status, 404)
})

test('the runner runs code from edrys-Lite\'s page only, and answers it', async () => {
  const page = 'http://localhost:3210'
  let listener
  const posted = []
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) }
  const context = vm.createContext({ parent, addEventListener: (type, fn) => (listener = fn) })
  vm.runInContext(runner([page]).replace(/^<script>|<\/script>$/g, ''), context)

  const run = async (code, from = {}) => {
    posted.length = 0
    listener({ source: parent, origin: page, data: { event: 'dev-run', id: 'i', code }, ...from })
    await new Promise((resolve) => setTimeout(resolve, 10))
    return posted.map(({ message, origin }) => ({ ...message, origin }))
  }
  const answer = (result) => [{ ...result, event: 'dev-ran', id: 'i', origin: page }]

  assert.deepEqual(await run('1 + 1;'), answer({ value: '2' }))
  assert.deepEqual(await run('const a = [1]; await 0; return a'), answer({ value: '[1]' }))
  // as in the console
  assert.deepEqual(await run('let c = 2; c * 3'), answer({ value: '6' }))
  assert.deepEqual(await run('await Promise.resolve({ b: 2 }) // a comment'), answer({ value: '{"b":2}' }))
  assert.deepEqual(await run('undefined'), answer({ value: 'undefined' }))
  assert.deepEqual(await run('nope.x'), answer({ error: 'ReferenceError: nope is not defined' }))
  assert.match((await run('return ]'))[0].error, /SyntaxError/)

  // not from edrys-Lite's page, or not from the parent frame
  assert.deepEqual(await run('1', { origin: 'https://evil.example' }), [])
  assert.deepEqual(await run('1', { source: {} }), [])
})

test('inject puts the script first in <head>, not into <header>', () => {
  assert.equal(inject('<html><header>x</header></html>', 'S'), '<html>S<header>x</header></html>')
  assert.equal(inject('<HEAD lang="en">x', 'S'), '<HEAD lang="en">Sx')
  assert.equal(inject('just text', '$&S'), '$&Sjust text')
  assert.equal(inject('<head>', '$&'), '<head>$&')
})

test('module errors are taken from local modules only, and land in the log', async () => {
  const post = (origin) =>
    fetch(`${base}/edrys-dev/module-error`, {
      method: 'POST',
      headers: origin ? { Origin: origin } : {},
      body: JSON.stringify({ module: 'term', kind: 'error', message: 'TypeError: x is undefined' }),
    })

  assert.equal((await post(`http://localhost:${server.port + 1}`)).status, 204)
  assert.equal((await post('null')).status, 204) // a module edrys-Lite inlined
  assert.equal((await post('https://evil.example')).status, 403)
  assert.equal((await post(undefined)).status, 403)

  const errors = server.log().entries.filter((e) => e.kind === 'error')
  assert.equal(errors.length, 2)
  assert.deepEqual({ ...errors[0], t: 0 }, {
    t: 0,
    kind: 'error',
    module: 'term',
    source: 'error',
    message: 'TypeError: x is undefined',
  })
})

// a body as edrys.js sends it
const packed = (value) => pack(value).toString('base64')

test('the class tab\'s messages land in the log, readable', async () => {
  await fetch(`${base}/edrys-dev/bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'messages',
      messages: [
        { t: 1, subject: 'execute', body: packed({ code: 'ls -la' }), module: 'http://localhost:3251/term/index.html', from: 'a1b2c3d4' },
      ],
      dropped: 3,
    }),
  })
  const { entries, dropped } = server.log()
  assert.equal(dropped, 3)
  assert.deepEqual(entries.at(-1), {
    t: 1,
    kind: 'message',
    subject: 'execute',
    body: '{"code":"ls -la"}',
    module: 'http://localhost:3251/term/index.html',
    from: 'a1b2c3d4',
  })
})

test('readableBody decodes MessagePack, cuts long bodies, keeps what it cannot decode', () => {
  assert.equal(readableBody(packed('hello')), '"hello"')
  assert.equal(readableBody(packed([1, true, null])), '[1,true,null]')
  assert.equal(readableBody(packed('x'.repeat(5000))).length, 1001)
  assert.equal(readableBody('not base64!'), '"not base64!"')
  assert.equal(readableBody({ tooLarge: 30000 }), '{"tooLarge":30000}')
})
