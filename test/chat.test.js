import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { Chat, validAnswer } from '../dist/chat.js'
import { readSaved } from '../dist/watch.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edrys-dev-chat-'))

after(() => fs.rmSync(dir, { recursive: true }))

// a Chat with its routes on a free port
async function serve(chat) {
  const app = express()
  chat.routes(app)
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (body) =>
    fetch(base + '/edrys-dev/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify(body),
    })
  // the first message of the panel's stream
  const history = async () => {
    const controller = new AbortController()
    const response = await fetch(base + '/edrys-dev/chat/events', { signal: controller.signal })
    const reader = response.body.getReader()
    let text = ''
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value)
    controller.abort()
    return JSON.parse(text.slice(6, text.indexOf('\n\n')))
  }
  return {
    post,
    history,
    close: () => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    },
  }
}

const INPUTS = [
  { id: 'board', type: 'radio', options: ['Uno', 'ESP32'] },
  { id: 'extras', type: 'checkbox', options: ['LED', 'Servo'] },
  { id: 'go', type: 'buttons', options: ['Yes', 'No'] },
]

test('an answer has only the ids and options of its form', () => {
  assert.ok(validAnswer(INPUTS, { board: 'Uno', extras: ['LED', 'Servo'], go: 'Yes' }))
  // nothing chosen
  assert.ok(validAnswer(INPUTS, { board: '', extras: [] }))
  assert.ok(validAnswer(INPUTS, {}))

  assert.equal(validAnswer(INPUTS, { board: 'Mega' }), null)
  assert.equal(validAnswer(INPUTS, { other: 'Uno' }), null)
  assert.equal(validAnswer(INPUTS, { extras: 'LED' }), null)
  assert.equal(validAnswer(INPUTS, { extras: ['LED', 'LED'] }), null)
  assert.equal(validAnswer(INPUTS, { go: ['Yes'] }), null)
  assert.equal(validAnswer(INPUTS, { toString: 'Uno' }), null)
  assert.equal(validAnswer(INPUTS, ['Uno']), null)
  assert.equal(validAnswer(INPUTS, null), null)
})

test('a forged answer is refused and leaves the form open', async () => {
  const chat = new Chat(path.join(dir, 'answer'))
  const panel = await serve(chat)
  const answers = []
  chat.on('answer', (entry) => answers.push(entry.values))
  try {
    const ask = chat.say('Which?', INPUTS)
    assert.equal((await panel.post({ ask, values: { board: 'rm -rf /' } })).status, 400)
    assert.equal(chat.open, ask)
    assert.equal((await panel.post({ ask, values: { board: 'ESP32' } })).status, 204)
    assert.deepEqual(answers, [{ board: 'ESP32' }])
  } finally {
    await panel.close()
    await chat.flush()
  }
})

// a chat.json of an older edrys-dev in a folder of its own
function oldChat(name, text) {
  const folder = path.join(dir, name)
  fs.mkdirSync(folder)
  fs.writeFileSync(path.join(folder, 'chat.json'), text)
  return folder
}

test('a chat.json of an older edrys-dev becomes the first saved chat', async () => {
  const folder = oldChat('old', JSON.stringify([{ t: Date.UTC(2026, 9, 1), type: 'user', text: 'Why does Execute do nothing?' }]))
  const chat = new Chat(folder)
  assert.equal(fs.existsSync(path.join(folder, 'chat.json')), false)
  assert.deepEqual(chat.entries.map((e) => e.text), ['Why does Execute do nothing?'])
  assert.match(chat.session.id, /^2026-10-01T00-00-00-[0-9a-f]{4}$/)
  assert.deepEqual(chat.list().map((s) => [s.id, s.title, s.count]), [[chat.session.id, 'Why does Execute do nothing?', 1]])
  assert.ok(fs.existsSync(path.join(folder, 'chats', chat.session.id + '.json')))

  // one that is no list of entries is left alone, the chat starts empty
  for (const [name, text] of [
    ['object', '{"entries": []}'],
    ['string', '"hello"'],
    ['broken', '[{"t": 1, '],
  ]) {
    assert.deepEqual(new Chat(oldChat(name, text)).entries, [], name)
  }
  assert.deepEqual(new Chat(oldChat('mixed', JSON.stringify([null, 3, { t: 1, type: 'user', text: 'hi' }]))).entries, [
    { t: 1, type: 'user', text: 'hi', n: 1 },
  ])
})

test('entries are numbered, also those of a chat saved without numbers', async () => {
  const folder = oldChat('numbers', JSON.stringify([{ t: 1, type: 'user', text: 'a' }, { t: 2, type: 'ai', markdown: 'b', n: 7 }, { t: 3, type: 'user', text: 'c', n: 2 }]))
  const chat = new Chat(folder)
  assert.deepEqual(chat.entries.map((e) => e.n), [1, 7, 8])
  chat.say('d')
  assert.equal(chat.entries.at(-1).n, 9)
  assert.deepEqual(chat.newerThan(1).map((e) => e.text), ['c'])
  await chat.flush()
})

test('the status line waits for the agent and says when it does not react', async () => {
  const chat = new Chat(path.join(dir, 'hints'), 0, { noReaction: 50, quiet: 100 })
  const panel = await serve(chat)
  try {
    await panel.post({ text: 'hello?' })
    let history = await panel.history()
    assert.equal(history.status, 'Waiting for the agent…')
    await new Promise((r) => setTimeout(r, 80))
    assert.match((await panel.history()).hint, /not reacted yet/)

    // the agent took it: the hint goes, later another one says it still works
    chat.activity()
    history = await panel.history()
    assert.deepEqual([history.status, history.hint], ['Thinking…', ''])
    await new Promise((r) => setTimeout(r, 130))
    assert.match((await panel.history()).hint, /still working/)

    // its answer ends both
    chat.say('Hi')
    history = await panel.history()
    assert.deepEqual([history.status, history.hint], ['', ''])
  } finally {
    await panel.close()
    await chat.flush()
  }
})

test('a burst of messages is saved once, later, and all of it on flush', async () => {
  const folder = path.join(dir, 'burst')
  const chat = new Chat(folder)
  const file = path.join(folder, 'chats', chat.session.id + '.json')
  for (let i = 0; i < 20; i++) chat.say('message ' + i)
  assert.equal(fs.existsSync(file), false)
  await chat.flush()
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).entries.length, 20)
  assert.equal(fs.existsSync(file + '.tmp'), false)
  // and it comes back
  assert.equal(new Chat(folder).entries.length, 20)
})

test('the menu starts a new chat, reopens an old one, and a restart continues the last', async () => {
  const folder = path.join(dir, 'sessions')
  const chat = new Chat(folder)
  const panel = await serve(chat)
  const events = []
  chat.on('session', (event) => events.push(event))
  try {
    // a new chat that is still empty stays the same, and has no file
    const first = chat.session.id
    assert.equal((await panel.post({ session: null })).status, 204)
    assert.equal(chat.session.id, first)
    assert.deepEqual(chat.list(), [])

    await panel.post({ text: 'Why does Execute do nothing?' })
    const ask = chat.say('Which board?', INPUTS)
    assert.equal((await panel.post({ session: null })).status, 204)
    const second = chat.session.id
    assert.notEqual(second, first)
    assert.equal(chat.open, null)
    assert.deepEqual(events.at(-1), { id: second, title: (await panel.history()).session.title, resumed: false })
    // the form stayed in the chat before
    assert.equal((await panel.post({ ask, values: { board: 'Uno' } })).status, 409)

    await panel.post({ text: 'Add a terminal' })
    let history = await panel.history()
    assert.deepEqual(history.sessions.map((s) => s.title), ['Add a terminal', 'Why does Execute do nothing?'])
    assert.equal(history.status, 'Waiting for the agent…')

    // back to the first: its entries, no status of the other
    assert.equal((await panel.post({ session: first })).status, 204)
    history = await panel.history()
    assert.equal(history.session.id, first)
    assert.deepEqual(history.entries.map((e) => e.text ?? e.markdown), ['Why does Execute do nothing?', 'Which board?'])
    assert.deepEqual([history.open, history.status], [null, ''])
    assert.deepEqual(events.at(-1), { id: first, title: 'Why does Execute do nothing?', resumed: true })
    assert.equal(chat.read(second).entries.length, 1)

    assert.equal((await panel.post({ session: 'no-such-chat' })).status, 404)
    assert.equal((await panel.post({ session: '../../lab' })).status, 404)
    assert.equal((await panel.post({ session: 3 })).status, 400)

    // a restart continues the one changed last
    await panel.post({ text: 'still the first' })
    await chat.flush()
    assert.equal(new Chat(folder).session.id, first)
  } finally {
    await panel.close()
    await chat.flush()
  }
})

test('a panel gets the newest messages that fit, and the count of the others', async () => {
  const chat = new Chat(path.join(dir, 'large'))
  const panel = await serve(chat)
  try {
    for (let i = 0; i < 30; i++) chat.say(i + 'x'.repeat(49_000))
    const { entries, skipped } = await panel.history()
    assert.ok(entries.length < 30 && entries.length > 0)
    assert.equal(skipped + entries.length, 30)
    assert.match(entries.at(-1).markdown, /^29x/)
    assert.ok(JSON.stringify(entries).length <= 1_000_000 + 1000)
  } finally {
    await panel.close()
    await chat.flush()
  }
})

test('a lab file renamed over is read once it is back; a missing one fails', async () => {
  const file = path.join(dir, 'lab.yml')
  fs.writeFileSync(file, 'name: Old\n')
  fs.rmSync(file)
  setTimeout(() => fs.writeFileSync(file, 'name: New\n'), 100)
  assert.equal(await readSaved(file), 'name: New\n')
  await assert.rejects(readSaved(path.join(dir, 'never.yml'), 100), { code: 'ENOENT' })
})
