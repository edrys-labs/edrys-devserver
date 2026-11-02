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

  // edrys-Lite's colors: Vuetify puts the theme's on :root as `--v-theme-<name>`
  // (r,g,b), and they reach into the shadow root; the fallbacks are its Light
  // theme, for an edrys-Lite without them
  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Noto Sans Variable', 'Noto Sans', system-ui, sans-serif; }
    .wrap {
      --panel: rgb(var(--v-theme-panel, 243,243,243));
      --panel-line: rgb(var(--v-theme-panel-line, 222,222,222));
      --card: rgb(var(--v-theme-message, 255,255,255));
      --card-edge: rgb(var(--v-theme-module-edge, 228,230,234));
      --tonal: rgb(var(--v-theme-tonal, 235,235,235));
      --segment: rgb(var(--v-theme-segment, 255,255,255));
      --field: rgb(var(--v-theme-field, 255,255,255));
      --field-line: rgb(var(--v-theme-field-line, 196,196,196));
      --track: rgb(var(--v-theme-track, 222,222,222));
      --fg: rgb(var(--v-theme-on-surface, 27,32,41));
      --fg-2: rgb(var(--v-theme-text-2, 59,66,77));
      --muted: rgb(var(--v-theme-muted, 95,103,115));
      --faint: rgb(var(--v-theme-faint, 160,166,174));
      --primary: rgb(var(--v-theme-primary, 54,100,190));
      --on-primary: rgb(var(--v-theme-on-primary, 255,255,255));
      --own: rgb(var(--v-theme-own-message, 238,244,254));
      --you: rgb(var(--v-theme-you, 44,86,168));
      --badge: rgb(var(--v-theme-badge, 230,67,67));
      --danger-bg: rgb(var(--v-theme-danger-tint, 255,231,228));
      --danger: rgb(var(--v-theme-error, 183,24,36));
      --warn-bg: rgb(var(--v-theme-warning-tint, 254,229,179));
      --warn: rgb(var(--v-theme-warning, 93,57,4));
      --focus: rgb(var(--v-theme-focus, 54,100,190));
      --link: rgb(var(--v-theme-link, 0,87,154));
      --msg-shadow: 0 1px 2px rgba(20,25,35,.06), 0 0 0 1px rgb(var(--v-theme-message-edge, 232,234,237));
      --card-shadow: 0 1px 2px rgba(20,25,35,.05), 0 0 0 1px var(--card-edge);
      --pop-shadow: 0 12px 32px rgba(20,25,35,.14), 0 0 0 1px var(--card-edge);
      color: var(--fg);
    }
    .wrap.dark {
      --msg-shadow: none;
      --card-shadow: 0 0 0 1px rgb(var(--v-theme-module-line, 44,51,61));
      --pop-shadow: 0 12px 32px rgba(0,0,0,.45), 0 0 0 1px rgb(var(--v-theme-line, 57,65,76));
    }
    svg { flex-shrink: 0; }
    [hidden] { display: none !important; }
    button { font: inherit; cursor: pointer; }
    .mono { font-family: 'JetBrains Mono Variable', ui-monospace, monospace; }

    .toggle {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      width: 52px; height: 52px; border-radius: 50%; border: 0;
      background: var(--primary); color: var(--on-primary);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 6px 16px rgba(20,25,35,.25);
    }
    .toggle .dot {
      position: absolute; top: 3px; right: 3px; width: 12px; height: 12px;
      border-radius: 50%; background: var(--badge); box-shadow: 0 0 0 2px var(--panel); display: none;
    }
    .toggle.unread .dot { display: block; }
    .toggle .chevron { display: none; }
    .toggle[aria-expanded="true"] {
      border: 1px solid var(--field-line); background: var(--field); color: var(--fg-2);
      box-shadow: 0 6px 16px rgba(20,25,35,.15);
    }
    .toggle[aria-expanded="true"] .sparkles { display: none; }
    .toggle[aria-expanded="true"] .chevron { display: block; }

    .panel {
      position: fixed; right: 16px; bottom: 80px; z-index: 2147483000;
      width: min(400px, calc(100vw - 32px)); height: min(700px, calc(100vh - 100px));
      display: none; flex-direction: column; background: var(--panel);
      border-radius: 16px; overflow: hidden; box-shadow: var(--pop-shadow);
    }
    .panel.open { display: flex; }
    header {
      display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 8px 0 12px; flex-shrink: 0;
      border-bottom: 1px solid var(--panel-line);
    }
    .title { font-size: 14px; font-weight: 600; }
    .tabs { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--tonal); }
    .tabs button {
      display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 0; border-radius: 7px;
      background: transparent; color: var(--muted); font-size: 12px; font-weight: 600;
    }
    .tabs button[aria-selected="true"] { background: var(--segment); color: var(--fg); box-shadow: 0 1px 2px rgba(20,25,35,.12); }
    .wrap.dark .tabs button[aria-selected="true"] { box-shadow: none; }
    .tabs .count {
      min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; text-align: center;
      background: var(--badge); color: #fff; font-size: 11px; font-weight: 700; line-height: 18px;
    }
    .tabs .count:empty { display: none; }
    .spacer { flex: 1; }
    .private { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; color: var(--muted); white-space: nowrap; }
    .icon-btn {
      width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--muted);
      display: flex; align-items: center; justify-content: center;
    }
    .icon-btn:hover { background: var(--tonal); }

    .top { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-bottom: 1px solid var(--panel-line); flex-shrink: 0; }
    .top:not(:has(> :not([hidden]))) { display: none; }
    .select { position: relative; }
    .select svg { position: absolute; right: 10px; top: 10px; color: var(--muted); pointer-events: none; }
    select {
      width: 100%; height: 36px; padding: 0 32px 0 12px; border-radius: 8px; appearance: none;
      border: 1px solid var(--field-line); background: var(--field); color: var(--fg); font-size: 13px;
    }
    .label { font-size: 12px; font-weight: 500; color: var(--muted); }
    .share { display: flex; flex-direction: column; gap: 6px; }
    .share .row { display: flex; gap: 8px; }
    .share input {
      flex: 1; min-width: 0; height: 36px; padding: 0 10px; border-radius: 8px;
      border: 1px solid var(--field-line); background: var(--field); color: var(--fg); font-size: 12px;
    }
    .outline {
      display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; border-radius: 8px;
      border: 1px solid var(--field-line); background: var(--field); color: var(--fg); font-size: 13px; font-weight: 600;
    }
    .warn-note { display: flex; gap: 6px; font-size: 12px; line-height: 1.45; color: var(--warn); }
    .warn-note svg { margin-top: 1px; }
    .warn-note:has(span:empty) { display: none; }
    .alert {
      display: flex; gap: 8px; padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.45;
    }
    .alert svg { margin-top: 1px; }
    .alert.warn { background: var(--warn-bg); color: var(--warn); }
    .alert.danger { background: var(--danger-bg); color: var(--danger); }
    .alert:has(> span:empty) { display: none; }

    .switch { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; cursor: pointer; }
    .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .switch .track {
      position: relative; width: 36px; height: 20px; border-radius: 999px; background: var(--field-line); flex-shrink: 0;
    }
    .switch .track::after {
      content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: #fff; transition: left .15s;
    }
    .switch input:checked + .track { background: var(--primary); }
    .switch input:checked + .track::after { left: 18px; }
    .switch input:focus-visible + .track { outline: 2px solid var(--focus); outline-offset: 2px; }
    .note { font-size: 12px; line-height: 1.45; color: var(--muted); }
    .note:empty { display: none; }

    .view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .problem {
      display: flex; gap: 10px; margin: 12px 12px 0; padding: 12px 12px 12px 14px; border-radius: 10px;
      background: var(--danger-bg); color: var(--danger); font-size: 13px; line-height: 1.5;
    }
    .problem > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .problem summary { cursor: pointer; font-size: 12px; font-weight: 600; }
    .problem pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.5; }
    .log, .threads { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .msg { max-width: 85%; padding: 9px 12px; font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
    .msg.ai, .msg.tutor-answer { align-self: flex-start; max-width: 92%; border-radius: 12px 12px 12px 4px; background: var(--card); box-shadow: var(--msg-shadow); }
    .msg.user, .msg.answer { align-self: flex-end; border-radius: 12px 12px 4px 12px; background: var(--primary); color: var(--on-primary); white-space: pre-wrap; }
    .msg > div > :first-child { margin-top: 0; } .msg > div > :last-child { margin-bottom: 0; }
    .msg p { margin: 0 0 8px; }
    .msg pre { margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; overflow-x: auto; background: var(--tonal); font-size: 12px; line-height: 1.5; }
    .msg code { font-family: 'JetBrains Mono Variable', ui-monospace, monospace; font-size: 12px; }
    .msg :not(pre) > code { padding: 1px 4px; border-radius: 4px; background: var(--tonal); }
    .msg a { color: var(--link); }
    .msg form { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
    fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    legend { padding: 0 0 6px; font-size: 12px; font-weight: 500; color: var(--muted); }
    label.option { font-size: 13px; display: flex; gap: 8px; align-items: center; width: 100%; }
    label.option input { accent-color: var(--primary); margin: 0; }
    button.choice, button.submit {
      height: 34px; padding: 0 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
      border: 1px solid var(--field-line); background: var(--field); color: var(--fg);
    }
    .single button.choice:first-of-type { border-color: var(--primary); background: var(--primary); color: var(--on-primary); }
    button.submit { align-self: flex-start; }
    .msg form[aria-disabled="true"] { opacity: .5; pointer-events: none; }
    .reason { margin-top: 8px; font-size: 12px; color: var(--muted); }
    .skipped, .empty { align-self: center; font-size: 12px; color: var(--muted); }
    .status { display: flex; align-items: center; gap: 8px; padding: 0 12px 10px; font-size: 12px; color: var(--muted); }
    .status:has(span:empty) { display: none; }
    .status svg { display: none; animation: spin 1s linear infinite; }
    .status.busy svg { display: block; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .hint { padding: 0 12px 10px; font-size: 12px; color: var(--muted); font-style: italic; }
    .hint:empty { display: none; }
    .compose { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-top: 1px solid var(--panel-line); flex-shrink: 0; }
    textarea {
      resize: none; padding: 10px 12px; border-radius: 8px; font-size: 14px;
      border: 1px solid var(--field-line); background: var(--field); color: var(--fg);
    }
    .send { height: 38px; border: 0; border-radius: 8px; background: var(--primary); color: var(--on-primary); font-size: 13px; font-weight: 600; }
    .send:disabled { background: var(--tonal); color: var(--faint); cursor: default; }

    .thread { flex-shrink: 0; border-radius: 12px; background: var(--card); box-shadow: var(--card-shadow); }
    .thread summary { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; list-style: none; }
    .thread summary::-webkit-details-marker { display: none; }
    .thread .initial {
      width: 28px; height: 28px; border-radius: 8px; background: var(--own); color: var(--you);
      display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;
    }
    .thread .who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .thread .name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .thread .where { font-size: 11px; color: var(--muted); }
    .thread summary svg { color: var(--muted); transform: rotate(180deg); }
    .thread:not([open]) summary svg { transform: none; }
    .thread .entries { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 8px; }
    .msg.student { align-self: flex-start; max-width: 88%; border-radius: 12px 12px 12px 4px; background: var(--tonal); white-space: pre-wrap; }
    .msg.tutor { align-self: flex-end; max-width: 88%; border-radius: 12px 12px 4px 12px; background: var(--own); }
    .msg .meta { display: block; font-size: 11px; color: var(--muted); white-space: normal; }
    .msg.tutor .meta { font-weight: 600; color: var(--you); }

    :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

    @media (max-width: 599px) {
      .panel { inset: 0; width: auto; height: auto; border-radius: 0; }
      .toggle[aria-expanded="true"] { display: none; }
      .icon-btn { width: 44px; height: 44px; }
    }
  `

  // sparkles, not the robot: that one is the students' tutor
  const SPARKLES = '<svg class="sparkles" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6c.7 4 2.6 6 7 7-4.4 1-6.3 3-7 7-.7-4-2.6-6-7-7 4.4-1 6.3-3 7-7zM18 2.5v5M15.5 5h5"></path></svg>'
  const CHEVRON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>'
  const WARN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20zM12 10v4M12 17h.01"></path></svg>'
  const ERROR = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>`

  const host = document.createElement('edrys-dev-chat')
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${css}</style>
    <div class="wrap">
      <button class="toggle" type="button" aria-expanded="false" aria-controls="panel" aria-label="Agent chat">
        ${SPARKLES}<span class="chevron">${CHEVRON}</span><span class="dot"></span>
      </button>
      <section class="panel" id="panel" aria-label="edrys-dev">
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

  // the shadows differ between edrys-Lite's themes, the colors follow by themselves
  const wrap = root.querySelector('.wrap')
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
