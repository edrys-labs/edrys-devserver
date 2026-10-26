import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edrys-dev-mcp-'))
const lab = path.join(dir, 'lab.yml')
let agent, lines, nextId = 1
const answers = new Map()
const notifications = []

// talks to `edrys-dev --mcp` the way an agent does
function call(method, params = {}) {
  const id = nextId++
  agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve) => answers.set(id, resolve))
}

async function tool(name, args = {}) {
  const { result } = await call('tools/call', { name, arguments: args })
  return { ...result, value: result.isError ? undefined : JSON.parse(result.content[0].text) }
}

before(async () => {
  fs.writeFileSync(lab, 'name: One\n')
  agent = spawn(process.execPath, ['dist/index.js', lab, '--mcp', '-p', '3270'], { stdio: ['pipe', 'pipe', 'pipe'] })
  lines = readline.createInterface({ input: agent.stdout })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.id !== undefined) answers.get(message.id)?.(message)
    else notifications.push(message)
  })
  await new Promise((resolve) => agent.stderr.once('data', resolve))
})

after(() => {
  agent.kill()
  fs.rmSync(dir, { recursive: true })
})

test('initialize offers tools and the channel, with a protocol version it knows', async () => {
  const { result } = await call('initialize', { protocolVersion: '2026-07-28' })
  assert.equal(result.protocolVersion, '2025-11-25')
  assert.deepEqual(result.capabilities.experimental, { 'claude/channel': {} })
  assert.match(result.instructions, /get_state/)
  assert.ok(result.instructions.length <= 2048)

  const { result: list } = await call('tools/list')
  assert.deepEqual(list.tools.map((t) => t.name), ['get_state', 'wait_for_event'])
  for (const t of list.tools) assert.ok(t.description.length <= 2048, t.name)
})

test('get_state names the lab, the class tab and the event stream', async () => {
  const { value } = await tool('get_state')
  assert.equal(value.lab, lab)
  assert.match(value.url, /^http:\/\/localhost:\d+\/\?dev$/)
  assert.equal(value.connected, false)
  assert.equal(value.share, null)
  assert.match(value.events, /\/edrys-dev\/agent\/[0-9a-f]{32}$/)
  assert.equal(value.watched, false)
})

test('a lab error reaches the agent on every path', async () => {
  const { value: state } = await tool('get_state')
  const base = new URL(state.url).origin.replace('localhost', '127.0.0.1')

  await fetch(base + '/edrys-dev/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'error', message: 'not a classroom' }),
  })
  const expected = { type: 'lab', ok: false, error: 'not a classroom' }

  // wait_for_event
  assert.deepEqual((await tool('wait_for_event', { timeout_s: 2 })).value, expected)
  // channel notification
  const channel = notifications.find((n) => n.method === 'notifications/claude/channel')
  assert.deepEqual(JSON.parse(channel.params.content), expected)
  // replayed to the first Monitor
  const controller = new AbortController()
  const stream = await fetch(state.events, { signal: controller.signal })
  const reader = stream.body.getReader()
  const { value: chunk } = await reader.read()
  controller.abort()
  assert.deepEqual(JSON.parse(new TextDecoder().decode(chunk)), expected)
})

test('the event stream refuses browsers and wrong tokens', async () => {
  const { value: state } = await tool('get_state')
  assert.equal((await fetch(state.events, { headers: { Origin: 'http://localhost' } })).status, 403)
  assert.equal((await fetch(state.events.replace(/[0-9a-f]{32}$/, '0'.repeat(32)))).status, 403)
})

test('wait_for_event times out, and tool errors come back as results', async () => {
  assert.deepEqual((await tool('wait_for_event', { timeout_s: 0 })).value, { timeout: true })
  const bad = await tool('wait_for_event', { timeout_s: -1 })
  assert.equal(bad.isError, true)
  assert.match(bad.content[0].text, /timeout_s/)
})

test('unknown methods and tools are protocol errors', async () => {
  assert.equal((await call('nope')).error.code, -32601)
  assert.equal((await call('tools/call', { name: 'nope' })).error.code, -32602)
})
