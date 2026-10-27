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
  const chat = new Chat(path.join(dir, 'answer', 'chat.json'))
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

test('a chat.json that is no list of entries starts an empty chat', () => {
  for (const [name, text] of [
    ['object', '{"entries": []}'],
    ['string', '"hello"'],
    ['broken', '[{"t": 1, '],
  ]) {
    const file = path.join(dir, name, 'chat.json')
    fs.mkdirSync(path.dirname(file))
    fs.writeFileSync(file, text)
    assert.deepEqual(new Chat(file).entries, [], name)
  }
  const file = path.join(dir, 'mixed', 'chat.json')
  fs.mkdirSync(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify([null, 3, { t: 1, type: 'user', text: 'hi' }]))
  assert.deepEqual(new Chat(file).entries, [{ t: 1, type: 'user', text: 'hi', n: 1 }])
})

test('entries are numbered, also those of a chat saved without numbers', async () => {
  const file = path.join(dir, 'numbers', 'chat.json')
  fs.mkdirSync(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify([{ t: 1, type: 'user', text: 'a' }, { t: 2, type: 'ai', markdown: 'b', n: 7 }, { t: 3, type: 'user', text: 'c', n: 2 }]))
  const chat = new Chat(file)
  assert.deepEqual(chat.entries.map((e) => e.n), [1, 7, 8])
  chat.say('d')
  assert.equal(chat.entries.at(-1).n, 9)
  assert.deepEqual(chat.newerThan(1).map((e) => e.text), ['c'])
  await chat.flush()
})

test('the status line waits for the agent and says when it does not react', async () => {
  const chat = new Chat(path.join(dir, 'hints', 'chat.json'), 0, { noReaction: 50, quiet: 100 })
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
  const file = path.join(dir, 'burst', 'chat.json')
  const chat = new Chat(file)
  for (let i = 0; i < 20; i++) chat.say('message ' + i)
  assert.equal(fs.existsSync(file), false)
  await chat.flush()
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 20)
  assert.equal(fs.existsSync(file + '.tmp'), false)
  // and it comes back
  assert.equal(new Chat(file).entries.length, 20)
})

test('a panel gets the newest messages that fit, and the count of the others', async () => {
  const chat = new Chat(path.join(dir, 'large', 'chat.json'))
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
