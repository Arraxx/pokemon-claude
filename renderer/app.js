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

fetch('/api/meta')
  .then((r) => r.json())
  .then((meta) => {
    if (meta && meta.spriteStyle && window.PetEngine) {
      window.PetEngine.setSpriteStyle(meta.spriteStyle);
    }
  })
  .catch(() => { });

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
