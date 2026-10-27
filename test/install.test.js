import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

// Installs often live in a hidden folder (~/.nvm/…, ~/.npm/_npx/…).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edrys-dev-install-'))
const pkg = path.join(dir, '.hidden', 'edrys-dev')
let server

after(() => {
  server?.kill()
  fs.rmSync(dir, { recursive: true })
})

test('serves the chat panel from an install in a hidden folder', async () => {
  fs.mkdirSync(pkg, { recursive: true })
  for (const entry of ['dist', 'views', 'package.json']) {
    fs.cpSync(entry, path.join(pkg, entry), { recursive: true })
  }
  fs.symlinkSync(path.resolve('node_modules'), path.join(pkg, 'node_modules'))
  const lab = path.join(dir, 'lab.yml')
  fs.writeFileSync(lab, 'name: Hidden\n')

  server = spawn(process.execPath, [path.join(pkg, 'dist', 'index.js'), lab, '-p', '3300'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve) => server.stdout.once('data', resolve))

  for (const file of ['panel.js', 'marked.js', 'purify.js']) {
    assert.equal((await fetch(`http://127.0.0.1:3300/edrys-dev/${file}`)).status, 200, file)
  }
})
