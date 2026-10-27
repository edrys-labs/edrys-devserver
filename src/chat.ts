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

/** One chat: the menu of the panel switches between them. */
export type Session = { id: string; created: number; entries: Entry[] }
/** What the menu shows of a saved chat. */
export type Summary = { id: string; title: string; updated: number; count: number }

// what a saved chat keeps, oldest first out
const MAX_ENTRIES = 500

// ids become file names
const ID = /^[\w-]{1,64}$/

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

/** Why the class cannot load the lab file, for someone who never saw YAML; detail is the class tab's message. */
export type LabProblem = { text: string; detail: string }

const STILL = 'The class still shows the last version that worked. Ask the agent here to fix it.'

/** A LabProblem from the message of edrys-Lite's DevBridge (fetchLab there). */
export function explain(message: string): LabProblem {
  // js-yaml names line and column: "could not parse <path>: <what> (4:4)\n\n<snippet>"
  const line = /^could not parse .*?: .*? \((\d+):\d+\)/.exec(message)?.[1]
  const text = line
    ? `There is a typing mistake in the lab file, around line ${line}.`
    : message.startsWith('not a classroom')
      ? 'The lab file is not a lab that edrys can read.'
      : 'The class could not load the lab file.'
  return { text: `${text} ${STILL}`, detail: message.slice(0, 2000) }
}

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

// UTC time and a random part: sorted by time, and no clash between two runs
function newId(t = Date.now()) {
  return new Date(t).toISOString().slice(0, 19).replace(/:/g, '-') + '-' + crypto.randomBytes(2).toString('hex')
}

/**
 * The entries of a saved list, numbered upwards also if an older edrys-dev
 * saved them without numbers; [] for a file edited by hand or of another tool.
 */
function readEntries(list: unknown): Entry[] {
  if (!Array.isArray(list)) return []
  const entries = list.filter((e) => e && typeof e === 'object' && typeof e.type === 'string').slice(-MAX_ENTRIES)
  let next = 1
  for (const entry of entries) {
    if (!Number.isInteger(entry.n) || entry.n < next) entry.n = next
    next = entry.n + 1
  }
  return entries
}

/** The first message of the user, else the first line of the agent, else the date. */
export function title(session: Session): string {
  const user = session.entries.find((e) => e.type === 'user')
  const ai = session.entries.find((e) => e.type === 'ai')
  let text = user?.type === 'user' ? user.text : ''
  if (!text && ai?.type === 'ai') {
    text = ai.markdown.split('\n').map((line) => line.replace(/[#*_`>]/g, '').trim()).find(Boolean) ?? ''
  }
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return new Date(session.created).toISOString().slice(0, 16).replace('T', ' ')
  return text.length > 60 ? text.slice(0, 59) + '…' : text
}

function summary(session: Session): Summary {
  return {
    id: session.id,
    title: title(session),
    updated: session.entries.at(-1)?.t ?? session.created,
    count: session.entries.length,
  }
}

/**
 * The agent chat over the class tab: its chats, saved next to the lab in
 * .edrys-dev/chats/<id>.json, and the panel's endpoints. Not the class's own
 * (signed) chat: only the author and the agent see it. It continues the chat
 * that changed last; a new one gets its file with its first entry.
 *
 * Emits `user` (entry) when the user typed, `answer` (entry) when they
 * answered a form, `session` ({id, title, resumed}) when they opened another
 * chat, and `connection` (boolean) when the panel came, or was gone for
 * `settleMs`: a reload of the class tab is no going.
 */
export class Chat extends EventEmitter {
  /** The chat the panel shows. */
  session: Session
  /** The one form the user can still answer. Forms of earlier runs are closed. */
  open: string | null = null
  /** The inputs of the open form. */
  private form: Input[] = []
  private status = ''
  private hint = ''
  private lab: LabProblem | null = null
  // a message of the user waits for the first sign of an agent
  private pending = false
  private quiet: NodeJS.Timeout | undefined
  private next = 1
  private panels = new Set<express.Response>()
  private reported = false
  private settling: NodeJS.Timeout | undefined
  private saveTimer: NodeJS.Timeout | undefined
  // chats with entries not saved yet
  private dirty = new Set<Session>()
  // one write after the other, never two at once into the same file
  private saving = Promise.resolve()
  private dir: string
  // the saved chats, for the menu
  private summaries = new Map<string, Summary>()
  // the chats read in this run: a file may still lag behind them
  private loaded = new Map<string, Session>()

  /** `folder` is .edrys-dev next to the lab. */
  constructor(folder: string, private settleMs = 0, private hintMs = HINT_MS) {
    super()
    this.dir = path.join(folder, 'chats')
    this.migrate(path.join(folder, 'chat.json'))
    let names: string[] = []
    try {
      names = fs.readdirSync(this.dir)
    } catch {}
    for (const name of names) {
      const session = name.endsWith('.json') && this.load(name.slice(0, -5))
      if (session) this.summaries.set(session.id, summary(session))
    }
    const latest = this.list()[0]
    this.session = (latest && this.load(latest.id)) || { id: newId(), created: Date.now(), entries: [] }
    this.next = (this.session.entries.at(-1)?.n ?? 0) + 1
  }

  /** The entries of the chat the panel shows. */
  get entries(): Entry[] {
    return this.session.entries
  }

  /** The saved chats, the one changed last first. */
  list(): Summary[] {
    return [...this.summaries.values()].sort((a, b) => b.updated - a.updated)
  }

  /** The chat `id`, the current one without; undefined if there is none. */
  read(id?: string): Session | undefined {
    return id === undefined || id === this.session.id ? this.session : this.load(id)
  }

  /**
   * Shows the saved chat `id`, or with null a new one (unless the current one
   * is new still). False if there is no such chat.
   */
  switchTo(id: string | null): boolean {
    let next: Session | undefined
    if (id === null) {
      if (!this.session.entries.length) return true
      next = { id: newId(), created: Date.now(), entries: [] }
    } else {
      if (id === this.session.id) return true
      next = this.summaries.has(id) ? this.load(id) : undefined
      if (!next) return false
    }
    // the forms and the progress line belong to the chat before
    this.open = null
    this.form = []
    this.pending = false
    this.status = this.hint = ''
    clearTimeout(this.quiet)
    this.session = next
    this.next = (next.entries.at(-1)?.n ?? 0) + 1
    const history = `data: ${JSON.stringify(this.history())}\n\n`
    for (const panel of this.panels) panel.write(history)
    this.emit('session', { id: next.id, title: title(next), resumed: next.entries.length > 0 })
    return true
  }

  // the chat.json of an older edrys-dev becomes the first saved chat
  private migrate(file: string) {
    try {
      const entries = readEntries(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (!entries.length) return
      const session = { id: newId(entries[0].t), created: entries[0].t, entries }
      fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(path.join(this.dir, session.id + '.json'), JSON.stringify(session))
      fs.rmSync(file)
    } catch {}
  }

  private load(id: string): Session | undefined {
    if (!ID.test(id)) return undefined
    const known = this.loaded.get(id)
    if (known) return known
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(this.dir, id + '.json'), 'utf8'))
      if (saved?.id !== id || !Array.isArray(saved.entries)) return undefined
      const entries = readEntries(saved.entries)
      const created = Number.isFinite(saved.created) ? saved.created : entries[0]?.t ?? 0
      const session = { id, created, entries }
      this.loaded.set(id, session)
      return session
    } catch {
      return undefined
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

  /** The lab file does not load (a problem), or loads again (null): the panel shows it until then. */
  labProblem(problem: LabProblem | null) {
    if (JSON.stringify(problem) === JSON.stringify(this.lab)) return
    this.lab = problem
    this.send({ type: 'lab', problem })
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
      res.write(`data: ${JSON.stringify(this.history())}\n\n`)
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

      // the menu: another saved chat, or null for a new one
      if (req.body && Object.hasOwn(req.body, 'session')) {
        const { session } = req.body
        if (session !== null && typeof session !== 'string') return res.sendStatus(400)
        return res.sendStatus(this.switchTo(session) ? 204 : 404)
      }

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
    const session = this.session
    session.entries.push(entry)
    if (session.entries.length > MAX_ENTRIES) session.entries.splice(0, session.entries.length - MAX_ENTRIES)
    this.loaded.set(session.id, session)
    this.send({ type: 'entry', entry })
    // the menu changes with a new chat's first entry, or its first message of the user
    const before = this.summaries.get(session.id)?.title
    this.summaries.set(session.id, summary(session))
    if (this.summaries.get(session.id)!.title !== before) this.send({ type: 'sessions', sessions: this.list() })
    this.save()
  }

  // what a panel gets first, and after a switch
  private history() {
    const entries = this.recent()
    return {
      type: 'history',
      session: { id: this.session.id, title: title(this.session) },
      sessions: this.list(),
      entries,
      skipped: this.entries.length - entries.length,
      open: this.open,
      status: this.status,
      hint: this.hint,
      lab: this.lab,
    }
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
    this.dirty.add(this.session)
    this.saveTimer ??= setTimeout(() => this.writeDirty(), SAVE_MS)
  }

  private writeDirty() {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    const sessions = [...this.dirty]
    this.dirty.clear()
    this.saving = this.saving.then(async () => {
      for (const session of sessions) await this.write(session)
    })
  }

  /** Writes what is not saved yet, e.g. before edrys-dev exits. */
  async flush() {
    if (this.saveTimer) this.writeDirty()
    await this.saving
  }

  // a copy renamed over the file: a crash midway leaves the old chat, not half a one
  private async write(session: Session) {
    const file = path.join(this.dir, session.id + '.json')
    try {
      await fsp.mkdir(this.dir, { recursive: true })
      await fsp.writeFile(file + '.tmp', JSON.stringify(session))
      await fsp.rename(file + '.tmp', file)
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
