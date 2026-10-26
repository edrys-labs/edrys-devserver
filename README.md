# edrys-dev

Develop an [edrys-Lite](https://github.com/edrys-labs/edrys-Lite) lab on your own machine. `edrys-dev` serves edrys-Lite from localhost and keeps a class in step with your lab file: save `lab.yml` and the class updates in every open tab.

```bash
edrys-dev lab.yml --open
```

```
edrys-dev: /home/you/my-lab/lab.yml
  http://localhost:3210/?dev
class open, share link:
  http://localhost:3210/?/classroom/…
```

- The tab opened at `/?dev` owns the class. It imports the lab the first time and republishes it, signed, whenever the file changes. The same lab file reopens the same class after a restart.
- To try the lab as a student or station, open the share link in another browser or a private window. Each browser has its own identity, so it joins as a student, not as the owner.
- The class connects the way it will for your students: with the lab's own `communicationConfig`, or else edrys-Lite's default transport. With `--local` it syncs over edrys-dev's own port instead, which works offline; the share link then carries the setting (`#comm=…`).
- The lab file is the source of truth. Changes made in the class's Settings dialog are overwritten on the next save of the file.

When the lab is done, publish `lab.yml` as usual (for example with a deploy link to https://edrys-labs.github.io).

## Local modules

Put modules you are writing into a `modules/` folder next to the lab, one per subfolder, and use their local address in `lab.yml`:

```yaml
modules:
  - url: http://localhost:3211/my-module/index.html
```

edrys-dev serves that folder on the port after its own (3211 by default; another origin, as real modules have). Saving a file in `modules/my-module/` reloads that module in the class tab, without touching the others, and reloads student and station tabs. Its HTML pages get a small script that reports uncaught errors and `console.error` to edrys-dev, for the agent. Such a lab only works on your machine: replace the local addresses with the published ones before you deploy it.

## With an AI agent (`--mcp`)

With `--mcp`, edrys-dev is an MCP server over stdio: an agent such as Claude Code starts it, edits `lab.yml` with its own file tools and hears from the browser when the class could not take the lab. Put it into the lab folder's `.mcp.json`; do not start `--mcp` yourself:

```json
{
  "mcpServers": {
    "edrys": { "command": "edrys-dev", "args": ["--mcp", "lab.yml"] }
  }
}
```

Tools: `get_state` (lab file, class URL, share link, the class: rooms, users, modules), `goto` (move the class tab to a room, open a student or station tab), `chat` and `read_chat`, `read_messages` (module messages the class tab saw, and errors of local modules), `wait_for_event`. Browser events reach Claude Code as channel messages; agents without channels read the event stream in `get_state.events` (e.g. with a Monitor) or call `wait_for_event`. If the port is taken, the next free one is used; the agent finds the URL with `get_state`.

The class tab gets a chat panel (🤖, bottom right) where you and the agent talk; it is not the class's own chat, nobody else sees it. The agent can ask with buttons or checkboxes there. The chat is saved in `.edrys-dev/chat.json` next to the lab, so a restarted agent can read it; add `.edrys-dev/` to the lab's `.gitignore`.

## Options

| Option | Default | |
|---|---|---|
| `[lab.yml]`, `-i, --input <file>` | `./lab.yml` | lab file, YAML or JSON |
| `-p, --port <port>` | `3210` | the next free port is used if it is taken |
| `--host <host>` | `127.0.0.1` | address to listen on |
| `--local` | off | sync on edrys-dev's own port instead of edrys-Lite's default transport |
| `-m, --modules <dir>` | `./modules` next to the lab, if it exists | local modules, one per subfolder, see above |
| `-o, --open` | off | open the lab in the browser |
| `--mcp` | off | serve an AI agent over stdio, see above |

## Development

```bash
npm install
npm run build    # tsc → dist/
npm test         # builds, then runs test/*.test.js
```

For now edrys-Lite and the edrys websocket-server (optional, only used by `--local`) come from sibling checkouts (`file:../edrys-Lite`, `file:../websocket-server`); build edrys-Lite first (`npm run build` there), since its `dist/` is what edrys-dev serves, including the transport defaults from its `.env`.
