import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edrys-dev-init-'))
after(() => fs.rmSync(dir, { recursive: true }))

// no TTY on stdin, so no question: the lab is named after its folder
const init = (folder) => execFileSync(process.execPath, ['dist/index.js', 'init', folder], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()

test('init sets up a new folder for an agent', () => {
  const lab = path.join(dir, 'My lab: one')
  const out = init(lab)
  const read = (file) => fs.readFileSync(path.join(lab, file), 'utf8')

  assert.match(read('lab.yml'), /^name: "My lab: one"\n/)
  const args = ['-y', '@edryslabs/edrys-dev', '--mcp', 'lab.yml']
  assert.deepEqual(JSON.parse(read('.mcp.json')).mcpServers.edrys, { command: 'npx', args })
  assert.deepEqual(JSON.parse(read('.vscode/mcp.json')).servers.edrys, { type: 'stdio', command: 'npx', args })
  assert.match(read('AGENTS.md'), /^# My lab: one\n/)
  assert.equal(read('CLAUDE.md'), '@AGENTS.md\n')
  assert.deepEqual(JSON.parse(read('.claude/settings.json')), {
    enabledMcpjsonServers: ['edrys'],
    permissions: { allow: ['mcp__edrys', 'Edit(/lab.yml)', 'Edit(/modules/**)'] },
  })
  assert.equal(read('.gitignore'), '.edrys-dev/\n')
  assert.match(out, /created {2}lab\.yml/)
})

test('init keeps files that are there and adds to .gitignore once', () => {
  const lab = path.join(dir, 'existing')
  fs.mkdirSync(lab)
  fs.writeFileSync(path.join(lab, 'lab.yml'), 'name: Mine\n')
  fs.writeFileSync(path.join(lab, '.gitignore'), 'node_modules')

  const out = init(lab)
  assert.equal(fs.readFileSync(path.join(lab, 'lab.yml'), 'utf8'), 'name: Mine\n')
  assert.match(out, /kept {5}lab\.yml/)
  assert.equal(fs.readFileSync(path.join(lab, '.gitignore'), 'utf8'), 'node_modules\n.edrys-dev/\n')

  init(lab)
  assert.equal(fs.readFileSync(path.join(lab, '.gitignore'), 'utf8'), 'node_modules\n.edrys-dev/\n')
})

test('--mcp starts in a folder without a lab, with the starter lab', { timeout: 10000 }, async () => {
  const empty = path.join(dir, 'empty')
  fs.mkdirSync(empty)
  const lab = path.join(empty, 'lab.yml')
  const agent = spawn(process.execPath, ['dist/index.js', lab, '--mcp', '-p', '3305'], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const first = await new Promise((resolve) => agent.stderr.once('data', (data) => resolve(data.toString())))
    assert.match(first, /no lab file yet, created .*lab\.yml/)
    assert.match(fs.readFileSync(lab, 'utf8'), /^name: "empty"\n/)
  } finally {
    agent.kill()
  }
})

test('without --mcp a missing lab is still an error', () => {
  const lab = path.join(dir, 'none', 'lab.yml')
  const run = spawnSync(process.execPath, ['dist/index.js', lab, '-p', '3306'])
  assert.equal(run.status, 1)
  assert.match(run.stderr.toString(), /no lab file at/)
  assert.equal(fs.existsSync(lab), false)
})
