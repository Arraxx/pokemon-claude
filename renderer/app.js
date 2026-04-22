function refresh() {
  fetch('/api/state')
    .then((r) => r.json())
    .then((data) => {
      window.PetEngine.sync(data.agents || {});
    })
    .catch(() => { });
}

const lane = document.getElementById('root');
if (lane && window.PetEngine) {
  window.PetEngine.start(lane);
}
refresh();

const es = new EventSource('/api/stream');
es.addEventListener('state', (ev) => {
  try {
    const data = JSON.parse(ev.data);
    window.PetEngine.sync(data.agents || {});
  } catch {
    refresh();
  }
});
es.onerror = () => {
  refresh();
};
