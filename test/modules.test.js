import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { startDevServer } from '../dist/server.js'
import { localUrls } from '../dist/mcp.js'

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
  assert.equal(await response.text(), '<title>Term</title>')
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
