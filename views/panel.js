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
  const WIDTH_KEY = 'edrys-dev:chat-width'
  const WIDTH = 400
  const MIN_WIDTH = 320
  // the class keeps at least this much of the window
  const PAGE_MIN = 360

  // sparkles, not the robot: that one is the students' tutor
  const SPARKLES = '<svg class="sparkles" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6c.7 4 2.6 6 7 7-4.4 1-6.3 3-7 7-.7-4-2.6-6-7-7 4.4-1 6.3-3 7-7zM18 2.5v5M15.5 5h5"></path></svg>'
  const CHEVRON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>'
  const WARN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20zM12 10v4M12 17h.01"></path></svg>'
  const ERROR = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>`

  const host = document.createElement('edrys-dev-chat')
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <link rel="stylesheet" href="/edrys-dev/panel.css">
    <div class="wrap" hidden>
      <button class="toggle" type="button" aria-expanded="false" aria-controls="panel" aria-label="Agent chat">
        ${SPARKLES}<span class="dot"></span>
      </button>
      <section class="panel" id="panel" aria-label="edrys-dev">
        <div class="resize" role="separator" aria-orientation="vertical" aria-label="Panel width" aria-valuemin="320" tabindex="0" title="Drag to resize, double-click to reset"></div>
        <header>
          <div class="tabs" role="tablist" aria-label="View">
            <button type="button" role="tab" data-view="agent" aria-controls="agent">Agent</button>
            <button type="button" role="tab" data-view="students" aria-controls="students">Students<span class="count"></span></button>
          </div>
          <span class="spacer"></span>
          <span class="private" title="edrys-dev: not the class's chat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>
            Only you see this
          </span>
          <button class="icon-btn close" type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
          </button>
        </header>
        <div class="top">
          <div class="select">
            <label for="sessions" hidden>Chat</label>
            <select id="sessions"></select>
            ${CHEVRON.replace('width="20" height="20"', 'width="16" height="16"')}
          </div>
          <div class="share" hidden>
            <label class="label" for="link">Link for students</label>
            <div class="row" hidden>
              <input id="link" class="mono" readonly>
              <button class="outline" type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a1 1 0 0 1 1-1h10"></path></svg>
                <span>Copy</span>
              </button>
            </div>
            <div class="warn-note" aria-live="polite">${WARN}<span></span></div>
          </div>
          <div class="tutor" hidden>
            <label class="switch"><input type="checkbox" id="tutor-on"><span class="track"></span>Tutor answers students</label>
            <div class="note" aria-live="polite"></div>
            <div class="alert warn limit" aria-live="polite">${WARN}<span></span></div>
          </div>
        </div>
        <div class="view" id="agent" role="tabpanel">
          <div class="problem" role="alert" hidden></div>
          <div class="log" role="log" aria-live="polite"></div>
          <div class="status" aria-live="polite"><svg width="14" height="14" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="8" fill="none" stroke="var(--track)" stroke-width="3"></circle><path d="M11 3a8 8 0 0 1 8 8" fill="none" stroke="var(--fg-2)" stroke-width="3" stroke-linecap="round"></path></svg><span></span></div>
          <div class="hint" aria-live="polite"></div>
          <form class="compose">
            <label class="label" for="text">Message to the agent (Enter to send)</label>
            <textarea id="text" rows="2"></textarea>
            <button class="send" type="submit" disabled>Send</button>
          </form>
        </div>
        <div class="view" id="students" role="tabpanel" hidden>
          <div class="threads" role="log" aria-live="polite"></div>
        </div>
      </section>
    </div>`

  document.documentElement.appendChild(host)

  // docked on the right like edrys-Lite's chats: <body> gets narrower by the
  // panel's width, and its transform makes it the box edrys-Lite's fixed
  // parts (app bar, drawers, dialogs) are placed in; as a scroll box (with
  // no bar) it is also the one Vuetify keeps its menus within. Phones get the
  // panel full screen over the page
  const pageStyle = document.createElement('style')
  pageStyle.textContent = `
    @media (min-width: 600px) {
      html.edrys-dev-docked body {
        width: calc(100% - var(--edrys-dev-chat)) !important; transform: translateZ(0);
        overflow-y: scroll; scrollbar-width: none;
      }
      html.edrys-dev-docked body::-webkit-scrollbar { display: none; }
    }
    html.edrys-dev-resizing, html.edrys-dev-resizing * { cursor: col-resize !important; user-select: none !important; }
    html.edrys-dev-resizing iframe { pointer-events: none; }`
  document.head.appendChild(pageStyle)

  // shown once panel.css is there, not unstyled over the page before
  const wrap = root.querySelector('.wrap')
  root.querySelector('link').addEventListener('load', () => (wrap.hidden = false))

  // the shadows differ between edrys-Lite's themes, the colors follow by themselves
  const followTheme = () => wrap.classList.toggle('dark', document.documentElement.dataset.theme === 'dark')
  new MutationObserver(followTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  followTheme()

  const toggle = root.querySelector('.toggle')
  const panel = root.querySelector('.panel')
  const log = root.querySelector('.log')
  const statusLine = root.querySelector('.status')
  const statusText = statusLine.querySelector('span')
  const hintLine = root.querySelector('.hint')
  const problemBox = root.querySelector('.problem')
  const compose = root.querySelector('.compose')
  const textarea = root.querySelector('textarea')
  const sendButton = root.querySelector('.send')
  const menu = root.querySelector('#sessions')
  const menuBox = root.querySelector('.select')
  const tabs = [...root.querySelectorAll('.tabs button')]
  const count = root.querySelector('.tabs .count')
  const tutorPart = root.querySelector('.tutor')
  const tutorBox = root.querySelector('#tutor-on')
  const tutorNote = root.querySelector('.tutor .note')
  const limitNote = root.querySelector('.tutor .limit span')
  const threadList = root.querySelector('.threads')
  const shareBox = root.querySelector('.share')
  const shareRow = shareBox.querySelector('.row')
  const shareInput = shareBox.querySelector('input')
  const shareButton = shareBox.querySelector('button')
  const shareLabel = shareButton.querySelector('span')
  const shareNote = shareBox.querySelector('.warn-note span')

  // the link for students with the agent; in the students view only without it
  let hasLink = false
  function showShare() {
    shareBox.hidden = !hasLink || (view === 'students' && hasChat)
  }

  // the views there are; the tabs only when there are two
  let view = null
  function showView(name) {
    view = name
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.view === name))
    root.querySelector('#agent').hidden = name !== 'agent'
    root.querySelector('#students').hidden = name !== 'students'
    menuBox.hidden = name !== 'agent'
    tutorPart.hidden = name !== 'students'
    showShare()
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
    title.removeAttribute('role')
    title.className = 'title'
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

  // the width the user dragged to, kept within the window by fit()
  const resizer = root.querySelector('.resize')
  let wanted = WIDTH
  try {
    wanted = Number(localStorage.getItem(WIDTH_KEY)) || WIDTH
  } catch {}
  function fit() {
    const width = Math.round(Math.max(MIN_WIDTH, Math.min(wanted, innerWidth - PAGE_MIN)))
    document.documentElement.style.setProperty('--edrys-dev-chat', width + 'px')
    resizer.setAttribute('aria-valuenow', String(width))
    return width
  }
  function setWidth(width) {
    wanted = width
    wanted = fit()
    try {
      localStorage.setItem(WIDTH_KEY, String(wanted))
    } catch {}
  }
  addEventListener('resize', fit)
  fit()

  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    resizer.setPointerCapture(event.pointerId)
    resizer.classList.add('dragging')
    document.documentElement.classList.add('edrys-dev-resizing')
  })
  resizer.addEventListener('pointermove', (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return
    wanted = innerWidth - event.clientX
    fit()
  })
  resizer.addEventListener('lostpointercapture', () => {
    resizer.classList.remove('dragging')
    document.documentElement.classList.remove('edrys-dev-resizing')
    setWidth(wanted)
  })
  resizer.addEventListener('dblclick', () => setWidth(WIDTH))
  resizer.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: 16, ArrowRight: -16 }[event.key]
    if (!step) return
    event.preventDefault()
    setWidth(fit() + step)
  })

  function setOpen(isOpen) {
    panel.classList.toggle('open', isOpen)
    document.documentElement.classList.toggle('edrys-dev-docked', isOpen)
    toggle.setAttribute('aria-expanded', String(isOpen))
    if (isOpen) toggle.classList.remove('unread')
    if (isOpen && view === 'students') count.textContent = ''
    try {
      sessionStorage.setItem(OPEN_KEY, isOpen ? '1' : '')
    } catch {}
  }
  // the button stays in the class's corner, left of the drawers edrys-Lite
  // opens on the right (class chat, tutor), which Vuetify gives v-main as
  // --v-layout-right; checked once a frame at most, on any change of a style
  let placing = false
  function placeToggle() {
    if (placing) return
    placing = true
    requestAnimationFrame(() => {
      placing = false
      const main = document.querySelector('.v-main')
      const right = main ? parseFloat(getComputedStyle(main).getPropertyValue('--v-layout-right')) || 0 : 0
      toggle.style.setProperty('--drawers', right + 'px')
    })
  }
  new MutationObserver(placeToggle).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style'],
  })
  placeToggle()

  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')))
  root.querySelector('.close').addEventListener('click', () => {
    setOpen(false)
    toggle.focus()
  })
  setOpen(sessionStorage.getItem(OPEN_KEY) === '1')

  // the response, or null if edrys-dev could not be reached
  function post(body) {
    return fetch('/edrys-dev/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
  }

  // the agent's progress, with a spinner; or the panel's own note, without
  function setStatus(text, busy) {
    statusText.textContent = text
    statusLine.classList.toggle('busy', busy)
  }

  // shown in the status line until the agent sets the next one
  function notSent() {
    setStatus('Not sent: is edrys-dev still running? Try again.', false)
  }

  const canSend = () => (sendButton.disabled = !textarea.value.trim())
  textarea.addEventListener('input', canSend)

  compose.addEventListener('submit', async (event) => {
    event.preventDefault()
    const text = textarea.value.trim()
    if (!text) return
    textarea.value = ''
    canSend()
    const response = await post({ text })
    if (response?.ok) return
    // back into the box, unless the user typed something new meanwhile
    if (!textarea.value) textarea.value = text
    canSend()
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
    // one row of buttons: the first one filled, like a dialog's main action
    const single = entry.inputs.length === 1 && entry.inputs[0].type === 'buttons'
    if (single) form.className = 'single'

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
    pre.className = 'mono'
    pre.textContent = problem.detail
    details.append(summary, pre)
    const body = document.createElement('div')
    body.append(text, details)
    problemBox.innerHTML = ERROR(18)
    problemBox.appendChild(body)
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
          setStatus(message.status, true)
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
          setStatus(message.text, true)
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
    note.textContent = 'No questions yet. Students ask with the tutor button in the class.'
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
      summary.innerHTML = `<span class="initial" aria-hidden="true"></span><span class="who"><span class="name"></span><span class="where"></span></span>${CHEVRON.replace('width="20" height="20"', 'width="16" height="16"')}`
      const entries = document.createElement('div')
      entries.className = 'entries'
      box.append(summary, entries)
      thread = { box, summary, entries }
      threads.set(id, thread)
      emptyNote()
    }
    // the name is the student's choice: text only
    thread.summary.querySelector('.initial').textContent = [...name.trim()][0]?.toUpperCase() || '?'
    thread.summary.querySelector('.name').textContent = name
    thread.summary.querySelector('.where').textContent = [thread.room, thread.last && time(thread.last)].filter(Boolean).join(' · ')
    threadList.prepend(thread.box)
    return thread
  }

  function showTutorEntry(thread, entry) {
    const div = document.createElement('div')
    const meta = document.createElement('span')
    meta.className = 'meta'
    if (entry.from === 'student') {
      meta.textContent = time(entry.t)
      div.className = 'msg student'
      div.append(meta, entry.text)
    } else {
      meta.textContent = 'Tutor · ' + time(entry.t)
      div.className = 'msg tutor'
      div.append(meta, render(entry.text))
    }
    thread.entries.appendChild(div)
    thread.last = entry.t
    if (entry.room) thread.room = entry.room
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
      ? 'Students see the tutor button while this tab is open.'
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
          div.className = 'alert danger'
          div.innerHTML = ERROR(14)
          const text = document.createElement('span')
          text.textContent = 'No answer: ' + message.error
          div.appendChild(text)
          thread.entries.appendChild(div)
          break
        }
        case 'on':
          showSwitch(message.on)
          break
        case 'limit':
          limitNote.textContent = `The class reached its limit of ${message.perHour} questions this hour: more get no answer for now. Start edrys-dev with --tutor-per-hour to change it.`
          if (!panel.classList.contains('open')) toggle.classList.add('unread')
          break
      }
    }
  }

  // --- the link for students: the class's share link would only work on this computer ---
  function showLink({ reachable, link, local_urls }) {
    hasLink = true
    showShare()
    shareRow.hidden = shareBox.querySelector('.label').hidden = !link
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
    shareLabel.textContent = copied ? 'Copied' : 'Select and copy it'
    setTimeout(() => (shareLabel.textContent = 'Copy'), 2000)
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
