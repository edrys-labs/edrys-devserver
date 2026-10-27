import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { sameOrigin } from './origin.js'

export type Input = {
  id: string
  type: 'buttons' | 'radio' | 'checkbox'
  label?: string
  options: string[]
}

// n numbers the entries from 1 and stays when old ones are dropped
export type Entry = { t: number; n: number } & (
  | { type: 'ai'; markdown: string; ask?: string; inputs?: Input[] }
  | { type: 'user'; text: string }
  | { type: 'answer'; ask: string; values: Record<string, string | string[]> }
)

// what the saved chat keeps, oldest first out
const MAX_ENTRIES = 500

// what a panel gets on (re)load, in characters of JSON: 500 long messages
// could be 25 MB; read_chat has the rest
const HISTORY_MAX = 1_000_000

// a burst of messages is saved once
const SAVE_MS = 300

// The progress line says what the server knows: the message waits until an
// agent takes it (Chat.activity()), and after a while without any sign of the
// agent a hint below says so. As in LiaScript DevServer (src/lib.ts there).
export const WAITING = 'Waiting for the agent…'
export const THINKING = 'Thinking…'
// the server cannot know whether an idle agent listens (a channel wakes it)
const NO_REACTION = 'The agent has not reacted yet, maybe it is not connected. Your message is saved, it answers once it starts.'
const QUIET = 'The agent is still working, this can take a while.'
const HINT_MS = { noReaction: 30_000, quiet: 60_000 }

/**
 * `values` if they answer `inputs`: only their ids, each with one of its
 * options, a checkbox with a list of them. A radio or buttons input left
 * empty is '' or missing.
 */
export function validAnswer(inputs: Input[], values: any): Record<string, string | string[]> | null {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  for (const [id, value] of Object.entries<any>(values)) {
    const input = inputs.find((i) => i.id === id)
    if (!input) return null
    if (input.type === 'checkbox') {
      if (!Array.isArray(value) || new Set(value).size !== value.length) return null
      if (!value.every((v) => input.options.includes(v))) return null
    } else if (value !== '' && !input.options.includes(value)) return null
  }
  return values
}

/**
 * The agent chat over the class tab: its history, saved next to the lab in
 * .edrys-dev/chat.json, and the panel's endpoints. Not the class's own
 * (signed) chat: only the author and the agent see it.
 *
 * Emits `user` (entry) when the user typed, `answer` (entry) when they
 * answered a form, and `connection` (boolean) when the panel came, or was
 * gone for `settleMs`: a reload of the class tab is no going.
 */
export class Chat extends EventEmitter {
  entries: Entry[] = []
  /** The one form the user can still answer. Forms of earlier runs are closed. */
  open: string | null = null
  /** The inputs of the open form. */
  private form: Input[] = []
  private status = ''
  private hint = ''
  // a message of the user waits for the first sign of an agent
  private pending = false
  private quiet: NodeJS.Timeout | undefined
  private next = 1
  private panels = new Set<express.Response>()
  private reported = false
  private settling: NodeJS.Timeout | undefined
  private saveTimer: NodeJS.Timeout | undefined
  // one write after the other, never two at once into the same file
  private saving = Promise.resolve()

  constructor(private file: string, private settleMs = 0, private hintMs = HINT_MS) {
    super()
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      // a file edited by hand, or of another tool
      if (Array.isArray(saved)) {
        this.entries = saved.filter((e) => e && typeof e === 'object' && typeof e.type === 'string').slice(-MAX_ENTRIES)
      }
    } catch {}
    // numbers that go up, also in a chat of an older edrys-dev without them
    for (const entry of this.entries) {
      if (!Number.isInteger(entry.n) || entry.n < this.next) entry.n = this.next
      this.next = entry.n + 1
    }
  }

  /** Whether a panel is open, or was until less than `settleMs` ago; what it missed comes with the history. */
  get connected() {
    return this.reported
  }

  /** Posts a message; returns the id of its form if it has inputs. */
  say(markdown: string, inputs: Input[] = [], status?: string): string | undefined {
    const ask = inputs.length ? 'ask-' + crypto.randomBytes(4).toString('hex') : undefined
    const entry: Entry = { t: Date.now(), n: this.next++, type: 'ai', markdown, ...(ask ? { ask, inputs } : {}) }
    // only the newest form stays open
    if (ask) {
      this.closeForm()
      this.open = ask
      this.form = inputs
    }
    this.add(entry)
    this.setStatus(status ?? '')
    return ask
  }

  setStatus(status: string) {
    this.status = status
    this.send({ type: 'status', text: status })
    this.watchQuiet()
  }

  /**
   * A sign of the agent: a tool call, or an event handed to it. A message
   * that waited for it is now being worked on.
   */
  activity() {
    this.pending = false
    if (this.status === WAITING) this.setStatus(THINKING)
    else this.watchQuiet()
  }

  /** The entries of the user (typed or answered) after entry `n`. */
  newerThan(n: number): Entry[] {
    return this.entries.filter((e) => e.n > n && e.type !== 'ai')
  }

  /** Withdraws the open form; returns its id, or null if there was none. */
  closeForm(reason?: string): string | null {
    const closed = this.open
    this.open = null
    if (closed) this.send({ type: 'close', ask: closed, ...(reason ? { reason } : {}) })
    return closed
  }

  // restarts the clock whenever something happens while a progress line shows
  private watchQuiet() {
    clearTimeout(this.quiet)
    if (this.hint) this.send({ type: 'hint', text: (this.hint = '') })
    if (!this.status) return
    this.quiet = setTimeout(
      () => this.send({ type: 'hint', text: (this.hint = this.pending ? NO_REACTION : QUIET) }),
      this.pending ? this.hintMs.noReaction : this.hintMs.quiet
    )
    // a pending hint must not keep a stopped edrys-dev alive
    this.quiet.unref()
  }

  // the user sees at once that the message arrived, until the agent takes it
  private waitForAgent() {
    this.pending = true
    this.setStatus(WAITING)
  }

  routes(app: express.Express) {
    app.get('/edrys-dev/chat/events', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      // a reload shows the chat again, with the open form and status
      const entries = this.recent()
      const skipped = this.entries.length - entries.length
      const history = { type: 'history', entries, skipped, open: this.open, status: this.status, hint: this.hint }
      res.write(`data: ${JSON.stringify(history)}\n\n`)
      this.panels.add(res)
      clearTimeout(this.settling)
      if (!this.reported) this.emit('connection', (this.reported = true))
      req.on('close', () => {
        this.panels.delete(res)
        if (this.panels.size) return
        clearTimeout(this.settling)
        this.settling = setTimeout(() => {
          if (!this.panels.size && this.reported) this.emit('connection', (this.reported = false))
        }, this.settleMs)
      })
    })

    app.post('/edrys-dev/chat', express.json(), (req, res) => {
      if (!sameOrigin(req)) return res.sendStatus(403)
      const { text, ask, values } = req.body ?? {}

      if (typeof text === 'string' && text.trim()) {
        const entry: Entry = { t: Date.now(), n: this.next++, type: 'user', text: text.slice(0, 10000) }
        this.add(entry)
        this.waitForAgent()
        this.emit('user', entry)
        return res.sendStatus(204)
      }
      if (typeof ask === 'string' && ask === this.open) {
        // the agent gets what its form offered, or nothing
        const answer = validAnswer(this.form, values)
        if (!answer) return res.sendStatus(400)
        this.open = null
        const entry: Entry = { t: Date.now(), n: this.next++, type: 'answer', ask, values: answer }
        this.add(entry)
        this.waitForAgent()
        this.emit('answer', entry)
        return res.sendStatus(204)
      }
      // e.g. a form that was closed in the meantime
      res.sendStatus(409)
    })
  }

  private add(entry: Entry) {
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    this.send({ type: 'entry', entry })
    this.save()
  }

  private send(message: object) {
    for (const panel of this.panels) panel.write(`data: ${JSON.stringify(message)}\n\n`)
  }

  /** The newest entries that fit into HISTORY_MAX, at least the last one. */
  private recent(): Entry[] {
    let start = this.entries.length
    let size = 0
    while (start > 0) {
      size += JSON.stringify(this.entries[start - 1]).length
      if (size > HISTORY_MAX && start < this.entries.length) break
      start--
    }
    return this.entries.slice(start)
  }

  private save() {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = undefined
      this.saving = this.saving.then(() => this.write())
    }, SAVE_MS)
  }

  /** Writes what is not saved yet, e.g. before edrys-dev exits. */
  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
      this.saving = this.saving.then(() => this.write())
    }
    await this.saving
  }

  // a copy renamed over the file: a crash midway leaves the old chat, not half a one
  private async write() {
    try {
      await fsp.mkdir(path.dirname(this.file), { recursive: true })
      await fsp.writeFile(this.file + '.tmp', JSON.stringify(this.entries))
      await fsp.rename(this.file + '.tmp', this.file)
    } catch (error: any) {
      console.error('edrys-dev: could not save the chat:', error.message)
    }
  }
}

const require = createRequire(import.meta.url)
const views = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'views')

// browser builds that set window.marked and window.DOMPurify
const PANEL_FILES: Record<string, () => string> = {
  'panel.js': () => path.join(views, 'panel.js'),
  'marked.js': () => path.join(path.dirname(require.resolve('marked/package.json')), 'lib', 'marked.umd.js'),
  'purify.js': () => require.resolve('dompurify/purify.min.js'),
}

/** Serves panel.js and the libraries its chat uses. */
export function panelFiles(app: express.Express) {
  for (const [file, source] of Object.entries(PANEL_FILES)) {
    // dotfiles: sendFile checks the whole absolute path, and installs often
    // live under one (~/.nvm, ~/.npm/_npx); the path is ours, not the request's
    app.get('/edrys-dev/' + file, (req, res) => res.sendFile(source(), { dotfiles: 'allow' }))
  }
}

/**
 * The script tag that brings panel.js into the edrys-Lite page: it reloads
 * student and station tabs when a local module changed, and with `chat` (an
 * agent is connected) shows the chat in the class tab.
 */
export function panelScript(chat: boolean): string {
  return `<script src="/edrys-dev/panel.js" defer${chat ? ' data-chat' : ''}></script>`
}
