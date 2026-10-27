// The agent chat over the class tab, injected by edrys-dev into edrys-Lite's
// page. It lives in a shadow root on <html>: edrys-Lite mounts its app into
// <body> again on every route, which would wipe anything put there.
;(function () {
  // only the tab opened with ?dev (DevBridge keeps that in sessionStorage);
  // student and station tabs only load again when a local module changed
  if (location.search !== '?dev' && !sessionStorage.getItem('edrys-dev')) {
    if (/^\?\/(classroom|station)\//.test(location.search)) {
      new EventSource('/edrys-dev/reload').addEventListener('reload-module', () => location.reload())
    }
    return
  }
  // the chat only with an agent to answer it (edrys-dev --mcp)
  if (!document.currentScript || !document.currentScript.hasAttribute('data-chat')) return

  const OPEN_KEY = 'edrys-dev:chat-open'

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .wrap {
      --bg: #fff; --fg: #1d1d1f; --muted: #6b6b70; --line: #d9d9de;
      --ai: #f2f2f5; --me: #1f5fbf; --me-fg: #fff; --accent: #1f5fbf;
      color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .wrap {
        --bg: #1e1e21; --fg: #ececf0; --muted: #a0a0a8; --line: #3a3a40;
        --ai: #2a2a2f; --me: #3d7be0; --me-fg: #fff; --accent: #6ea2ff;
      }
    }
    .toggle {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--line);
      background: var(--bg); color: var(--fg); font-size: 22px; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.25);
    }
    .toggle .dot {
      position: absolute; top: 4px; right: 4px; width: 10px; height: 10px;
      border-radius: 50%; background: #e0452b; display: none;
    }
    .toggle.unread .dot { display: block; }
    .panel {
      position: fixed; right: 16px; bottom: 76px; z-index: 2147483000;
      width: min(380px, calc(100vw - 32px)); height: min(520px, calc(100vh - 100px));
      display: none; flex-direction: column; background: var(--bg);
      border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,.3);
    }
    .panel.open { display: flex; }
    header {
      padding: 10px 14px; border-bottom: 1px solid var(--line);
      font-size: 14px; font-weight: 600; display: flex; justify-content: space-between;
    }
    header small { font-weight: 400; color: var(--muted); }
    .log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .msg { max-width: 88%; padding: 8px 11px; border-radius: 10px; font-size: 14px; line-height: 1.4;
      overflow-wrap: anywhere; }
    .msg.ai { background: var(--ai); align-self: flex-start; }
    .msg.user, .msg.answer { background: var(--me); color: var(--me-fg); align-self: flex-end; white-space: pre-wrap; }
    .msg p { margin: 0 0 6px; } .msg p:last-child { margin-bottom: 0; }
    .msg pre { overflow-x: auto; background: rgba(127,127,127,.15); padding: 6px; border-radius: 6px; }
    .msg code { font-family: ui-monospace, monospace; font-size: 13px; }
    .msg a { color: var(--accent); }
    .msg form { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    legend { font-size: 13px; color: var(--muted); margin-bottom: 4px; }
    label.option { font-size: 14px; display: flex; gap: 6px; align-items: center; width: 100%; }
    button.choice, button.submit {
      font-size: 13px; padding: 5px 10px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--accent); background: transparent; color: var(--accent);
    }
    .msg form[aria-disabled="true"] { opacity: .5; pointer-events: none; }
    .status { padding: 0 12px 6px; font-size: 12px; color: var(--muted); min-height: 1em; }
    .compose { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--line); }
    textarea {
      flex: 1; resize: none; height: 40px; padding: 8px; font-size: 14px; border-radius: 8px;
      border: 1px solid var(--line); background: var(--bg); color: var(--fg);
    }
    .compose button {
      padding: 0 14px; border-radius: 8px; border: 0; background: var(--accent); color: #fff; cursor: pointer;
    }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `

  const host = document.createElement('edrys-dev-chat')
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${css}</style>
    <div class="wrap">
      <button class="toggle" type="button" aria-expanded="false" aria-controls="panel" aria-label="Agent chat">
        🤖<span class="dot"></span>
      </button>
      <section class="panel" id="panel" aria-label="Agent chat">
        <header>Agent <small>edrys-dev, only you see this</small></header>
        <div class="log" role="log" aria-live="polite"></div>
        <div class="status" aria-live="polite"></div>
        <form class="compose">
          <label for="text" hidden>Message to the agent</label>
          <textarea id="text" placeholder="Message to the agent (Enter sends)"></textarea>
          <button type="submit">Send</button>
        </form>
      </section>
    </div>`
  document.documentElement.appendChild(host)

  const toggle = root.querySelector('.toggle')
  const panel = root.querySelector('.panel')
  const log = root.querySelector('.log')
  const statusLine = root.querySelector('.status')
  const compose = root.querySelector('.compose')
  const textarea = root.querySelector('textarea')

  let open = null // the ask id of the form the user can still answer

  function setOpen(isOpen) {
    panel.classList.toggle('open', isOpen)
    toggle.setAttribute('aria-expanded', String(isOpen))
    if (isOpen) toggle.classList.remove('unread')
    try {
      sessionStorage.setItem(OPEN_KEY, isOpen ? '1' : '')
    } catch {}
  }
  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')))
  setOpen(sessionStorage.getItem(OPEN_KEY) === '1')

  function post(body) {
    return fetch('/edrys-dev/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  compose.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = textarea.value.trim()
    if (!text) return
    textarea.value = ''
    post({ text })
  })
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      compose.requestSubmit()
    }
  })

  // the agent writes Markdown; nothing it relays may run in this page
  function render(markdown) {
    const html = window.DOMPurify.sanitize(window.marked.parse(markdown))
    const div = document.createElement('div')
    div.innerHTML = html
    div.querySelectorAll('a').forEach((a) => {
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    })
    return div
  }

  function formFor(entry) {
    const form = document.createElement('form')
    form.dataset.ask = entry.ask
    const values = {}
    const single = entry.inputs.length === 1 && entry.inputs[0].type === 'buttons'

    for (const input of entry.inputs) {
      const set = document.createElement('fieldset')
      if (input.label) {
        const legend = document.createElement('legend')
        legend.textContent = input.label
        set.appendChild(legend)
      }
      for (const option of input.options) {
        if (input.type === 'buttons') {
          const button = document.createElement('button')
          button.type = single ? 'submit' : 'button'
          button.className = 'choice'
          button.textContent = option
          button.addEventListener('click', () => {
            values[input.id] = option
            set.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))
          })
          set.appendChild(button)
        } else {
          const label = document.createElement('label')
          label.className = 'option'
          const box = document.createElement('input')
          box.type = input.type
          box.name = entry.ask + '-' + input.id
          box.value = option
          label.append(box, option)
          set.appendChild(label)
        }
      }
      form.appendChild(set)
    }

    if (!single) {
      const submit = document.createElement('button')
      submit.type = 'submit'
      submit.className = 'submit'
      submit.textContent = 'Send'
      form.appendChild(submit)
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      for (const input of entry.inputs) {
        if (input.type === 'buttons') continue
        const checked = [...form.querySelectorAll(`input[name="${entry.ask}-${input.id}"]:checked`)].map((b) => b.value)
        values[input.id] = input.type === 'radio' ? checked[0] ?? '' : checked
      }
      const response = await post({ ask: entry.ask, values })
      if (!response.ok) disable(entry.ask)
    })

    if (entry.ask !== open) form.setAttribute('aria-disabled', 'true')
    return form
  }

  function disable(ask) {
    root.querySelectorAll(`form[data-ask="${ask}"]`).forEach((form) => form.setAttribute('aria-disabled', 'true'))
  }

  function show(entry) {
    const div = document.createElement('div')
    div.className = 'msg ' + entry.type
    if (entry.type === 'ai') {
      div.appendChild(render(entry.markdown))
      if (entry.ask) div.appendChild(formFor(entry))
    } else if (entry.type === 'user') {
      div.textContent = entry.text
    } else if (entry.type === 'answer') {
      disable(entry.ask)
      div.textContent = Object.values(entry.values).flat().join(', ')
    }
    log.appendChild(div)
    log.scrollTop = log.scrollHeight
    if (!panel.classList.contains('open') && entry.type === 'ai') toggle.classList.add('unread')
  }

  function connect() {
    const events = new EventSource('/edrys-dev/chat/events')
    events.onmessage = (event) => {
      const message = JSON.parse(event.data)
      switch (message.type) {
        case 'history':
          log.replaceChildren()
          open = message.open
          message.entries.forEach(show)
          statusLine.textContent = message.status
          toggle.classList.remove('unread')
          break
        case 'entry':
          if (message.entry.type === 'ai' && message.entry.ask) open = message.entry.ask
          if (message.entry.type === 'answer' && open === message.entry.ask) open = null
          show(message.entry)
          break
        case 'status':
          statusLine.textContent = message.text
          break
        case 'close':
          if (open === message.ask) open = null
          disable(message.ask)
          break
      }
    }
  }

  // the renderer first, then the messages that need it
  let loaded = 0
  for (const name of ['marked', 'purify']) {
    const script = document.createElement('script')
    script.src = `/edrys-dev/${name}.js`
    script.onload = () => ++loaded === 2 && connect()
    document.head.appendChild(script)
  }
})()
