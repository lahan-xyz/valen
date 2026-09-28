import { Component } from 'valen';

function NoiseDemo() {
  return {
    state: { noise: 40 },
    template: `
      <section class="noise reveal">
        <p class="kicker">02 &mdash; Interaction</p>
        <h2 class="h2">Design is the removal of noise.</h2>
        <p class="sub">Drag to add noise, then take it away. Clarity was underneath the whole time.</p>
        <div class="stage">
          <div class="word" opacity="[ 1 - (noise / 150) ]">clarity</div>
          <canvas id="noiseCanvas"></canvas>
        </div>
        <div class="controls">
          <span class="mono c-label">NOISE</span>
          <input type="range" min="0" max="100" value="[ noise ]" @input="this.setNoise(value)" />
          <span class="mono c-val" v:text="[ noise ]"></span>
        </div>
      </section>
    `,
    created(state) {
      this.setNoise = (v) => { state.noise = parseInt(v, 10) || 0; };
    },
    run() {
      const canvas = this.element.querySelector('#noiseCanvas');
      const paint = (level) => {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        if (canvas.width !== w * dpr) canvas.width = w * dpr;
        if (canvas.height !== h * dpr) canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const specks = level * 7;
        for (let i = 0; i < specks; i++) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          const s = Math.random() * 3 + 0.5;
          ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
          ctx.globalAlpha = Math.random() * 0.85 + 0.15;
          ctx.fillRect(x, y, s, s);
        }
        ctx.globalAlpha = 1;
      };
      this._paint = paint;
      this._noise = 0;
      requestAnimationFrame(() => paint(0));
      const onResize = () => paint(this._noise);
      window.addEventListener('resize', onResize);
      this._onResize = onResize;
    },
    onUpdate({ key, newVal }) {
      if (key === 'noise') {
        this._noise = newVal;
        if (this._paint) this._paint(newVal);
      }
      return true;
    },
    onCleanup() {
      if (this._onResize) window.removeEventListener('resize', this._onResize);
    },
    stylesheet: {
      '.noise': `max-width: 1100px; margin: 0 auto; padding: 8rem 2rem;`,
      '.stage': `position: relative; margin: 3rem 0 2rem; border: 1px solid var(--line); height: 320px; overflow: hidden; display: flex; align-items: center; justify-content: center; transition: border-color .4s ease;`,
      '.stage:hover': `border-color: var(--fg);`,
      '.word': `font-size: clamp(3rem, 9vw, 6rem); font-weight: 900; letter-spacing: -0.04em; user-select: none; transition: opacity .1s linear;`,
      '#noiseCanvas': `position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;`,
      '.controls': `display: flex; align-items: center; gap: 1.25rem; margin-top: 2rem;`,
      '.c-label': `font-size: .65rem; letter-spacing: .25em; color: var(--mut);`,
      '.c-val': `font-size: .8rem; min-width: 3ch; text-align: right;`
    }
  };
}

export default Component(NoiseDemo);