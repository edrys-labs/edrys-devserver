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

## With an AI agent (`--mcp`)

With `--mcp`, edrys-dev is an MCP server over stdio: an agent such as Claude Code starts it, edits `lab.yml` with its own file tools and hears from the browser when the class could not take the lab. Put it into the lab folder's `.mcp.json`; do not start `--mcp` yourself:

```json
{
  "mcpServers": {
    "edrys": { "command": "edrys-dev", "args": ["--mcp", "lab.yml"] }
  }
}
```

Tools: `get_state` (lab file, class URL, share link, whether the class tab is open) and `wait_for_event`. Browser events reach Claude Code as channel messages; agents without channels read the event stream in `get_state.events` (e.g. with a Monitor) or call `wait_for_event`. If the port is taken, the next free one is used; the agent finds the URL with `get_state`.

## Options

| Option | Default | |
|---|---|---|
| `[lab.yml]`, `-i, --input <file>` | `./lab.yml` | lab file, YAML or JSON |
| `-p, --port <port>` | `3210` | the next free port is used if it is taken |
| `--host <host>` | `127.0.0.1` | address to listen on |
| `--local` | off | sync on edrys-dev's own port instead of edrys-Lite's default transport |
| `-o, --open` | off | open the lab in the browser |
| `--mcp` | off | serve an AI agent over stdio, see above |

## Development

```bash
npm install
npm run build    # tsc → dist/
npm test         # builds, then runs test/*.test.js
```

For now edrys-Lite and the edrys websocket-server (optional, only used by `--local`) come from sibling checkouts (`file:../edrys-Lite`, `file:../websocket-server`); build edrys-Lite first (`npm run build` there), since its `dist/` is what edrys-dev serves, including the transport defaults from its `.env`.
