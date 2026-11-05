// Injected by edrys-dev into edrys-Lite's page: student and station tabs load
// again when a local module changed. The tab opened with ?dev (DevBridge keeps
// that in sessionStorage) reloads only the changed modules itself, and shows
// the agent chat (AgentChat.vue in edrys-Lite).
;(function () {
  if (location.search === '?dev' || sessionStorage.getItem('edrys-dev')) return
  if (!/^\?\/(classroom|station)\//.test(location.search)) return
  new EventSource('/edrys-dev/reload').addEventListener('reload-module', () => location.reload())
})()
