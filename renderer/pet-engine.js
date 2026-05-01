/**
 * Movement model inspired by vscode-pokemon (sit → walk left/right, random stops, bounds).
 * @see https://github.com/jakobhoeg/vscode-pokemon — panel/states.ts, base-pokemon-type.ts
 */
(function () {
  const TICK_MS = 100;
  const SPRITE_PX = 72;
  const BUBBLE_PX = 36;
  const BUBBLE_VISIBLE_MS = 10000;

  const States = {
    sitIdle: 'sit-idle',
    walkRight: 'walk-right',
    walkLeft: 'walk-left',
  };

  function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i += 1) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  let spriteStyle = 'vscode';

  /** Showdown mode walks at ~55% the vscode pace — a stroll that suits the longer bob cadence. */
  function styleSpeedMult() {
    return spriteStyle === 'showdown' ? 0.55 : 1;
  }

  function spritePath(agent, useWalk) {
    const gen = agent.gen || 1;
    const species = agent.species || 'pikachu';
    const base = `gen${gen}/${species}`;
    const shiny = Boolean(agent.shiny);
    if (spriteStyle === 'showdown') {
      // Showdown sprites are single continuously-animated gifs; no walk/idle distinction.
      return shiny ? `${base}/showdown_shiny.gif` : `${base}/showdown_default.gif`;
    }
    if (shiny) {
      return useWalk ? `${base}/shiny_walk_8fps.gif` : `${base}/shiny_idle_8fps.gif`;
    }
    return useWalk ? `${base}/default_walk_8fps.gif` : `${base}/default_idle_8fps.gif`;
  }

  /** heart.png — user must act. happy.png — task completed. */
  function bubbleAssetKind(status) {
    if (status === 'needs_permission' || status === 'failed') return 'heart';
    if (status === 'completed') return 'happy';
    return null;
  }

  /** Show bubble when status changes into a bubble state, or a new `completed` event (updatedAt). */
  function shouldArmBubble(prev, next) {
    const k = bubbleAssetKind(next.status);
    if (!k) return false;
    if (!prev) return true;
    if (prev.status !== next.status) return true;
    if (next.status === 'completed' && next.updatedAt !== prev.updatedAt) return true;
    if (
      (next.status === 'needs_permission' || next.status === 'failed') &&
      prev.status === next.status
    ) {
      if (
        typeof next.permissionFence === 'number' &&
        typeof prev.permissionFence === 'number' &&
        next.permissionFence !== prev.permissionFence
      ) {
        return true;
      }
      if (
        typeof next.permissionFence !== 'number' &&
        next.updatedAt !== prev.updatedAt
      ) {
        return true;
      }
    }
    return false;
  }

  function chooseNextState(from) {
    const table = {
      [States.sitIdle]: [States.walkLeft, States.walkRight],
      [States.walkLeft]: [States.sitIdle, States.walkRight],
      [States.walkRight]: [States.sitIdle, States.walkLeft],
    };
    const opts = table[from];
    if (!opts) return States.sitIdle;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  class Pet {
    constructor(id, agent, laneEl) {
      this.id = id;
      this.agent = agent;
      this.laneEl = laneEl;
      const h = hashString(id);
      this.width = SPRITE_PX;
      this.bottom = 8;
      const laneW = Math.max(laneEl.clientWidth || 400, 200);
      const rightMax = Math.max(0, Math.floor(laneW * 0.95) - this.width);
      const pad = 8;
      const spread = Math.max(0, rightMax - pad);
      this.left = pad + (spread > 0 ? h % (spread + 1) : 0);
      const baseSpeed = 2 + (h % 25) / 10;
      this.speed = baseSpeed * (0.85 + ((h >> 4) % 30) / 100);

      this.stateEnum = States.sitIdle;
      this.lastFacingLeft = false;
      this.idleCounter = 0;
      this.walkIdleCounter = 0;
      this.holdTimeSit = 35 + (h % 45);
      this.holdTimeWalkStuck = 55;
      /** @type {ReturnType<typeof setTimeout> | null} */
      this.bubbleHideTimer = null;

      this.el = document.createElement('div');
      this.el.className = 'unit';
      this.el.dataset.id = id;
      this.inner = document.createElement('div');
      this.inner.className = 'unit-inner';
      this.inner.innerHTML = `
        <div class="pokeball-sprite" aria-hidden="true"></div>
        <div class="bubble-wrap" aria-hidden="true" hidden>
          <img class="bubble-img" alt="" width="${BUBBLE_PX}" height="28" />
        </div>
        <div class="sprite-wrap">
          <div class="sprite-bob">
            <img class="sprite" alt="" width="${SPRITE_PX}" height="${SPRITE_PX}" loading="lazy" />
          </div>
        </div>
      `;
      this.el.appendChild(this.inner);
      this.spriteEl = this.inner.querySelector('.sprite');
      this.spriteWrap = this.inner.querySelector('.sprite-wrap');
      this.pokeballEl = this.inner.querySelector('.pokeball-sprite');
      this.bubbleWrap = this.inner.querySelector('.bubble-wrap');
      this.bubbleImg = this.inner.querySelector('.bubble-img');

      laneEl.appendChild(this.el);
      this.applyLayout();
      this.applyBubbleOnAgentUpdate(null, agent);
      this.syncUnitStatusClass();
      this.updateVisuals(true);

      // Spin up the Pokeball intro
      this.spriteWrap.style.opacity = '0';
      this.pokeballEl.classList.add('active', 'open');
      setTimeout(() => {
        this.spriteWrap.style.opacity = '1';
        this.spriteWrap.classList.add('spawn-pop');
        this.spriteWrap.addEventListener('animationend', () => {
          this.spriteWrap.classList.remove('spawn-pop');
        }, { once: true });
        setTimeout(() => this.pokeballEl.classList.remove('active', 'open'), 500);
      }, 350);
    }

    setAgent(agent) {
      const prev = this.agent;
      this.agent = agent;
      this.applyBubbleOnAgentUpdate(prev, agent);
      this.syncUnitStatusClass();
    }

    syncUnitStatusClass() {
      const s = this.agent && this.agent.status ? this.agent.status : 'running';
      const el = this.el;
      for (const st of ['running', 'idle', 'needs_permission', 'completed', 'failed']) {
        el.classList.remove(`status-${st}`);
      }
      el.classList.add(`status-${s}`);
    }

    clearBubbleHideTimer() {
      if (this.bubbleHideTimer) {
        clearTimeout(this.bubbleHideTimer);
        this.bubbleHideTimer = null;
      }
    }

    hideBubble() {
      this.bubbleWrap.hidden = true;
      this.bubbleWrap.style.display = 'none';
      this.el.classList.remove('unit--bubble-visible');
    }

    applyBubbleOnAgentUpdate(prev, next) {
      const k = bubbleAssetKind(next.status);
      if (!k) {
        this.clearBubbleHideTimer();
        this.hideBubble();
        return;
      }
      if (!shouldArmBubble(prev, next)) {
        return;
      }
      this.clearBubbleHideTimer();
      this.bubbleImg.src = k === 'heart' ? '/assets/heart.png' : '/assets/happy.png';
      this.bubbleImg.alt = '';
      this.bubbleWrap.hidden = false;
      this.bubbleWrap.style.display = 'block';
      this.el.classList.add('unit--bubble-visible');
      if (k !== 'heart') {
        this.bubbleHideTimer = setTimeout(() => {
          this.bubbleHideTimer = null;
          this.hideBubble();
        }, BUBBLE_VISIBLE_MS);
      }
    }

    updateVisuals(forceGif) {
      const a = this.agent;
      const walking = this.stateEnum === States.walkRight || this.stateEnum === States.walkLeft;
      const src = `/assets/${spritePath(a, walking)}`;
      if (forceGif || this.spriteEl.dataset.src !== src) {
        this.spriteEl.dataset.src = src;
        this.spriteEl.src = src;
      }
      if (this.stateEnum === States.walkLeft) {
        this.spriteEl.style.transform = 'scaleX(-1)';
      } else if (this.stateEnum === States.walkRight) {
        this.spriteEl.style.transform = 'scaleX(1)';
      } else {
        this.spriteEl.style.transform = this.lastFacingLeft ? 'scaleX(-1)' : 'scaleX(1)';
      }
      this.el.classList.toggle('unit--walking', walking);
    }

    applyLayout() {
      this.inner.style.left = `${this.left}px`;
      this.inner.style.bottom = `${this.bottom}px`;
    }

    get rightBound() {
      const w = this.laneEl.clientWidth || 400;
      return Math.max(0, Math.floor(w * 0.95) - this.width);
    }

    tick() {
      if (this.isDestroying) return;
      const rightMax = this.rightBound;
      if (this.left > rightMax) this.left = rightMax;
      if (this.left < 0) this.left = 0;

      let complete = false;

      if (this.stateEnum === States.sitIdle) {
        this.idleCounter += 1;
        if (this.idleCounter > this.holdTimeSit) {
          complete = true;
        }
      } else if (this.stateEnum === States.walkRight) {
        this.walkIdleCounter += 1;
        this.left += this.speed * styleSpeedMult();
        if (this.walkIdleCounter > this.holdTimeWalkStuck && Math.random() < 0.01) {
          complete = true;
        }
        if (this.left >= rightMax) {
          this.left = rightMax;
          complete = true;
        }
        this.lastFacingLeft = false;
      } else if (this.stateEnum === States.walkLeft) {
        this.walkIdleCounter += 1;
        this.left -= this.speed * styleSpeedMult();
        if (this.walkIdleCounter > this.holdTimeWalkStuck && Math.random() < 0.01) {
          complete = true;
        }
        if (this.left <= 0) {
          this.left = 0;
          complete = true;
        }
        this.lastFacingLeft = true;
      }

      if (complete) {
        const next = chooseNextState(this.stateEnum);
        this.stateEnum = next;
        this.idleCounter = 0;
        this.walkIdleCounter = 0;
        if (next === States.sitIdle) {
          this.holdTimeSit = 30 + (hashString(this.id + Date.now()) % 50);
        }
      }

      this.applyLayout();
      this.updateVisuals(false);
    }

    destroy() {
      this.clearBubbleHideTimer();
      this.isDestroying = true;
      this.spriteWrap.classList.add('fade-out');
      this.pokeballEl.classList.add('active', 'close');
      setTimeout(() => {
        this.el.remove();
      }, 700);
    }
  }

  const pets = new Map();
  let timer;
  let lane;
  let emptyEl;

  function ensureEmpty(laneEl, hasPets) {
    if (hasPets) {
      if (emptyEl) {
        emptyEl.remove();
        emptyEl = null;
      }
      return;
    }
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'empty';
      emptyEl.textContent = '';
      laneEl.appendChild(emptyEl);
    }
  }

  function tickAll() {
    if (!lane) return;
    for (const pet of pets.values()) {
      pet.tick();
    }
  }

  window.PetEngine = {
    start(laneEl, opts) {
      lane = laneEl;
      if (opts && typeof opts.spriteStyle === 'string') {
        spriteStyle = opts.spriteStyle === 'showdown' ? 'showdown' : 'vscode';
      }
      if (timer) clearInterval(timer);
      timer = setInterval(tickAll, TICK_MS);
    },
    setSpriteStyle(style) {
      const next = style === 'showdown' ? 'showdown' : 'vscode';
      if (next === spriteStyle) return;
      spriteStyle = next;
      document.body.classList.toggle('sprite-style-showdown', next === 'showdown');
      for (const pet of pets.values()) pet.updateVisuals(true);
    },
    sync(agentsObj) {
      const ids = new Set(Object.keys(agentsObj || {}));
      for (const id of [...pets.keys()]) {
        if (!ids.has(id)) {
          pets.get(id).destroy();
          pets.delete(id);
        }
      }
      for (const id of ids) {
        const a = agentsObj[id];
        if (pets.has(id)) {
          pets.get(id).setAgent(a);
        } else {
          pets.set(id, new Pet(id, a, lane));
        }
      }
      ensureEmpty(lane, ids.size > 0);
    },
  };
})();
