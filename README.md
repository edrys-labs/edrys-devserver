# edrys-dev

Develop an [edrys-Lite](https://github.com/edrys-labs/edrys-Lite) lab on your own machine. `edrys-dev` serves edrys-Lite from localhost and keeps a class in step with your lab file: save `lab.yml` and the class updates in every open tab.

```bash
npm install -g @edryslabs/edrys-dev
edrys-dev lab.yml --open
```

Or without installing: `npx @edryslabs/edrys-dev lab.yml --open`. Needs Node.js 20 or newer.

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
    "edrys": { "command": "npx", "args": ["-y", "@edryslabs/edrys-dev", "--mcp", "lab.yml"] }
  }
}
```

With edrys-dev installed globally, `"command": "edrys-dev", "args": ["--mcp", "lab.yml"]` starts faster.

Tools: `get_state` (lab file, class URL, share link, the class: rooms, users, modules), `goto` (move the class tab to a room, open a student or station tab), `chat` and `read_chat`, `read_messages` (module messages the class tab saw, and errors of local modules), `read_module_state` (what the modules share in a room), `run_in_module` (JavaScript in a local module's frame, only when you ask for it), `wait_for_event`. Browser events reach Claude Code as channel messages; agents without channels read the event stream in `get_state.events` (e.g. with a Monitor) or call `wait_for_event`. Nothing wakes an idle agent of the second kind, so the MCP prompt `chat` (in VS Code: `/mcp.edrys-dev.chat` in the Copilot chat) starts a loop that waits for your messages and answers them. If the port is taken, the next free one is used; the agent finds the URL with `get_state`.

The class tab gets a chat panel (🤖, bottom right) where you and the agent talk; it is not the class's own chat, nobody else sees it. The agent can ask with buttons or checkboxes there. Below the messages, "Waiting for the agent…" shows until the agent takes your message, then "Thinking…"; after 30 s without a reaction a hint says that maybe no agent is listening (your message is saved and answered once one starts). edrys-dev only takes chat messages from its own page, opened at a local address (`localhost`, `127.0.0.1`), so other websites and other programs cannot write to the agent as you; keep `--host` at its default for that. Every chat is saved as a file in `.edrys-dev/chats/` next to the lab, so a restarted agent can read it; add `.edrys-dev/` to the lab's `.gitignore`. A restart continues the last chat; the menu at the top of the panel starts a new one or reopens an older one, and the agent is told which. The `chat.json` of an older edrys-dev becomes the first saved chat.

The tools show the agent whether the lab works; what to write comes from the [edrys skills](https://github.com/edrys-labs/skills), recommended with edrys-dev: `edrys-lab` for labs, `edrys-module` for modules. Both say how to use edrys-dev when it is connected.

```bash
npx skills add edrys-labs/skills
```

## Options

| Option | Default | |
|---|---|---|
| `[lab.yml]`, `-i, --input <file>` | `./lab.yml` | lab file, YAML or JSON |
| `-p, --port <port>` | `3210` | the next free port is used if it is taken |
| `--host <host>` | `127.0.0.1` | address to listen on; another one (e.g. `0.0.0.0`) lets others on the network open the class, and with `--mcp` type to the agent in its chat |
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

edrys-Lite comes from npm as [`@edryslabs/edrys-lite`](https://www.npmjs.com/package/@edryslabs/edrys-lite), pinned to one version: its `dist/` is what edrys-dev serves. To try changes to edrys-Lite, build it (`npm run build` there) and link the checkout with `npm install ../edrys-Lite`; pin the published version again afterwards. The same goes for [`@edryslabs/websocket-server`](https://www.npmjs.com/package/@edryslabs/websocket-server), an optional dependency that only `--local` uses.

## License

[MIT](LICENSE). The MCP server and the agent chat follow [LiaScript DevServer](https://github.com/LiaScript/LiaScript-DevServer) (MIT).
