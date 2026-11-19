// edrys-dev init: a lab folder that an AI agent can start in, without writing
// any config by hand. It works in a new folder and in one that already has a
// lab (e.g. laboratory/micropython.yaml in a published lab repository): files
// that exist are kept, and the edrys parts are added to them where it is safe.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import yaml from 'js-yaml'

/** `lab`: the lab file, relative to the folder, with / */
type Ctx = { name: string; extra: string[]; lab: string }

// `extra`: more options for edrys-dev, e.g. --tutor
const server = ({ extra, lab }: Ctx) => ({ command: 'npx', args: ['-y', '@edryslabs/edrys-dev', '--mcp', lab, ...extra] })

// edrys-dev serves the modules folder next to the lab
const modulesDir = (lab: string) => (path.posix.dirname(lab) === '.' ? '' : path.posix.dirname(lab) + '/') + 'modules'

// no prompts for the edrys server and for edits of the lab and its modules
const settings = (lab: string) => ({
  enabledMcpjsonServers: ['edrys'],
  permissions: { allow: ['mcp__edrys', `Edit(/${lab})`, `Edit(/${modulesDir(lab)}/**)`] },
})

/** A lab with a welcome page; also what `--mcp` starts with when there is no lab file. */
export const starterLab = (name: string) => `name: ${JSON.stringify(name)}
meta:
  description: Made with edrys-dev.
modules:
  - url: https://edrys-labs.github.io/module-markdown-it/index.html
    config:
      content: |
        # Welcome

        Open the agent chat (sparkles button in the top bar) and tell the agent what this lab should do.
    width: full
    height: tall
`

// also how an AGENTS.md from before is recognized as having this section
const MARKER = 'edrys MCP server'

const agentsBody = (lab: string) => `This folder is an edrys-Lite lab: \`${lab}\` is the classroom configuration, \`${modulesDir(lab)}/\` (if there) holds modules written for it. Keep the lab file where it is and under its name: deploy links and imports may point to it. The user works in the class in their browser and talks to you through the chat there; they may not look at this session.

When a session starts:

1. Call \`get_state\` of the ${MARKER}. If \`connected\` is false, open its \`url\` in the browser (browser automation or the system's open command), or tell the user the address.
2. If \`messages\` is above 0, call \`read_chat\` and pick up where the chat left off.
3. Serve the chat until the user says stop: answer every chat event with the \`chat\` tool, as the edrys server's instructions say.

The user may not be a programmer. Answer in plain words, show no YAML or code in the chat unless they ask, and offer choices as chat forms (buttons).

When they want to share the class or ask how students join, give them \`get_state.student_link\` (the class's own share link works only on this computer). It is also shown at the top of the agent chat panel.

If the edrys-lab and edrys-module skills are installed, use them to write the lab and its modules.
`

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)

/** What to do with a file that is there: new text to write and what to say, or only a note to the user. */
type Merge = { text?: string; note?: string }

/** `key`: where the servers are, mcpServers (Claude Code) or servers (VS Code) */
const mergeServer = (key: string, entry: (ctx: Ctx) => object) => (text: string, ctx: Ctx): Merge => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    // e.g. a VS Code mcp.json with comments, which we would lose
    return { note: text.includes('edrys-dev') ? undefined : 'add the edrys server yourself, see the README' }
  }
  if (!isObject(data) || (data[key] !== undefined && !isObject(data[key]))) return { note: 'add the edrys server yourself, see the README' }
  const edrys = data[key]?.edrys
  if (!edrys) {
    data[key] = { ...data[key], edrys: entry(ctx) }
    return { text: JSON.stringify(data, null, 2) + '\n', note: 'added the edrys server' }
  }
  const args: unknown[] = Array.isArray(edrys.args) ? edrys.args : []
  const notes = []
  if (!args.includes(ctx.lab)) notes.push(`its edrys server starts another lab, put "${ctx.lab}" into its args yourself`)
  if (ctx.extra.length && !args.includes(ctx.extra[0])) notes.push(`add ${ctx.extra.map((a) => `"${a}"`).join(', ')} to the args of edrys yourself`)
  return { note: notes.join('; ') || undefined }
}

function mergeSettings(text: string, ctx: Ctx): Merge {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { note: 'not plain JSON, edrys-dev may ask before each edit' }
  }
  if (!isObject(data)) return { note: 'not a settings object, edrys-dev may ask before each edit' }
  const want = settings(ctx.lab)
  const servers = Array.isArray(data.enabledMcpjsonServers) ? data.enabledMcpjsonServers : []
  const permissions = isObject(data.permissions) ? data.permissions : {}
  const allow = Array.isArray(permissions.allow) ? permissions.allow : []
  const addServers = want.enabledMcpjsonServers.filter((name) => !servers.includes(name))
  const addAllow = want.permissions.allow.filter((rule) => !allow.includes(rule))
  if (!addServers.length && !addAllow.length) return {}
  // a project that turned off its .mcp.json servers would not start edrys either
  if (data.enableAllProjectMcpServers !== true) data.enabledMcpjsonServers = [...servers, ...addServers]
  data.permissions = { ...permissions, allow: [...allow, ...addAllow] }
  return { text: JSON.stringify(data, null, 2) + '\n', note: 'added the edrys permissions' }
}

const FILES: { file: string; create: (ctx: Ctx) => string; merge: (text: string, ctx: Ctx) => Merge }[] = [
  {
    file: '.mcp.json',
    create: (ctx) => JSON.stringify({ mcpServers: { edrys: server(ctx) } }, null, 2) + '\n',
    merge: mergeServer('mcpServers', server),
  },
  {
    file: '.vscode/mcp.json',
    create: (ctx) => JSON.stringify({ servers: { edrys: { type: 'stdio', ...server(ctx) } } }, null, 2) + '\n',
    merge: mergeServer('servers', (ctx) => ({ type: 'stdio', ...server(ctx) })),
  },
  {
    file: 'AGENTS.md',
    create: ({ name, lab }) => `# ${name}\n\n${agentsBody(lab)}`,
    merge: (text, { lab }) =>
      text.includes(MARKER)
        ? {}
        : { text: text + (text === '' || text.endsWith('\n') ? '' : '\n') + `\n## edrys-Lite lab\n\n${agentsBody(lab)}`, note: 'added the edrys section' },
  },
  // Claude Code reads CLAUDE.md, which imports AGENTS.md
  {
    file: 'CLAUDE.md',
    create: () => '@AGENTS.md\n',
    merge: (text) =>
      text.includes('@AGENTS.md')
        ? {}
        : { text: text + (text === '' || text.endsWith('\n') ? '' : '\n') + '\n@AGENTS.md\n', note: 'added @AGENTS.md' },
  },
  {
    file: '.claude/settings.json',
    create: ({ lab }) => JSON.stringify(settings(lab), null, 2) + '\n',
    merge: mergeSettings,
  },
]

const LAB_FILE = /\.(ya?ml|json)$/i

/** The config in `file` if it is an edrys lab, an object with a list of modules. */
function readLab(file: string): Record<string, any> | null {
  try {
    if (fs.statSync(file).size > 2_000_000) return null
    const text = fs.readFileSync(file, 'utf8')
    const data = /\.json$/i.test(file) ? JSON.parse(text) : yaml.load(text)
    return isObject(data) && Array.isArray(data.modules) ? data : null
  } catch {
    return null
  }
}

// modules hold the lab's own modules, not labs
const SKIP = new Set(['node_modules', 'modules', 'dist'])

/** Labs in `dir` and two levels of folders below it, e.g. laboratory/micropython.yaml. */
function findLabs(dir: string) {
  const found: string[] = []
  let budget = 1000 // started in a big folder by mistake, it does not read all of it
  const walk = (folder: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (budget-- <= 0) return
      if (entry.name.startsWith('.')) continue
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) {
        if (depth < 2 && !SKIP.has(entry.name)) walk(full, depth + 1)
      } else if (entry.isFile() && LAB_FILE.test(entry.name) && readLab(full)) found.push(full)
    }
  }
  walk(dir, 0)
  return found
}

const relative = (dir: string, file: string) => path.relative(dir, file).split(path.sep).join('/')

/**
 * The lab file to set up, relative to `dir`, or null for a new lab.yml.
 * `given`: --lab, relative to the current folder.
 */
async function chooseLab(dir: string, given: string | undefined, say: (line: string) => void): Promise<string | null> {
  if (given) {
    const file = path.resolve(given)
    const lab = relative(dir, file)
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`no lab file at ${file}`)
    if (lab.startsWith('../') || path.isAbsolute(lab)) throw new Error(`the lab must be in the folder ${dir}, not at ${file}`)
    if (!LAB_FILE.test(file)) throw new Error(`the lab must be a YAML or JSON file, not ${lab}`)
    if (!readLab(file)) throw new Error(`${lab} is not an edrys lab: it has no list of modules`)
    return lab
  }
  if (fs.existsSync(path.join(dir, 'lab.yml'))) return 'lab.yml'

  const labs = findLabs(dir).map((file) => relative(dir, file))
  if (!labs.length) return null
  if (labs.length === 1) {
    if (!process.stdin.isTTY) {
      say(`  found    ${labs[0]}, using it as the lab (pick another with --lab <file>)`)
      return labs[0]
    }
    return /^(y|yes|)$/i.test(await ask(`Found the lab ${labs[0]}. Use it? (Y/n) `)) ? labs[0] : null
  }
  const list = labs.map((lab, i) => `  ${i + 1}. ${lab}`).join('\n')
  if (!process.stdin.isTTY) throw new Error(`this folder has more than one lab:\n${list}\npick one with --lab <file>`)
  say(`This folder has more than one lab:\n${list}`)
  const answer = await ask(`Which one should the agent work on? (1-${labs.length}, or 0 for a new lab.yml) `)
  const pick = Number(answer)
  if (!Number.isInteger(pick) || pick < 0 || pick > labs.length) throw new Error(`no lab ${JSON.stringify(answer)}, pick one with --lab <file>`)
  return pick === 0 ? null : labs[pick - 1]
}

// The edrys skills, for every lab of this user: in ~/.agents/skills, which
// Copilot reads, linked into ~/.claude/skills. In the lab folder they would be
// published with it.
const SKILLS = ['-y', 'skills', 'add', 'edrys-labs/skills', '-g', '--skill', '*', '--agent', 'claude-code', 'github-copilot', '-y']
const SKILLS_HINT = 'npx skills add edrys-labs/skills'
// only these two, not the user's other skills; it changes nothing that is up to date
const UPDATE = ['-y', 'skills', 'update', 'edrys-lab', 'edrys-module', '-g', '-y']
const UPDATE_HINT = 'npx skills update edrys-lab edrys-module -g'

function skillsInstalled() {
  return ['.claude', '.agents'].some((dir) =>
    ['edrys-lab', 'edrys-module'].every((name) => fs.existsSync(path.join(os.homedir(), dir, 'skills', name)))
  )
}

async function ask(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(question)).trim()
  rl.close()
  return answer
}

/**
 * `extra`: options the agent starts edrys-dev with, e.g. ['--tutor'].
 * `lab`: the lab file that is there (--lab); without it, init looks for one.
 * Throws, before it writes anything, when it cannot tell which lab to use.
 */
export async function init(
  folder: string,
  extra: string[] = [],
  say: (line: string) => void = console.log,
  options: { lab?: string } = {}
) {
  const dir = path.resolve(folder)
  if (options.lab && !fs.existsSync(dir)) throw new Error(`no folder ${dir}`)
  fs.mkdirSync(dir, { recursive: true })

  const found = await chooseLab(dir, options.lab, say)
  const lab = found ?? 'lab.yml'
  let name = path.basename(dir)
  if (found) {
    const own = readLab(path.join(dir, found))?.name
    if (typeof own === 'string' && own.trim()) name = own.trim()
  } else {
    if (process.stdin.isTTY) name = (await ask(`Name of your lab (${name}): `)) || name
    fs.writeFileSync(path.join(dir, lab), starterLab(name))
    say(`  created  ${lab}`)
  }
  if (found) say(`  kept     ${lab} (already there)`)

  const ctx = { name, extra, lab }
  for (const { file, create, merge } of FILES) {
    const target = path.join(dir, file)
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, create(ctx))
      say(`  created  ${file}`)
      continue
    }
    const { text, note } = merge(fs.readFileSync(target, 'utf8'), ctx)
    if (text !== undefined) {
      fs.writeFileSync(target, text)
      say(`  changed  ${file}: ${note}`)
    } else say(`  kept     ${file} (already there)` + (note ? `: ${note}` : ''))
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

  if (!skillsInstalled()) {
    const yes =
      process.stdin.isTTY &&
      /^(y|yes|)$/i.test(await ask('\nInstall the edrys skills, so your agent knows how labs and modules are written? (Y/n) '))
    // npx is npx.cmd on Windows, which needs a shell
    const run = yes && spawnSync('npx', SKILLS, { stdio: 'inherit', shell: process.platform === 'win32' })
    if (run && run.status === 0) say('  installed the edrys skills')
    else say(`\n${run ? 'Could not install the edrys skills. ' : ''}To install them later: ${SKILLS_HINT}`)
  } else if (process.stdin.isTTY) {
    say('\nChecking the edrys skills for updates...')
    const run = spawnSync('npx', UPDATE, { stdio: 'inherit', shell: process.platform === 'win32' })
    if (run.status !== 0) say(`Could not check the edrys skills for updates. To do it later: ${UPDATE_HINT}`)
  }

  say(`
Your lab is ready in ${dir}${found ? `\nThe agent works on ${lab}.` : ''}

Next: open this folder in your AI agent (Claude Code, or VS Code with Copilot)
and write "start". The agent starts edrys-dev and opens the class in your
browser; from then on you can talk to it in the agent chat there (sparkles button in the top bar).`)
  if (extra.includes('--tutor')) {
    say(`
Your students get a tutor chat in the class, answered by the AI on this
computer. Notes only for the tutor go into tutor.md in ${path.posix.dirname(lab) === '.' ? 'this folder' : `${path.posix.dirname(lab)}/`}.`)
  }
}
