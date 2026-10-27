import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import WebSocket from 'ws'
import { startDevServer } from '../dist/server.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edrys-dev-'))
const lab = path.join(dir, 'lab.yml')
const reports = []
let server, base

before(async () => {
  fs.writeFileSync(lab, 'name: One\n')
  server = await startDevServer({ lab, port: 3290, host: '127.0.0.1' })
  server.bus.on('report', (r) => reports.push(r))
  base = `http://127.0.0.1:${server.port}`
})

after(async () => {
  await server.close()
  fs.rmSync(dir, { recursive: true })
})

test('serves edrys-Lite', async () => {
  const response = await fetch(base + '/')
  assert.equal(response.status, 200)
  assert.match(await response.text(), /<html/i)
})

test('without an agent: panel.js reloads other tabs, but there is no chat', async () => {
  const page = await (await fetch(base + '/?dev')).text()
  assert.match(page, /<script src="\/edrys-dev\/panel\.js" defer><\/script>$/)
  assert.equal((await fetch(base + '/edrys-dev/panel.js')).status, 200)
  assert.equal((await fetch(base + '/edrys-dev/chat/events')).status, 404)
})

test('hands out the lab, leaving its transport alone', async () => {
  const lab_ = await (await fetch(base + '/edrys-dev/lab')).json()
  assert.equal(lab_.path, lab)
  assert.equal(lab_.text, 'name: One\n')
  assert.equal(lab_.communication, undefined)
})

test('no sync server unless --local', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/some-class`)
  await assert.rejects(
    new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
  )
})

test('sends reload-lab once per save', async () => {
  const events = []
  const request = http.get(base + '/edrys-dev/events')
  const response = await new Promise((resolve) => request.on('response', resolve))
  response.setEncoding('utf8')
  response.on('data', (chunk) => events.push(...chunk.match(/event: \S+/g) ?? []))
  await new Promise((resolve) => setTimeout(resolve, 200))

  fs.writeFileSync(lab, 'name: Two\n')
  await new Promise((resolve) => setTimeout(resolve, 600))
  request.destroy()

  assert.deepEqual(events, ['event: reload-lab'])
})

test('passes browser reports on', async () => {
  const response = await fetch(base + '/edrys-dev/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'open', url: 'x' }),
  })
  assert.equal(response.status, 204)
  assert.deepEqual(reports.at(-1), { type: 'open', url: 'x' })
  assert.equal(server.state().share, 'x')
})

test('refuses reports from pages of another origin', async () => {
  const response = await fetch(base + '/edrys-dev/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://some-module.example' },
    body: JSON.stringify({ type: 'open', url: 'forged' }),
  })
  assert.equal(response.status, 403)
  assert.notEqual(server.state().share, 'forged')
})

test('reports the owner tab coming and going, not a quick reload', async () => {
  const seen = []
  const listener = (connected) => seen.push(connected)
  server.bus.on('connection', listener)
  const connect = () => {
    const request = http.get(base + '/edrys-dev/events')
    return new Promise((resolve) => request.on('response', () => resolve(request)))
  }

  let tab = await connect()
  await new Promise((resolve) => setTimeout(resolve, 2300))
  tab.destroy() // reload: gone and back within a moment
  tab = await connect()
  await new Promise((resolve) => setTimeout(resolve, 2300))
  tab.destroy()
  await new Promise((resolve) => setTimeout(resolve, 2300))

  server.bus.off('connection', listener)
  assert.deepEqual(seen, [true, false])
})

test('--local: syncs Yjs docs on the same port and points the class there', async () => {
  const local = await startDevServer({ lab, port: 3280, host: '127.0.0.1', local: true })
  try {
    const lab_ = await (await fetch(`http://127.0.0.1:${local.port}/edrys-dev/lab`)).json()
    assert.deepEqual(lab_.communication, {
      communicationMethod: 'Websocket',
      websocketUrl: `ws://127.0.0.1:${local.port}`,
    })

    // A Yjs doc answers right away with its sync step 1.
    const ws = new WebSocket(`ws://127.0.0.1:${local.port}/some-class`)
    const first = await new Promise((resolve, reject) => {
      ws.on('message', resolve)
      ws.on('error', reject)
    })
    ws.close()
    assert.equal(new Uint8Array(first)[0], 0) // messageSync
  } finally {
    await local.close()
  }
})

test('takes the next port when the first is in use', async () => {
  const second = await startDevServer({ lab, port: server.port, host: '127.0.0.1' })
  try {
    assert.equal(second.port, server.port + 1)
  } finally {
    await second.close()
  }
})
