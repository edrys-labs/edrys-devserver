import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { forgetOld } from '../dist/mcp.js'

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

function notify(method, params = {}) {
  agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

async function tool(name, args = {}, meta) {
  const { result } = await call('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) })
  return { ...result, value: result.isError ? undefined : JSON.parse(result.content[0].text) }
}

async function untilNotification(test) {
  for (let i = 0; i < 50 && !notifications.some(test); i++) await new Promise((r) => setTimeout(r, 20))
  return notifications.find(test)
}

before(async () => {
  fs.writeFileSync(lab, 'name: One\n')
  // local modules, served on the next port (3271)
  fs.mkdirSync(path.join(dir, 'modules'))
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
  notify('notifications/initialized')
  assert.equal(result.protocolVersion, '2025-11-25')
  assert.deepEqual(result.capabilities.experimental, { 'claude/channel': {} })
  assert.match(result.instructions, /get_state/)
  assert.ok(result.instructions.length <= 2048)
  assert.equal(result.serverInfo.version, JSON.parse(fs.readFileSync('package.json', 'utf8')).version)

  const { result: list } = await call('tools/list')
  assert.deepEqual(list.tools.map((t) => t.name), [
    'get_state',
    'goto',
    'chat',
    'read_chat',
    'read_messages',
    'read_module_state',
    'run_in_module',
    'wait_for_event',
  ])
  for (const t of list.tools) {
    assert.ok(t.description.length <= 2048, t.name)
    assert.equal(t.inputSchema.additionalProperties, false, t.name)
    assert.equal(t.outputSchema.type, 'object', t.name)
    assert.equal(typeof t.annotations.title, 'string', t.name)
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean', t.name)
  }
  const hints = Object.fromEntries(list.tools.map((t) => [t.name, t.annotations]))
  assert.equal(hints.get_state.readOnlyHint, true)
  assert.equal(hints.read_module_state.readOnlyHint, true)
  assert.equal(hints.goto.openWorldHint, true)
  assert.equal(hints.run_in_module.destructiveHint, true)
  assert.equal(hints.chat.destructiveHint, false)
})

test('notifications wait until the client said initialized', { timeout: 10000 }, async () => {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'edrys-dev-early-'))
  fs.writeFileSync(path.join(own, 'lab.yml'), 'name: Early\n')
  const early = spawn(process.execPath, ['dist/index.js', path.join(own, 'lab.yml'), '--mcp', '-p', '3280'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const got = []
  readline.createInterface({ input: early.stdout }).on('line', (line) => got.push(JSON.parse(line)))
  const send = (message) => early.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  try {
    await new Promise((resolve) => early.stderr.once('data', resolve))
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
    const origin = 'http://127.0.0.1:3280'
    await fetch(origin + '/edrys-dev/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ type: 'error', message: 'too early' }),
    })
    await new Promise((r) => setTimeout(r, 200))
    assert.ok(got.some((m) => m.id === 1))
    assert.equal(got.filter((m) => m.method).length, 0)

    send({ method: 'notifications/initialized' })
    for (let i = 0; i < 50 && !got.some((m) => m.method); i++) await new Promise((r) => setTimeout(r, 20))
    const channel = got.find((m) => m.method === 'notifications/claude/channel')
    assert.deepEqual(JSON.parse(channel.params.content), { type: 'lab', ok: false, error: 'too early' })
  } finally {
    early.kill()
    fs.rmSync(own, { recursive: true })
  }
})

test('results carry structuredContent, and unknown arguments are errors', async () => {
  const { result } = await call('tools/call', { name: 'get_state', arguments: {} })
  assert.deepEqual(result.structuredContent, JSON.parse(result.content[0].text))

  const typo = await tool('read_chat', { lst: 3 })
  assert.equal(typo.isError, true)
  assert.match(typo.content[0].text, /unknown argument lst; read_chat takes last/)
  const input = await tool('chat', { markdown: 'x', inputs: [{ id: 'a', type: 'radio', options: ['1'], name: 'n' }] })
  assert.match(input.content[0].text, /unknown input field name/)
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
    headers: { 'Content-Type': 'application/json', Origin: base },
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

test('events a Monitor read are not queued for wait_for_event', async () => {
  const { value: state } = await tool('get_state')
  const base = new URL(state.url).origin.replace('localhost', '127.0.0.1')
  const controller = new AbortController()
  const stream = await fetch(state.events, { signal: controller.signal })
  const reader = stream.body.getReader()
  await fetch(base + '/edrys-dev/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ type: 'applied', changed: false }),
  })
  const { value: chunk } = await reader.read()
  controller.abort()
  assert.deepEqual(JSON.parse(new TextDecoder().decode(chunk)), { type: 'lab', ok: true, changed: false })
  assert.deepEqual((await tool('wait_for_event', { timeout_s: 0 })).value, { timeout: true })
})

test('a waiting wait_for_event reports progress when asked to', async () => {
  const before = notifications.length
  const waited = await tool('wait_for_event', { timeout_s: 1 }, { progressToken: 'w1' })
  assert.deepEqual(waited.value, { timeout: true })
  const progress = notifications.slice(before).find((n) => n.method === 'notifications/progress')
  assert.deepEqual(progress.params, { progressToken: 'w1', progress: 0, total: 1, message: 'waiting for a browser event' })
})

test('wait_for_event times out, and tool errors come back as results', async () => {
  assert.deepEqual((await tool('wait_for_event', { timeout_s: 0 })).value, { timeout: true })
  const bad = await tool('wait_for_event', { timeout_s: -1 })
  assert.equal(bad.isError, true)
  assert.match(bad.content[0].text, /timeout_s/)
})

// The chat panel's side: its event stream and its posts.
async function openPanel(base) {
  const controller = new AbortController()
  const response = await fetch(base + '/edrys-dev/chat/events', { signal: controller.signal })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const messages = []
  let buffer = ''
  ;(async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += decoder.decode(value)
        let end
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          if (block.startsWith('data: ')) messages.push(JSON.parse(block.slice(6)))
        }
      }
    } catch {}
  })()
  const post = (body) =>
    fetch(base + '/edrys-dev/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify(body),
    })
  const until = async (test) => {
    for (let i = 0; i < 50 && !messages.some(test); i++) await new Promise((r) => setTimeout(r, 20))
    return messages.find(test)
  }
  return { messages, post, until, close: () => controller.abort() }
}

async function base() {
  const { value } = await tool('get_state')
  return new URL(value.url).origin
}

test('the page carries the chat panel', async () => {
  const page = await (await fetch((await base()) + '/?dev')).text()
  assert.match(page, /<script src="\/edrys-dev\/panel\.js" defer data-chat><\/script>$/)
  for (const file of ['panel.js', 'marked.js', 'purify.js']) {
    assert.equal((await fetch(`${await base()}/edrys-dev/${file}`)).status, 200, file)
  }
})

test('chat needs the panel', async () => {
  // the Monitor of an earlier test is gone by now
  await new Promise((r) => setTimeout(r, 200))
  const result = await tool('chat', { markdown: 'hi' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /chat is not open/)
})

// a form that never ends would hang the run
test('messages, forms and typed text between agent and panel', { timeout: 15000 }, async () => {
  const panel = await openPanel(await base())
  await panel.until((m) => m.type === 'history')
  assert.equal((await tool('get_state')).value.chat, true)

  // a plain message
  assert.deepEqual((await tool('chat', { markdown: '**Hello**' })).value, { sent: true })
  assert.ok(await panel.until((m) => m.type === 'entry' && m.entry.markdown === '**Hello**'))

  // a form blocks until the panel answers
  const pending = tool('chat', {
    markdown: 'Which board?',
    inputs: [{ id: 'board', type: 'buttons', options: ['Uno', 'ESP32'] }],
  })
  const form = await panel.until((m) => m.type === 'entry' && m.entry.ask)
  assert.equal((await panel.post({ ask: form.entry.ask, values: { board: 'ESP32' } })).status, 204)
  assert.deepEqual((await pending).value, { ask: form.entry.ask, values: { board: 'ESP32' } })
  // answered: the form is gone
  assert.equal((await panel.post({ ask: form.entry.ask, values: { board: 'Uno' } })).status, 409)

  // typing instead of answering dismisses the call; the form stays open
  const second = tool('chat', {
    markdown: 'Ready?',
    inputs: [{ id: 'go', type: 'buttons', options: ['Yes'] }],
  })
  const secondForm = await panel.until((m) => m.type === 'entry' && m.entry.markdown === 'Ready?')
  await panel.post({ text: 'wait a moment' })
  assert.deepEqual((await second).value, { ask: secondForm.entry.ask, dismissed: true, text: 'wait a moment' })
  // its late answer is an event
  await panel.post({ ask: secondForm.entry.ask, values: { go: 'Yes' } })
  assert.deepEqual((await tool('wait_for_event', { timeout_s: 2 })).value, {
    type: 'answer',
    ask: secondForm.entry.ask,
    values: { go: 'Yes' },
  })

  // typed text without a form is a chat event
  await panel.post({ text: 'Why does Execute do nothing?' })
  assert.deepEqual((await tool('wait_for_event', { timeout_s: 2 })).value, {
    type: 'chat',
    text: 'Why does Execute do nothing?',
  })

  // status only
  await tool('chat', { status: 'Reading the module docs' })
  assert.ok(await panel.until((m) => m.type === 'status' && m.text === 'Reading the module docs'))

  // a new form closes the one before
  const third = tool('chat', { markdown: 'A?', inputs: [{ id: 'a', type: 'buttons', options: ['1'] }] })
  const thirdForm = await panel.until((m) => m.type === 'entry' && m.entry.markdown === 'A?')
  const fourth = tool('chat', { markdown: 'B?', inputs: [{ id: 'b', type: 'buttons', options: ['2'] }] })
  assert.deepEqual((await third).value, { ask: thirdForm.entry.ask, superseded: true })
  assert.ok(await panel.until((m) => m.type === 'close' && m.ask === thirdForm.entry.ask))

  // so does one that does not wait
  const fourthForm = await panel.until((m) => m.type === 'entry' && m.entry.markdown === 'B?')
  const fifth = await tool('chat', { markdown: 'C?', inputs: [{ id: 'c', type: 'buttons', options: ['3'] }], wait: false })
  assert.equal(fifth.value.sent, true)
  assert.deepEqual((await fourth).value, { ask: fourthForm.entry.ask, superseded: true })

  // a reload of the class tab keeps a waiting form
  const sixth = tool('chat', { markdown: 'D?', inputs: [{ id: 'd', type: 'buttons', options: ['4'] }] })
  let ended = false
  sixth.then(() => (ended = true))
  await panel.until((m) => m.type === 'entry' && m.entry.markdown === 'D?')
  panel.close()
  const reloaded = await openPanel(await base())
  await reloaded.until((m) => m.type === 'history')
  await new Promise((r) => setTimeout(r, 2200))
  assert.equal((await tool('get_state')).value.chat, true)
  assert.equal(ended, false)

  // the panel closes for good while a form waits: it ends after a moment
  reloaded.close()
  await new Promise((r) => setTimeout(r, 500))
  assert.equal(ended, false)
  assert.equal((await sixth).value.disconnected, true)
})

test('read_chat returns what the panel shows, saved next to the lab', async () => {
  const { value } = await tool('read_chat', { last: 3 })
  assert.equal(value.entries.length, 3)
  assert.ok(value.skipped > 0)
  assert.deepEqual(value.entries.at(-1).markdown, 'D?')

  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.edrys-dev', 'chat.json'), 'utf8'))
  assert.deepEqual(saved.slice(-3), value.entries)
})

test('a form waits at most timeout_s, with progress; a later answer is an event', { timeout: 10000 }, async () => {
  const panel = await openPanel(await base())
  await panel.until((m) => m.type === 'history')

  const before = notifications.length
  const pending = tool(
    'chat',
    { markdown: 'Late?', inputs: [{ id: 'l', type: 'buttons', options: ['Yes'] }], timeout_s: 1 },
    { progressToken: 7 }
  )
  const form = await panel.until((m) => m.type === 'entry' && m.entry.markdown === 'Late?')
  const progress = await untilNotification((n, i) => i >= before && n.method === 'notifications/progress')
  assert.deepEqual(progress.params, { progressToken: 7, progress: 0, total: 1, message: "waiting for the user's answer" })
  assert.deepEqual((await pending).value, { ask: form.entry.ask, timeout: true })

  // the form stays open
  assert.equal((await panel.post({ ask: form.entry.ask, values: { l: 'Yes' } })).status, 204)
  assert.deepEqual((await tool('wait_for_event', { timeout_s: 2 })).value, {
    type: 'answer',
    ask: form.entry.ask,
    values: { l: 'Yes' },
  })
  panel.close()
})

// a POST with headers fetch would not let through as they are (Host)
function rawPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } })
    request.on('response', (response) => resolve(response.statusCode))
    request.on('error', reject)
    request.end(body)
  })
}

test('the chat takes posts from its own page only, not from other sites or programs', async () => {
  const url = (await base()) + '/edrys-dev/chat'
  const port = new URL(url).port
  const body = JSON.stringify({ text: 'forged' })
  const before = notifications.length

  // a module's own site
  assert.equal(await rawPost(url, { Origin: 'https://some-module.example' }, body), 403)
  // another program, or another user of this machine
  assert.equal(await rawPost(url, {}, body), 403)
  // a site that rebinds its domain to 127.0.0.1: Host and Origin agree
  const evil = `evil.example:${port}`
  assert.equal(await rawPost(url, { Host: evil, Origin: `http://${evil}` }, body), 403)
  // nor may it read the chat or the lab
  assert.equal(await new Promise((resolve) => http.get(url + '/events', { headers: { Host: evil } }, (r) => resolve(r.statusCode))), 403)

  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(notifications.slice(before).filter((n) => n.params?.content?.includes('forged')).length, 0)
  assert.ok(!(await tool('read_chat')).value.entries.some((e) => e.text === 'forged'))
})

// The class tab's side: its command stream and its reports.
async function openClassTab(origin) {
  const controller = new AbortController()
  const response = await fetch(origin + '/edrys-dev/events', { signal: controller.signal })
  const reader = response.body.getReader()
  const commands = []
  ;(async () => {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += decoder.decode(value)
        let end
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const event = block.match(/^event: (.+)$/m)?.[1]
          const data = block.match(/^data: (.+)$/m)?.[1]
          if (event) commands.push({ event, data: JSON.parse(data) })
        }
      }
    } catch {}
  })()
  const report = (body) =>
    fetch(origin + '/edrys-dev/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    })
  return { commands, report, close: () => controller.abort() }
}

const classIn = (room, extra = {}) => ({
  type: 'class',
  room,
  rooms: { Lobby: [], 'Room 1': [], ...extra, [room]: [{ name: 'owner', role: 'teacher', me: true }] },
  modules: ['Terminal'],
})

test('lab confirmations and the class reach the agent', async () => {
  const tab = await openClassTab(await base())
  await tab.report({ type: 'applied', changed: true })
  assert.deepEqual((await tool('wait_for_event', { timeout_s: 2 })).value, { type: 'lab', ok: true, changed: true })

  await tab.report(classIn('Lobby'))
  const { value } = await tool('get_state')
  assert.equal(value.connected, true)
  assert.deepEqual(value.class, { room: 'Lobby', rooms: classIn('Lobby').rooms, modules: ['Terminal'] })
  tab.close()
})

test('goto room moves the class tab and waits for it', async () => {
  const tab = await openClassTab(await base())
  await tab.report(classIn('Lobby'))

  const moved = tool('goto', { room: 'Room 1' })
  for (let i = 0; i < 50 && !tab.commands.some((c) => c.event === 'goto'); i++) await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(tab.commands.find((c) => c.event === 'goto').data, { room: 'Room 1' })
  await tab.report(classIn('Room 1'))
  assert.equal((await moved).value.room, 'Room 1')

  const unknown = await tool('goto', { room: 'Room 9' })
  assert.equal(unknown.isError, true)
  assert.match(unknown.content[0].text, /no room Room 9; rooms: Lobby, Room 1/)
  tab.close()
})

test('read_module_state asks the class tab and returns its reply', async () => {
  const tab = await openClassTab(await base())
  await tab.report(classIn('Lobby'))

  // the tab's own room unless one is named
  const asked = (event) =>
    (async () => {
      for (let i = 0; i < 50; i++) {
        const command = tab.commands.find((c) => c.event === event && !c.answered)
        if (command) return Object.assign(command, { answered: true })
        await new Promise((r) => setTimeout(r, 20))
      }
    })()

  const own = tool('read_module_state')
  const first = await asked('read-state')
  assert.equal(first.data.room, 'Lobby')
  await tab.report({ type: 'reply', id: first.data.id, value: { room: 'Lobby', state: { code: 'print(1)' } } })
  assert.deepEqual((await own).value, { room: 'Lobby', state: { code: 'print(1)' } })

  const missing = tool('read_module_state', { room: 'Room 1', key: 'nope' })
  const second = await asked('read-state')
  assert.deepEqual({ ...second.data, id: undefined }, { id: undefined, room: 'Room 1', key: 'nope' })
  await tab.report({ type: 'reply', id: second.data.id, error: 'no key nope in Room 1; keys: code' })
  const failed = await missing
  assert.equal(failed.isError, true)
  assert.match(failed.content[0].text, /no key nope/)

  const unknown = await tool('read_module_state', { room: 'Room 9' })
  assert.match(unknown.content[0].text, /no room Room 9; rooms: Lobby, Room 1/)
  tab.close()
})

test('run_in_module runs code in a local module of the class tab', async () => {
  const tab = await openClassTab(await base())
  await tab.report({
    ...classIn('Lobby'),
    modules: [
      { name: 'Term', url: 'http://127.0.0.1:3271/term/' },
      { name: 'Markdown', url: 'https://edrys-labs.github.io/module-markdown-it/index.html' },
    ],
  })

  const ran = tool('run_in_module', { module: 'Term', code: 'document.title' })
  let command
  for (let i = 0; i < 50 && !(command = tab.commands.find((c) => c.event === 'run-module')); i++) {
    await new Promise((r) => setTimeout(r, 20))
  }
  assert.deepEqual({ ...command.data, id: undefined }, {
    id: undefined,
    url: 'http://127.0.0.1:3271/term/',
    code: 'document.title',
    ms: 10000,
  })
  await tab.report({ type: 'reply', id: command.data.id, value: [{ value: '"Term"' }] })
  assert.deepEqual((await ran).value, { room: 'Lobby', results: [{ value: '"Term"' }] })

  const published = await tool('run_in_module', { module: 'markdown', code: '1' })
  assert.match(published.content[0].text, /is not a local module/)
  const none = await tool('run_in_module', { module: 'Clock', code: '1' })
  assert.match(none.content[0].text, /no module matches Clock; modules: Term/)
  assert.equal((await tool('run_in_module', { module: 'Term', code: '1', timeout_s: 0 })).isError, true)
  tab.close()
})

test('goto as student gives a link from the other local address, as station the owner\'s', async () => {
  const origin = await base()
  const tab = await openClassTab(origin)
  await tab.report({ type: 'open', url: `${origin}/?/classroom/abc/hash#comm=xyz` })

  const student = (await tool('goto', { as: 'student', open: false })).value
  assert.deepEqual(student, {
    url: `${origin.replace('localhost', '127.0.0.1')}/?/classroom/abc/hash#comm=xyz`,
    opened: false,
    joined: false,
  })
  const station = (await tool('goto', { as: 'station', open: false })).value
  // the owner runs the station: same address, same key
  assert.equal(station.url, `${origin}/?/station/abc/hash#comm=xyz`)

  assert.equal((await tool('goto', {})).isError, true)
  assert.equal((await tool('goto', { as: 'teacher' })).isError, true)
  tab.close()
})

test('a module that could not be loaded is an event, once', async () => {
  const tab = await openClassTab(await base())
  const broken = (extra = []) => ({
    ...classIn('Lobby'),
    modules: [{ name: 'gone', url: 'https://gone.example/m.html', error: 'TypeError: Failed to fetch' }, ...extra],
  })
  await tab.report(broken())
  await tab.report(broken([{ name: 'Editor', url: 'https://e' }]))

  assert.deepEqual((await tool('wait_for_event', { timeout_s: 2 })).value, {
    type: 'module',
    module: 'https://gone.example/m.html',
    load: true,
    error: 'TypeError: Failed to fetch',
  })
  assert.deepEqual((await tool('wait_for_event', { timeout_s: 0 })).value, { timeout: true })
  tab.close()
})

test('read_messages filters what the modules did', async () => {
  const origin = await base()
  await fetch(origin + '/edrys-dev/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      type: 'messages',
      messages: [
        { t: 1, subject: 'execute', body: '"ls"', module: 'http://localhost:3271/term/index.html', from: 'owner' },
        { t: 2, subject: 'stdout', body: '"lab.yml"', module: 'http://localhost:3271/term/index.html', from: 'Station x' },
        { t: 3, subject: 'code', body: '"x"', module: 'https://editor.example/index.html', from: 'owner' },
      ],
      dropped: 0,
    }),
  })

  const all = (await tool('read_messages')).value
  assert.equal(all.entries.length, 3)
  assert.deepEqual(
    (await tool('read_messages', { module: 'term' })).value.entries.map((e) => e.subject),
    ['execute', 'stdout']
  )
  assert.deepEqual((await tool('read_messages', { subject: 'code' })).value.entries.map((e) => e.t), [3])
  const newest = (await tool('read_messages', { last: 1 })).value
  assert.deepEqual([newest.skipped, newest.entries[0].t], [2, 3])
  assert.deepEqual((await tool('read_messages', { errors: true })).value.entries, [])
})

test('the same module error counts once in 10 s, another one at once', async () => {
  fs.mkdirSync(path.join(dir, 'modules', 'err'))
  fs.writeFileSync(path.join(dir, 'modules', 'err', 'index.html'), '<html><head></head><body>err</body></html>')
  const html = await (await fetch('http://127.0.0.1:3271/err/')).text()
  const reportUrl = html.match(/fetch\("([^"]+)"/)[1]
  const error = (message) =>
    fetch(reportUrl, {
      method: 'POST',
      headers: { Origin: 'null' },
      body: JSON.stringify({ module: 'err', kind: 'error', message }),
    })

  await error('TypeError: a')
  await error('TypeError: a')
  await error('TypeError: b')

  const events = [
    (await tool('wait_for_event', { timeout_s: 2 })).value,
    (await tool('wait_for_event', { timeout_s: 2 })).value,
    (await tool('wait_for_event', { timeout_s: 0 })).value,
  ]
  assert.deepEqual(events, [
    { type: 'module', module: 'err', error: 'TypeError: a' },
    { type: 'module', module: 'err', error: 'TypeError: b' },
    { timeout: true },
  ])
})

test('forgetOld drops what is too old, then the oldest beyond the limit', () => {
  const list = [{ t: 1 }, { t: 2 }, { t: 3 }, { t: 4 }, { t: 5 }]
  forgetOld(list, 1, 10)
  assert.deepEqual(list, [{ t: 2 }, { t: 3 }, { t: 4 }, { t: 5 }])
  forgetOld(list, 0, 2)
  assert.deepEqual(list, [{ t: 4 }, { t: 5 }])
  forgetOld(list, 9, 10)
  assert.deepEqual(list, [])
})

test('unknown methods and tools are protocol errors', async () => {
  assert.equal((await call('nope')).error.code, -32601)
  assert.equal((await call('tools/call', { name: 'nope' })).error.code, -32602)
})
