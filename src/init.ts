// edrys-dev init: a lab folder that an AI agent can start in, without writing
// any config by hand. Files that exist are kept.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'

const SERVER = { command: 'npx', args: ['-y', '@edryslabs/edrys-dev', '--mcp', 'lab.yml'] }

const SETTINGS = {
  enabledMcpjsonServers: ['edrys'],
  permissions: { allow: ['mcp__edrys', 'Edit(/lab.yml)', 'Edit(/modules/**)'] },
}

const lab = (name: string) => `name: ${JSON.stringify(name)}
meta:
  description: Made with edrys-dev.
modules:
  - url: https://edrys-labs.github.io/module-markdown-it/index.html
    config:
      content: |
        # Welcome

        Open the 🤖 chat (bottom right) and tell the agent what this lab should do.
    width: full
`

const agents = (name: string) => `# ${name}

This folder is an edrys-Lite lab: \`lab.yml\` is the classroom configuration, \`modules/\` (if there) holds modules written for it. The user works in the class in their browser and talks to you through the chat there; they may not look at this session.

When a session starts:

1. Call \`get_state\` of the edrys MCP server. If \`connected\` is false, open its \`url\` in the browser (browser automation or the system's open command), or tell the user the address.
2. If \`messages\` is above 0, call \`read_chat\` and pick up where the chat left off.
3. Serve the chat until the user says stop: answer every chat event with the \`chat\` tool, as the edrys server's instructions say.

The user may not be a programmer. Answer in plain words, show no YAML or code in the chat unless they ask, and offer choices as chat forms (buttons).

If the edrys-lab and edrys-module skills are installed, use them to write the lab and its modules.
`

const FILES: [string, (name: string) => string][] = [
  ['lab.yml', lab],
  ['.mcp.json', () => JSON.stringify({ mcpServers: { edrys: SERVER } }, null, 2) + '\n'],
  ['.vscode/mcp.json', () => JSON.stringify({ servers: { edrys: { type: 'stdio', ...SERVER } } }, null, 2) + '\n'],
  ['AGENTS.md', agents],
  // Claude Code reads CLAUDE.md, which imports AGENTS.md
  ['CLAUDE.md', () => '@AGENTS.md\n'],
  // no prompts for the edrys server and for edits of the lab and its modules
  ['.claude/settings.json', () => JSON.stringify(SETTINGS, null, 2) + '\n'],
]

export async function init(folder: string, say: (line: string) => void = console.log) {
  const dir = path.resolve(folder)
  fs.mkdirSync(dir, { recursive: true })

  let name = path.basename(dir)
  if (process.stdin.isTTY && !fs.existsSync(path.join(dir, 'lab.yml'))) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    name = (await rl.question(`Name of your lab (${name}): `)).trim() || name
    rl.close()
  }

  for (const [file, content] of FILES) {
    const target = path.join(dir, file)
    if (fs.existsSync(target)) {
      say(`  kept     ${file} (already there)`)
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content(name))
    say(`  created  ${file}`)
  }

  const ignore = path.join(dir, '.gitignore')
  const lines = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : null
  if (lines === null) {
    fs.writeFileSync(ignore, '.edrys-dev/\n')
    say('  created  .gitignore')
  } else if (!lines.split(/\r?\n/).some((line) => ['.edrys-dev', '.edrys-dev/', '/.edrys-dev/'].includes(line.trim()))) {
    fs.appendFileSync(ignore, (lines === '' || lines.endsWith('\n') ? '' : '\n') + '.edrys-dev/\n')
    say('  added    .edrys-dev/ to .gitignore')
  }

  say(`
Your lab is ready in ${dir}

Next: open this folder in your AI agent (Claude Code, or VS Code with Copilot)
and write "start". The agent starts edrys-dev and opens the class in your
browser; from then on you can talk to it in the 🤖 chat there.`)
}
