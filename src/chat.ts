import fs from 'node:fs'
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

export type Entry =
  | { t: number; type: 'ai'; markdown: string; ask?: string; inputs?: Input[] }
  | { t: number; type: 'user'; text: string }
  | { t: number; type: 'answer'; ask: string; values: Record<string, string | string[]> }

// what the saved chat keeps, oldest first out
const MAX_ENTRIES = 500

/**
 * The agent chat over the class tab: its history, saved next to the lab in
 * .edrys-dev/chat.json, and the panel's endpoints. Not the class's own
 * (signed) chat: only the author and the agent see it.
 *
 * Emits `user` (entry) when the user typed, `answer` (entry) when they
 * answered a form, and `connection` (boolean) when the panel came or went.
 */
export class Chat extends EventEmitter {
  entries: Entry[] = []
  /** The one form the user can still answer. Forms of earlier runs are closed. */
  open: string | null = null
  private status = ''
  private panels = new Set<express.Response>()

  constructor(private file: string) {
    super()
    try {
      this.entries = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {}
  }

  get connected() {
    return this.panels.size > 0
  }

  /** Posts a message; returns the id of its form if it has inputs. */
  say(markdown: string, inputs: Input[] = [], status?: string): string | undefined {
    const ask = inputs.length ? 'ask-' + crypto.randomBytes(4).toString('hex') : undefined
    const entry: Entry = { t: Date.now(), type: 'ai', markdown, ...(ask ? { ask, inputs } : {}) }
    // only the newest form stays open
    if (ask) {
      this.closeForm()
      this.open = ask
    }
    this.add(entry)
    this.setStatus(status ?? '')
    return ask
  }

  setStatus(status: string) {
    this.status = status
    this.send({ type: 'status', text: status })
  }

  /** Withdraws the open form; returns its id, or null if there was none. */
  closeForm(): string | null {
    const closed = this.open
    this.open = null
    if (closed) this.send({ type: 'close', ask: closed })
    return closed
  }

  routes(app: express.Express) {
    app.get('/edrys-dev/chat/events', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      // a reload shows the whole chat again, with the open form and status
      res.write(`data: ${JSON.stringify({ type: 'history', entries: this.entries, open: this.open, status: this.status })}\n\n`)
      this.panels.add(res)
      if (this.panels.size === 1) this.emit('connection', true)
      req.on('close', () => {
        this.panels.delete(res)
        if (this.panels.size === 0) this.emit('connection', false)
      })
    })

    app.post('/edrys-dev/chat', express.json(), (req, res) => {
      if (!sameOrigin(req)) return res.sendStatus(403)
      const { text, ask, values } = req.body ?? {}

      if (typeof text === 'string' && text.trim()) {
        const entry: Entry = { t: Date.now(), type: 'user', text: text.slice(0, 10000) }
        this.add(entry)
        this.emit('user', entry)
        return res.sendStatus(204)
      }
      if (typeof ask === 'string' && ask === this.open && values && typeof values === 'object') {
        this.open = null
        const entry: Entry = { t: Date.now(), type: 'answer', ask, values }
        this.add(entry)
        this.emit('answer', entry)
        return res.sendStatus(204)
      }
      // e.g. a form that was closed in the meantime
      res.sendStatus(409)
    })

    for (const [file, source] of Object.entries(PANEL_FILES)) {
      app.get('/edrys-dev/' + file, (req, res) => res.sendFile(source()))
    }
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

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.entries))
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

/** The script tag that brings the panel into the edrys-Lite page. */
export const PANEL_SCRIPT = '<script src="/edrys-dev/panel.js" defer></script>'
