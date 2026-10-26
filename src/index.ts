#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import open from 'open'
import { startDevServer, type Report } from './server.js'
import { startMcp } from './mcp.js'

const HELP = `edrys-dev: develop an edrys-Lite lab locally

Usage: edrys-dev [lab.yml] [options]

  -i, --input <file>  lab file (YAML or JSON), default ./lab.yml
  -p, --port <port>   port, default 3210 (the next free one if taken)
      --host <host>   address to listen on, default 127.0.0.1
      --local         sync on this server instead of edrys-Lite's default
                      transport (works offline)
  -m, --modules <dir> local modules, one per subfolder, served on the next
                      port (default ./modules next to the lab, if it exists);
                      a save there reloads that module in the class
  -o, --open          open the lab in the browser
      --mcp           serve an AI agent over stdio (MCP); started by the
                      agent from its MCP config, not by hand
  -h, --help          show this help

The tab opened at /?dev owns the class and republishes it whenever the lab
file changes. Open its share link in another browser to join as a student.`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    input: { type: 'string', short: 'i' },
    port: { type: 'string', short: 'p', default: '3210' },
    host: { type: 'string', default: '127.0.0.1' },
    local: { type: 'boolean', default: false },
    modules: { type: 'string', short: 'm' },
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

const lab = path.resolve(values.input ?? positionals[0] ?? 'lab.yml')
if (!fs.existsSync(lab)) {
  console.error(`edrys-dev: no lab file at ${lab}\n\n${HELP}`)
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
})

server.bus.on('report', (report: Report) => {
  switch (report.type) {
    case 'open':
      say(`class open, share link:\n  ${report.url}`)
      break
    case 'error':
      console.error(`lab error: ${report.message}`)
      break
  }
})

const host = ['127.0.0.1', '0.0.0.0', '::'].includes(values.host) ? 'localhost' : values.host
const url = `http://${host}:${server.port}/?dev`

say(`edrys-dev: ${lab}\n  ${url}`)
if (server.modules) say(`modules: ${server.modules.dir}\n  ${server.modules.url}<name>/...`)
if (values.mcp) startMcp(server, { lab, url })
if (values.open) await open(url)

process.on('SIGINT', async () => {
  await server.close()
  process.exit(0)
})
