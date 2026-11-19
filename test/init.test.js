import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edrys-dev-init-'))
after(() => fs.rmSync(dir, { recursive: true }))

// a home of its own, without the edrys skills unless a test adds them
const home = path.join(dir, 'home')

// no TTY on stdin, so no questions: the lab is named after its folder, the skills are left to the user
const init = (folder, ...options) =>
  execFileSync(process.execPath, ['dist/index.js', 'init', folder, ...options], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, USERPROFILE: home },
  }).toString()

test('init sets up a new folder for an agent', () => {
  const lab = path.join(dir, 'My lab: one')
  const out = init(lab)
  const read = (file) => fs.readFileSync(path.join(lab, file), 'utf8')

  assert.match(read('lab.yml'), /^name: "My lab: one"\n/)
  // without a height, edrys-Lite makes it 200px high
  assert.match(read('lab.yml'), /\n {4}width: full\n {4}height: tall\n$/)
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
  assert.match(out, /To install them later: npx skills add edrys-labs\/skills/)
})

test('init --tutor lets the agent start edrys-dev with the tutor', () => {
  const lab = path.join(dir, 'tutored')
  const out = init(lab, '--tutor', '--tutor-agent', 'codex')
  const args = ['-y', '@edryslabs/edrys-dev', '--mcp', 'lab.yml', '--tutor', '--tutor-agent', 'codex']
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(lab, '.mcp.json'), 'utf8')).mcpServers.edrys.args, args)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(lab, '.vscode/mcp.json'), 'utf8')).servers.edrys.args, args)
  assert.match(out, /tutor chat/)

  // a config from before is kept, with a hint
  const before = path.join(dir, 'untutored')
  init(before)
  assert.match(init(before, '--tutor'), /kept {5}\.mcp\.json \(already there\): add "--tutor" to the args/)
})

test('init leaves out the skills hint once they are installed', () => {
  for (const name of ['edrys-lab', 'edrys-module']) fs.mkdirSync(path.join(home, '.agents', 'skills', name), { recursive: true })
  try {
    assert.doesNotMatch(init(path.join(dir, 'prepared')), /skills/)
  } finally {
    fs.rmSync(path.join(home, '.agents'), { recursive: true })
  }
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

// a published lab repository, like edrys-labs/lab-web-serial
const repo = (name) => {
  const folder = path.join(dir, name)
  fs.mkdirSync(path.join(folder, 'laboratory'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'laboratory', 'micropython.yaml'), 'name: Lab - WebSerial\nmodules:\n  - url: x\n')
  // no labs: no modules list, and a folder skipped
  fs.writeFileSync(path.join(folder, 'package.json'), '{"name": "x"}')
  fs.mkdirSync(path.join(folder, 'modules', 'm'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'modules', 'm', 'module.yml'), 'modules: []\n')
  return folder
}

test('init finds the lab of a lab repository and sets it up, without a starter lab', () => {
  const lab = repo('found')
  const out = init(lab)
  const read = (file) => fs.readFileSync(path.join(lab, file), 'utf8')

  assert.equal(fs.existsSync(path.join(lab, 'lab.yml')), false)
  assert.match(out, /found {4}laboratory\/micropython\.yaml, using it/)
  const args = ['-y', '@edryslabs/edrys-dev', '--mcp', 'laboratory/micropython.yaml']
  assert.deepEqual(JSON.parse(read('.mcp.json')).mcpServers.edrys.args, args)
  assert.deepEqual(JSON.parse(read('.vscode/mcp.json')).servers.edrys.args, args)
  assert.deepEqual(JSON.parse(read('.claude/settings.json')).permissions.allow, [
    'mcp__edrys',
    'Edit(/laboratory/micropython.yaml)',
    'Edit(/laboratory/modules/**)',
  ])
  // named after the lab, not the folder
  assert.match(read('AGENTS.md'), /^# Lab - WebSerial\n\nThis folder is an edrys-Lite lab: `laboratory\/micropython\.yaml`/)
  assert.match(out, /The agent works on laboratory\/micropython\.yaml/)
})

test('init --lab picks the lab, relative to the current folder', () => {
  const lab = repo('given')
  fs.writeFileSync(path.join(lab, 'laboratory', 'arduino.json'), '{"name": "Arduino", "modules": []}')
  // two labs: init does not guess
  assert.throws(() => init(lab), (error) => /more than one lab:\n {2}1\. laboratory\/arduino\.json\n {2}2\. laboratory\/micropython\.yaml\n/.test(error.stderr))
  assert.equal(fs.existsSync(path.join(lab, '.mcp.json')), false)

  init(lab, '--lab', path.join(lab, 'laboratory', 'arduino.json'))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(lab, '.mcp.json'), 'utf8')).mcpServers.edrys.args.at(-1), 'laboratory/arduino.json')

  for (const [file, message] of [
    ['missing.yml', /no lab file at/],
    ['package.json', /is not an edrys lab/],
    [path.join(dir, 'outside.yml'), /must be in the folder/],
  ]) {
    if (file.includes('outside')) fs.writeFileSync(file, 'modules: []\n')
    assert.throws(() => init(lab, '--lab', path.resolve(lab, file)), (error) => message.test(error.stderr))
  }
})

test('init adds the edrys parts to agent files that are there', () => {
  const lab = repo('merged')
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(lab, file)), { recursive: true })
    fs.writeFileSync(path.join(lab, file), text)
  }
  const read = (file) => fs.readFileSync(path.join(lab, file), 'utf8')
  write('.mcp.json', JSON.stringify({ mcpServers: { other: { command: 'other' } } }))
  write('.vscode/mcp.json', '{\n  // comments: not touched\n  "servers": {}\n}\n')
  write('AGENTS.md', '# My repo\n\nRun the tests.')
  write('CLAUDE.md', 'Be brief.\n')
  write('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(ls)'], deny: ['Bash(rm)'] } }))

  const out = init(lab)
  const mcp = JSON.parse(read('.mcp.json')).mcpServers
  assert.deepEqual(mcp.other, { command: 'other' })
  assert.equal(mcp.edrys.args.at(-1), 'laboratory/micropython.yaml')
  assert.match(out, /changed {2}\.mcp\.json: added the edrys server/)
  assert.equal(read('.vscode/mcp.json'), '{\n  // comments: not touched\n  "servers": {}\n}\n')
  assert.match(out, /kept {5}\.vscode\/mcp\.json \(already there\): add the edrys server yourself/)
  assert.match(read('AGENTS.md'), /^# My repo\n\nRun the tests\.\n\n## edrys-Lite lab\n\nThis folder is an edrys-Lite lab: `laboratory\/micropython\.yaml`/)
  assert.equal(read('CLAUDE.md'), 'Be brief.\n\n@AGENTS.md\n')
  assert.deepEqual(JSON.parse(read('.claude/settings.json')), {
    permissions: {
      allow: ['Bash(ls)', 'mcp__edrys', 'Edit(/laboratory/micropython.yaml)', 'Edit(/laboratory/modules/**)'],
      deny: ['Bash(rm)'],
    },
    enabledMcpjsonServers: ['edrys'],
  })

  // a second run changes nothing
  const before = ['.mcp.json', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json'].map(read)
  assert.doesNotMatch(init(lab), /changed/)
  assert.deepEqual(['.mcp.json', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json'].map(read), before)
})

test('init points out an edrys server that starts another lab', () => {
  const lab = repo('elsewhere')
  fs.writeFileSync(path.join(lab, '.mcp.json'), JSON.stringify({ mcpServers: { edrys: { command: 'npx', args: ['--mcp', 'lab.yml'] } } }))
  assert.match(init(lab), /kept {5}\.mcp\.json \(already there\): its edrys server starts another lab, put "laboratory\/micropython\.yaml" into its args/)
})

test('-v shows the versions of edrys-dev and its edrys-Lite', () => {
  const own = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
  for (const flag of ['-v', '--version']) {
    const run = spawnSync(process.execPath, ['dist/index.js', flag])
    assert.equal(run.status, 0)
    assert.match(run.stdout.toString(), new RegExp(`^edrys-dev ${own.replaceAll('.', '\\.')} \\(edrys-Lite \\d+\\.\\d+\\.\\d+[^)]*\\)\\n$`))
  }
})

test('--lab without init is an error', () => {
  const run = spawnSync(process.execPath, ['dist/index.js', '--lab', 'x.yml'])
  assert.equal(run.status, 1)
  assert.match(run.stderr.toString(), /--lab is for init/)
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
