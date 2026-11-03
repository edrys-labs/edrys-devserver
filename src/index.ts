#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import open from 'open'
import { startDevServer, type Report } from './server.js'
import { startMcp, studentLink, localUrls } from './mcp.js'
import { reachable } from './origin.js'
import { readSaved } from './watch.js'
import { CLASS_PER_HOUR, TUTOR_AGENTS, tutorAuth, type TutorAgent } from './tutor.js'

const HELP = `edrys-dev: develop an edrys-Lite lab locally

Usage: edrys-dev [lab.yml] [options]
       edrys-dev init [folder]   set up a new lab for an AI agent: lab.yml,
                                 agent config and instructions; with
                                 --tutor, the agent starts it with the tutor

  -i, --input <file>  lab file (YAML or JSON), default ./lab.yml
  -p, --port <port>   port, default 3210 (the next free one if taken)
      --host <host>   address to listen on, default 127.0.0.1; another one
                      (e.g. 0.0.0.0) lets others on the network in, with
                      --mcp also into the agent chat
      --local         sync on this server instead of edrys-Lite's default
                      transport (works offline)
  -m, --modules <dir> local modules, one per subfolder, served on the next
                      port (default ./modules next to the lab, if it exists);
                      a save there reloads that module in the class
      --student-url <url>
                      the edrys-Lite site students on other machines join
                      on, default https://edrys-labs.github.io/; it must use
                      the same transport (not with --local)
      --tutor         students get a tutor chat in the class, answered by
                      an AI agent on this machine, without tools; notes
                      for it go into tutor.md next to the lab
      --tutor-agent <claude|codex>
                      the agent that answers: Claude Code (claude -p,
                      the default) or Codex (codex exec)
      --tutor-model <model>
                      the model the tutor uses, default the agent's own
      --tutor-per-hour <n>
                      questions the tutor answers per hour for the whole
                      class, default 200 (each student: 20)
  -o, --open          open the lab in the browser
      --mcp           serve an AI agent over stdio (MCP); started by the
                      agent from its MCP config, not by hand
  -h, --help          show this help

The tab opened at /?dev owns the class and republishes it whenever the lab
file changes. Open its share link in another browser to join as a student;
students on other machines join through the link printed for them.`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    input: { type: 'string', short: 'i' },
    port: { type: 'string', short: 'p', default: '3210' },
    host: { type: 'string', default: '127.0.0.1' },
    local: { type: 'boolean', default: false },
    modules: { type: 'string', short: 'm' },
    'student-url': { type: 'string', default: 'https://edrys-labs.github.io/' },
    tutor: { type: 'boolean', default: false },
    'tutor-agent': { type: 'string', default: 'claude' },
    'tutor-model': { type: 'string' },
    'tutor-per-hour': { type: 'string', default: String(CLASS_PER_HOUR) },
    open: { type: 'boolean', short: 'o', default: false },
    mcp: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

// with --mcp, stdout carries the protocol
const say = values.mcp ? console.error : console.log

if (values.help) {
  say(HELP)
  process.exit(0)
}

const tutorAgent = values['tutor-agent'] as TutorAgent
if (!TUTOR_AGENTS.includes(tutorAgent)) {
  console.error(`edrys-dev: --tutor-agent must be ${TUTOR_AGENTS.join(' or ')}, not ${tutorAgent}`)
  process.exit(1)
}
const classPerHour = Number(values['tutor-per-hour'])
if (!Number.isInteger(classPerHour) || classPerHour < 1) {
  console.error(`edrys-dev: --tutor-per-hour must be a whole number of at least 1, not ${values['tutor-per-hour']}`)
  process.exit(1)
}

if (positionals[0] === 'init' && !values.input) {
  const { init } = await import('./init.js')
  // the agent starts edrys-dev with the tutor options given here
  const tutor = values.tutor
    ? [
        '--tutor',
        ...(tutorAgent !== 'claude' ? ['--tutor-agent', tutorAgent] : []),
        ...(values['tutor-model'] ? ['--tutor-model', values['tutor-model']] : []),
        ...(classPerHour !== CLASS_PER_HOUR ? ['--tutor-per-hour', String(classPerHour)] : []),
      ]
    : []
  await init(positionals[1] ?? '.', tutor)
  process.exit(0)
}

const lab = path.resolve(values.input ?? positionals[0] ?? 'lab.yml')
// an agent started in an empty folder gets a lab to work on, not a failed server
if (!fs.existsSync(lab) && values.mcp && /\.ya?ml$/i.test(lab) && fs.statSync(path.dirname(lab), { throwIfNoEntry: false })?.isDirectory()) {
  const { starterLab } = await import('./init.js')
  fs.writeFileSync(lab, starterLab(path.basename(path.dirname(lab))), { flag: 'wx' })
  say(`edrys-dev: no lab file yet, created ${lab}`)
}
if (!fs.existsSync(lab)) {
  console.error(`edrys-dev: no lab file at ${lab}\n\n${HELP}`)
  process.exit(1)
}

const studentSite = values['student-url']
if (!URL.canParse(studentSite) || !/^https?:$/.test(new URL(studentSite).protocol)) {
  console.error(`edrys-dev: --student-url must be an http(s) address, not ${studentSite}`)
  process.exit(1)
}

const nextToLab = path.join(path.dirname(lab), 'modules')
const modules = values.modules ? path.resolve(values.modules) : fs.existsSync(nextToLab) ? nextToLab : undefined
if (modules && !fs.statSync(modules, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`edrys-dev: no modules folder at ${modules}`)
  process.exit(1)
}

const server = await startDevServer({
  lab,
  port: Number(values.port),
  host: values.host,
  local: values.local,
  modules,
  agent: values.mcp,
  studentSite: values.local ? null : studentSite,
  tutor: values.tutor ? { agent: tutorAgent, model: values['tutor-model'], classPerHour } : undefined,
})
server.tutor?.on('failed', ({ name, error }) => console.error(`tutor: no answer for ${name}: ${error}`))
server.tutor?.on('limit', (perHour) =>
  console.error(`tutor: the class reached its limit of ${perHour} questions this hour, more get no answer (--tutor-per-hour)`)
)
server.tutor?.on('switch', (on) => say(`tutor: ${on ? 'on' : 'off'} (switched in the chat panel)`))

// Ctrl+C, or a process manager or agent client stopping it; the chat is saved
// first. Before anything is printed: whoever waits for that may stop it at once.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await server.close()
    process.exit(0)
  })
}

// the localhost URLs the terminal warned about last
let warnedLocal = ''
server.bus.on('report', async (report: Report) => {
  switch (report.type) {
    case 'open':
      say(`class open, share link:\n  ${report.url}`)
      if (values.local) {
        say('students: --local reaches this machine only; start without it to let others join')
        break
      }
      say(`students join at:\n  ${studentLink(report.url, studentSite)}`)
      {
        // once per set of URLs, not on every reload of the class tab
        const local = localUrls(await readSaved(lab).catch(() => '')).join(' ')
        if (local && local !== warnedLocal) {
          console.error('edrys-dev: the lab loads modules from localhost, which students cannot load: publish them first')
        }
        warnedLocal = local
      }
      break
    case 'error':
      console.error(`lab error: ${report.message}`)
      break
  }
})

const host = ['127.0.0.1', '0.0.0.0', '::'].includes(values.host) ? 'localhost' : values.host
const url = `http://${host}:${server.port}/?dev`

say(`edrys-dev: ${lab}\n  ${url}`)
if (server.tutor) {
  say(`tutor: on (${tutorAgent}, answers paid with ${tutorAuth(tutorAgent)}), notes for it in ${path.join(path.dirname(lab), 'tutor.md')}`)
}
if (server.modules) say(`modules: ${server.modules.dir}\n  ${server.modules.url}<name>/...`)
if (reachable(values.host)) {
  console.error(
    `edrys-dev: listening on ${values.host}, not only on this machine: others on the network can open the class` +
      (values.mcp ? ', type to the agent in its chat' : '') +
      (values.tutor ? ', read the students\' tutor chats and switch the tutor' : '')
  )
}
if (values.mcp) startMcp(server, { lab, url, studentSite: values.local ? null : studentSite })
if (values.open) await open(url)
