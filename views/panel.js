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
  // the chat only with an agent to answer it (edrys-dev --mcp), the students
  // view only with a tutor (--tutor)
  const script = document.currentScript
  const hasChat = !!script && script.hasAttribute('data-chat')
  const hasTutor = !!script && script.hasAttribute('data-tutor')
  if (!hasChat && !hasTutor) return

  const OPEN_KEY = 'edrys-dev:chat-open'
  const VIEW_KEY = 'edrys-dev:chat-view'

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
      padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--line);
      font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px;
    }
    header small { font-weight: 400; color: var(--muted); white-space: nowrap; }
    .tabs { display: flex; gap: 2px; }
    .tabs button {
      font: inherit; font-size: 13px; padding: 3px 8px; border-radius: 6px; cursor: pointer;
      border: 1px solid transparent; background: transparent; color: var(--muted);
    }
    .tabs button[aria-selected="true"] { border-color: var(--line); color: var(--fg); font-weight: 600; }
    .tabs .count { display: inline-block; min-width: 16px; padding: 0 4px; margin-left: 2px; border-radius: 8px;
      background: #e0452b; color: #fff; font-size: 11px; font-weight: 600; }
    .tabs .count:empty { display: none; }
    .spacer { flex: 1; }
    .view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .view[hidden] { display: none; }
    .share { padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 13px; }
    .share[hidden] { display: none; }
    .share .row { display: flex; gap: 6px; align-items: center; }
    .share .row[hidden] { display: none; }
    .share .row span { font-weight: 600; white-space: nowrap; }
    .share input {
      flex: 1; min-width: 0; font: 12px ui-monospace, monospace; padding: 4px 6px; border-radius: 6px;
      border: 1px solid var(--line); background: var(--bg); color: var(--fg);
    }
    .share button {
      font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer;
      border: 1px solid var(--accent); background: transparent; color: var(--accent);
    }
    .share .note { margin-top: 2px; color: var(--muted); font-size: 12px; }
    .share .note:empty { display: none; }
    .switch { padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 13px; }
    .switch label { display: flex; gap: 6px; align-items: center; font-weight: 600; }
    .switch .note { margin-top: 2px; color: var(--muted); font-size: 12px; }
    .threads { flex: 1; overflow-y: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    .threads .empty { color: var(--muted); font-size: 13px; }
    .thread { border: 1px solid var(--line); border-radius: 8px; }
    .thread summary { padding: 6px 10px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .thread summary small { font-weight: 400; color: var(--muted); }
    .thread .entries { padding: 0 8px 8px; display: flex; flex-direction: column; gap: 6px; }
    .msg.student { background: var(--me); color: var(--me-fg); align-self: flex-end; white-space: pre-wrap; }
    .msg.tutor { background: var(--ai); align-self: flex-start; }
    .msg .meta { display: block; font-size: 11px; opacity: .75; margin-bottom: 2px; white-space: normal; }
    .msg.failed { align-self: stretch; font-size: 12px; border: 1px solid #e0452b; background: rgba(224,69,43,.1); }
    header select {
      flex: 1; min-width: 0; font-size: 13px; padding: 3px 4px; border-radius: 6px;
      border: 1px solid var(--line); background: var(--bg); color: var(--fg);
    }
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
    .problem { margin: 0 12px 8px; padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 1.4;
      border: 1px solid #e0452b; background: rgba(224,69,43,.1); }
    .problem[hidden] { display: none; }
    .problem summary { cursor: pointer; color: var(--muted); font-size: 12px; margin-top: 4px; }
    .problem pre { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px ui-monospace, monospace; }
    .status { padding: 0 12px 6px; font-size: 12px; color: var(--muted); min-height: 1em; }
    .hint { padding: 0 12px 6px; font-size: 12px; color: var(--muted); font-style: italic; }
    .hint:empty { display: none; }
    .reason { margin-top: 4px; font-size: 12px; color: var(--muted); }
    .skipped { align-self: center; font-size: 12px; color: var(--muted); }
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
      <button class="toggle" type="button" aria-expanded="false" aria-controls="panel" aria-label="edrys-dev">
        🤖<span class="dot"></span>
      </button>
      <section class="panel" id="panel" aria-label="edrys-dev">
        <header>
          <div class="tabs" role="tablist">
            <button type="button" role="tab" data-view="agent" aria-controls="agent">Agent</button>
            <button type="button" role="tab" data-view="students" aria-controls="students">Students<span class="count"></span></button>
          </div>
          <label for="sessions" hidden>Chats</label>
          <select id="sessions"></select>
          <span class="spacer"></span>
          <small title="edrys-dev: not the class's chat">only you see this</small>
        </header>
        <div class="share" hidden>
          <div class="row" hidden>
            <span>Link for students</span>
            <input readonly aria-label="Link for your students">
            <button type="button">Copy</button>
          </div>
          <div class="note" aria-live="polite"></div>
        </div>
        <div class="view" id="agent" role="tabpanel">
          <div class="log" role="log" aria-live="polite"></div>
          <div class="problem" role="alert" hidden></div>
          <div class="status" aria-live="polite"></div>
          <div class="hint" aria-live="polite"></div>
          <form class="compose">
            <label for="text" hidden>Message to the agent</label>
            <textarea id="text" placeholder="Message to the agent (Enter sends)"></textarea>
            <button type="submit">Send</button>
          </form>
        </div>
        <div class="view" id="students" role="tabpanel" hidden>
          <div class="switch">
            <label><input type="checkbox" id="tutor-on"> Tutor answers students</label>
            <div class="note" aria-live="polite"></div>
          </div>
          <div class="threads" role="log" aria-live="polite"></div>
        </div>
      </section>
    </div>`
  document.documentElement.appendChild(host)

  const toggle = root.querySelector('.toggle')
  const panel = root.querySelector('.panel')
  const log = root.querySelector('.log')
  const statusLine = root.querySelector('.status')
  const hintLine = root.querySelector('.hint')
  const problemBox = root.querySelector('.problem')
  const compose = root.querySelector('.compose')
  const textarea = root.querySelector('textarea')
  const menu = root.querySelector('#sessions')
  const tabs = [...root.querySelectorAll('.tabs button')]
  const count = root.querySelector('.tabs .count')
  const tutorBox = root.querySelector('#tutor-on')
  const tutorNote = root.querySelector('.switch .note')
  const threadList = root.querySelector('.threads')

  // the views there are; the tabs only when there are two
  let view = null
  function showView(name) {
    view = name
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.view === name))
    root.querySelector('#agent').hidden = name !== 'agent'
    root.querySelector('#students').hidden = name !== 'students'
    menu.hidden = name !== 'agent'
    // the menu fills the header; without it, the note goes right
    root.querySelector('.spacer').hidden = name === 'agent'
    if (name === 'students') count.textContent = ''
    try {
      sessionStorage.setItem(VIEW_KEY, name)
    } catch {}
  }
  for (const tab of tabs) {
    tab.hidden = !(hasChat && hasTutor) || (tab.dataset.view === 'agent' ? !hasChat : !hasTutor)
    tab.addEventListener('click', () => showView(tab.dataset.view))
  }
  if (!(hasChat && hasTutor)) {
    // one view: its name as the title
    const title = root.querySelector('.tabs')
    title.textContent = hasChat ? 'Agent' : 'Students'
  }
  let savedView = null
  try {
    savedView = sessionStorage.getItem(VIEW_KEY)
  } catch {}
  showView(!hasChat ? 'students' : !hasTutor ? 'agent' : savedView === 'students' ? 'students' : 'agent')

  let open = null // the ask id of the form the user can still answer
  let current = null // the chat shown, {id, title}
  let sessions = [] // the saved chats, the one changed last first

  const NEW = ''
  // + New chat, then the chats; the current one is new until it has a file
  function showMenu() {
    const option = (value, text) => {
      const o = document.createElement('option')
      o.value = value
      o.textContent = text
      return o
    }
    const options = [option(NEW, '+ New chat')]
    if (current && !sessions.some((s) => s.id === current.id)) options.push(option(current.id, 'New chat'))
    for (const s of sessions) options.push(option(s.id, s.title))
    menu.replaceChildren(...options)
    if (current) menu.value = current.id
  }

  menu.addEventListener('change', async () => {
    const response = await post({ session: menu.value === NEW ? null : menu.value })
    // the server sends the chat it shows now; otherwise back to the one before
    if (!response?.ok) {
      showMenu()
      notSent()
    } else if (menu.value === NEW) showMenu()
  })

  function setOpen(isOpen) {
    panel.classList.toggle('open', isOpen)
    toggle.setAttribute('aria-expanded', String(isOpen))
    if (isOpen) toggle.classList.remove('unread')
    if (isOpen && view === 'students') count.textContent = ''
    try {
      sessionStorage.setItem(OPEN_KEY, isOpen ? '1' : '')
    } catch {}
  }
  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')))
  setOpen(sessionStorage.getItem(OPEN_KEY) === '1')

  // the response, or null if edrys-dev could not be reached
  function post(body) {
    return fetch('/edrys-dev/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
  }

  // shown in the status line until the agent sets the next one
  function notSent() {
    statusLine.textContent = 'Not sent: is edrys-dev still running? Try again.'
  }

  compose.addEventListener('submit', async (event) => {
    event.preventDefault()
    const text = textarea.value.trim()
    if (!text) return
    textarea.value = ''
    const response = await post({ text })
    if (response?.ok) return
    // back into the box, unless the user typed something new meanwhile
    if (!textarea.value) textarea.value = text
    notSent()
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
      // closed in the meantime; otherwise the form stays, to send again
      if (response?.status === 409) disable(entry.ask)
      else if (!response?.ok) notSent()
    })

    if (entry.ask !== open) form.setAttribute('aria-disabled', 'true')
    return form
  }

  function disable(ask, reason) {
    root.querySelectorAll(`form[data-ask="${ask}"]`).forEach((form) => {
      form.setAttribute('aria-disabled', 'true')
      // why the agent closed it, shown only live
      if (reason && !form.nextElementSibling?.classList.contains('reason')) {
        const note = document.createElement('div')
        note.className = 'reason'
        note.textContent = reason
        form.after(note)
      }
    })
  }

  // the lab file does not load: until it does, in plain words, edrys-Lite's message folded
  function showProblem(problem) {
    problemBox.hidden = !problem
    if (!problem) return problemBox.replaceChildren()
    const text = document.createElement('div')
    text.textContent = problem.text
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = 'Details'
    const pre = document.createElement('pre')
    pre.textContent = problem.detail
    details.append(summary, pre)
    problemBox.replaceChildren(text, details)
    if (!panel.classList.contains('open')) toggle.classList.add('unread')
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
          current = message.session
          sessions = message.sessions
          showMenu()
          if (message.skipped) {
            const note = document.createElement('div')
            note.className = 'skipped'
            note.textContent = `${message.skipped} earlier messages not shown`
            log.appendChild(note)
          }
          message.entries.forEach(show)
          statusLine.textContent = message.status
          hintLine.textContent = message.hint || ''
          toggle.classList.remove('unread')
          showProblem(message.lab)
          break
        case 'lab':
          showProblem(message.problem)
          break
        case 'entry':
          if (message.entry.type === 'ai' && message.entry.ask) open = message.entry.ask
          if (message.entry.type === 'answer' && open === message.entry.ask) open = null
          show(message.entry)
          break
        case 'status':
          statusLine.textContent = message.text
          break
        case 'sessions':
          sessions = message.sessions
          showMenu()
          break
        case 'hint':
          hintLine.textContent = message.text
          break
        case 'close':
          if (open === message.ask) open = null
          disable(message.ask, message.reason)
          break
      }
    }
  }

  // --- the students' tutor threads ---

  const threads = new Map() // thread id → {box, entries, when}
  const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  function emptyNote() {
    if (threads.size) return threadList.querySelector('.empty')?.remove()
    const note = document.createElement('div')
    note.className = 'empty'
    note.textContent = 'No questions yet. Students ask with the 🤖 button in the class.'
    threadList.replaceChildren(note)
  }

  // the thread's box, moved to the top: the one changed last first
  function threadFor(id, name) {
    let thread = threads.get(id)
    if (!thread) {
      const box = document.createElement('details')
      box.className = 'thread'
      box.open = true
      const summary = document.createElement('summary')
      const entries = document.createElement('div')
      entries.className = 'entries'
      box.append(summary, entries)
      thread = { box, summary, entries }
      threads.set(id, thread)
      emptyNote()
    }
    // the name is the student's choice: text only
    const when = document.createElement('small')
    when.textContent = thread.last ? ' · ' + time(thread.last) : ''
    thread.summary.replaceChildren(name, when)
    threadList.prepend(thread.box)
    return thread
  }

  function showTutorEntry(thread, entry) {
    const div = document.createElement('div')
    const meta = document.createElement('span')
    meta.className = 'meta'
    meta.textContent = time(entry.t) + (entry.room ? ' · ' + entry.room : '')
    if (entry.from === 'student') {
      div.className = 'msg student'
      div.append(meta, entry.text)
    } else {
      div.className = 'msg tutor'
      div.append(meta, render(entry.text))
    }
    thread.entries.appendChild(div)
    thread.last = entry.t
  }

  function addTutorEntry(id, name, entry) {
    const thread = threadFor(id, name)
    showTutorEntry(thread, entry)
    threadFor(id, name)
    threadList.scrollTop = 0
    if (entry.from !== 'student') return
    if (view !== 'students' || !panel.classList.contains('open')) {
      count.textContent = String(Number(count.textContent || 0) + 1)
      if (!panel.classList.contains('open')) toggle.classList.add('unread')
    }
  }

  function showSwitch(on) {
    tutorBox.checked = on
    tutorNote.textContent = on
      ? 'Students see the 🤖 button while this tab is open.'
      : 'Off: students do not see the button, and questions get "The tutor is off".'
  }

  tutorBox.addEventListener('change', async () => {
    const on = tutorBox.checked
    const response = await fetch('/edrys-dev/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on }),
    }).catch(() => null)
    if (response?.ok) return
    showSwitch(!on)
    tutorNote.textContent = 'Not switched: is edrys-dev still running? Try again.'
  })

  function connectTutor() {
    const events = new EventSource('/edrys-dev/tutor/events')
    events.onmessage = (event) => {
      const message = JSON.parse(event.data)
      switch (message.type) {
        case 'threads':
          threads.clear()
          threadList.replaceChildren()
          showSwitch(message.on)
          // oldest first, so the newest ends up on top
          for (const saved of [...message.threads].reverse()) {
            const thread = threadFor(saved.id, saved.name)
            if (saved.skipped) {
              const note = document.createElement('div')
              note.className = 'skipped'
              note.textContent = `${saved.skipped} earlier messages not shown`
              thread.entries.appendChild(note)
            }
            saved.entries.forEach((entry) => showTutorEntry(thread, entry))
            threadFor(saved.id, saved.name)
          }
          emptyNote()
          break
        case 'entry':
          addTutorEntry(message.id, message.name, message.entry)
          break
        case 'failed': {
          // the reason is for the teacher; the student was told it failed
          const thread = threadFor(message.id, message.name)
          const div = document.createElement('div')
          div.className = 'msg failed'
          div.textContent = 'No answer: ' + message.error
          thread.entries.appendChild(div)
          break
        }
        case 'on':
          showSwitch(message.on)
          break
      }
    }
  }

  // --- the link for students: the class's share link would only work on this computer ---
  const shareBox = root.querySelector('.share')
  const shareRow = shareBox.querySelector('.row')
  const shareInput = shareBox.querySelector('input')
  const shareButton = shareBox.querySelector('button')
  const shareNote = shareBox.querySelector('.note')

  function showLink({ reachable, link, local_urls }) {
    shareBox.hidden = false
    shareRow.hidden = !link
    shareInput.value = link || ''
    const modules = local_urls.length
    shareNote.textContent = !reachable
      ? 'Students on other computers cannot join: edrys-dev runs with --local, which reaches this computer only.'
      : !link
        ? 'The link for students appears once the class is open.'
        : modules
          ? `${modules === 1 ? 'A module loads' : `${modules} modules load`} from this computer (localhost) and will not load for students: publish ${modules === 1 ? 'it' : 'them'} first.`
          : ''
  }

  shareInput.addEventListener('focus', () => shareInput.select())
  shareButton.addEventListener('click', async () => {
    let copied = false
    try {
      await navigator.clipboard.writeText(shareInput.value)
      copied = true
    } catch {
      shareInput.select()
      try {
        copied = document.execCommand('copy')
      } catch {}
    }
    shareButton.textContent = copied ? 'Copied' : 'Select and copy it'
    setTimeout(() => (shareButton.textContent = 'Copy'), 2000)
  })

  new EventSource('/edrys-dev/link/events').onmessage = (event) => showLink(JSON.parse(event.data))

  // the renderer first, then the messages that need it
  let loaded = 0
  for (const name of ['marked', 'purify']) {
    const script = document.createElement('script')
    script.src = `/edrys-dev/${name}.js`
    script.onload = () => {
      if (++loaded < 2) return
      if (hasChat) connect()
      if (hasTutor) connectTutor()
    }
    document.head.appendChild(script)
  }
})()
