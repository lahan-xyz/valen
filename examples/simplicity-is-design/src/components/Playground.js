import { Component } from 'valen';

function Playground() {
  return {
    state: {
      weight: 700, tracking: -5, stroke: 0.75, leading: 92,
      gravity: 0.5, bounce: 0.8,
      bx: 80, by: 40,
      t0: { x: 80, y: 40 }, t1: { x: 80, y: 40 }, t2: { x: 80, y: 40 }, t3: { x: 80, y: 40 },
      t4: { x: 80, y: 40 }, t5: { x: 80, y: 40 }, t6: { x: 80, y: 40 }, t7: { x: 80, y: 40 }
    },
    template: `
      <section class="play reveal">
        <p class="kicker">04 &mdash; Playground</p>
        <h2 class="h2">Turn the knobs. Watch the page obey.</h2>
        <p class="sub">Design tokens are decisions. These sliders write CSS custom properties live &mdash; the specimen below and the headline above both listen.</p>
        <div class="play-grid">
          <div class="panel">
            <p class="panel-title mono">TYPE TOKENS</p>
            <div class="specimen">
              <span class="spec-solid" fontWeight="[ weight ]" letterSpacing="[ tracking / 100 ]em" lineHeight="[ leading / 100 ]">Simplicity</span>
              <span class="spec-outline" fontWeight="[ weight ]" letterSpacing="[ tracking / 100 ]em" lineHeight="[ leading / 100 ]">is design.</span>
            </div>
            <div class="knob">
              <div class="knob-head"><span class="mono k-name">WEIGHT</span><span class="mono k-val" v:text="[ weight ]"></span></div>
              <input type="range" min="100" max="900" step="10" value="[ weight ]" @input="this.onWeight(value)" />
            </div>
            <div class="knob">
              <div class="knob-head"><span class="mono k-name">TRACKING</span><span class="mono k-val"><span v:text="[ tracking / 100 ]"></span>em</span></div>
              <input type="range" min="-8" max="4" step="0.5" value="[ tracking ]" @input="this.onTracking(value)" />
            </div>
            <div class="knob">
              <div class="knob-head"><span class="mono k-name">STROKE</span><span class="mono k-val"><span v:text="[ stroke ]"></span>px</span></div>
              <input type="range" min="0.5" max="6" step="0.25" value="[ stroke ]" @input="this.onStroke(value)" />
            </div>
            <div class="knob">
              <div class="knob-head"><span class="mono k-name">LEADING</span><span class="mono k-val" v:text="[ leading / 100 ]"></span></div>
              <input type="range" min="80" max="140" step="1" value="[ leading ]" @input="this.onLeading(value)" />
            </div>
            <button class="reset mono" @click="this.resetTokens()">RESET TOKENS</button>
          </div>
          <div class="panel">
            <p class="panel-title mono">PHYSICS &middot; SVG &mdash; CLICK TO POKE</p>
            <div class="phys-stage">
              <svg class="phys-svg" @click="this.poke(e)">
                <circle cx="[ t7.x ]" cy="[ t7.y ]" r="3"  opacity="0.05" />
                <circle cx="[ t6.x ]" cy="[ t6.y ]" r="4"  opacity="0.07" />
                <circle cx="[ t5.x ]" cy="[ t5.y ]" r="5"  opacity="0.10" />
                <circle cx="[ t4.x ]" cy="[ t4.y ]" r="6"  opacity="0.12" />
                <circle cx="[ t3.x ]" cy="[ t3.y ]" r="7"  opacity="0.15" />
                <circle cx="[ t2.x ]" cy="[ t2.y ]" r="8"  opacity="0.18" />
                <circle cx="[ t1.x ]" cy="[ t1.y ]" r="9"  opacity="0.21" />
                <circle cx="[ t0.x ]" cy="[ t0.y ]" r="10" opacity="0.25" />
                <circle class="ball" cx="[ bx ]" cy="[ by ]" r="12" />
              </svg>
            </div>
            <div class="knob">
              <div class="knob-head"><span class="mono k-name">GRAVITY</span><span class="mono k-val" v:text="[ gravity ]"></span></div>
              <input type="range" min="0" max="2" step="0.05" value="[ gravity ]" @input="this.onGravity(value)" />
            </div>
            <div class="knob">
              <div class="knob-head"><span class="mono k-name">BOUNCE</span><span class="mono k-val" v:text="[ bounce ]"></span></div>
              <input type="range" min="0.1" max="0.95" step="0.05" value="[ bounce ]" @input="this.onBounce(value)" />
            </div>
          </div>
        </div>
      </section>
    `,
    created(state) {
      const write = (cssVar, val) => document.documentElement.style.setProperty(cssVar, val);
      this.onWeight   = (v) => { state.weight   = +v; write('--st-weight', v); };
      this.onTracking = (v) => { state.tracking = +v; write('--st-tracking', (v / 100) + 'em'); };
      this.onStroke   = (v) => { state.stroke   = +v; write('--st-stroke', v + 'px'); };
      this.onLeading  = (v) => { state.leading  = +v; write('--st-leading', v / 100); };
      this.onGravity  = (v) => { state.gravity  = +v; };
      this.onBounce   = (v) => { state.bounce   = +v; };
      this.resetTokens = () => { this.onWeight(700); this.onTracking(-5); this.onStroke(0.75); this.onLeading(92); };
      this.poke = (e) => {
        if (!this._svg) return;
        const rect = this._svg.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const dx = state.bx - px;
        const dy = state.by - py;
        const d  = Math.hypot(dx, dy) || 1;
        this._vx += (dx / d) * 7;
        this._vy += (dy / d) * 7 - 3;
      };
    },
    run(state) {
      this._svg = this.element.querySelector('.phys-svg');
      let w = 0, h = 0;
      const size = () => {
        const rect = this._svg.getBoundingClientRect();
        w = Math.max(1, Math.round(rect.width));
        h = Math.max(1, Math.round(rect.height));
      };
      size();
      window.addEventListener('resize', size);
      this._onResize2 = size;

      let x = 80, y = 40;
      this._vx = 2.4;
      this._vy = 0;
      const r = 12;

      const step = () => {
        this._vy += state.gravity * 0.45;
        this._vx *= 0.999;
        x += this._vx;
        y += this._vy;
        if (x < r)     { x = r;     this._vx *= -state.bounce; }
        if (x > w - r) { x = w - r; this._vx *= -state.bounce; }
        if (y < r)     { y = r;     this._vy *= -state.bounce; }
        if (y > h - r) { y = h - r; this._vy *= -state.bounce; this._vx *= 0.995; }
        state.t7.x = state.t6.x; state.t7.y = state.t6.y;
        state.t6.x = state.t5.x; state.t6.y = state.t5.y;
        state.t5.x = state.t4.x; state.t5.y = state.t4.y;
        state.t4.x = state.t3.x; state.t4.y = state.t3.y;
        state.t3.x = state.t2.x; state.t3.y = state.t2.y;
        state.t2.x = state.t1.x; state.t2.y = state.t1.y;
        state.t1.x = state.t0.x; state.t1.y = state.t0.y;
        state.t0.x = x;          state.t0.y = y;
        state.bx = x;
        state.by = y;
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    },
    onCleanup() {
      cancelAnimationFrame(this._raf);
      if (this._onResize2) window.removeEventListener('resize', this._onResize2);
    },
    stylesheet: {
      '.play': `max-width: 1100px; margin: 0 auto; padding: 8rem 2rem;`,
      '.play-grid': `display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 2rem; margin-top: 3rem; align-items: start;`,
      '.panel': `border: 1px solid var(--line); padding: 2rem; transition: border-color .4s ease;`,
      '.panel:hover': `border-color: var(--fg);`,
      '.panel-title': `font-size: .65rem; letter-spacing: .25em; color: var(--mut); margin: 0 0 1.5rem;`,
      '.specimen': `border: 1px solid var(--line); padding: 2rem 1.5rem; margin-bottom: 2.5rem; display: flex; flex-direction: column; gap: .25rem; overflow: hidden;`,
      '.spec-solid, .spec-outline': `font-size: clamp(2rem, 5vw, 3.5rem); -webkit-text-stroke-width: var(--st-stroke, 0.75px); transition: font-weight .15s ease, letter-spacing .15s ease, line-height .15s ease, -webkit-text-stroke-width .15s ease;`,
      '.spec-outline': `color: transparent; -webkit-text-stroke: var(--st-stroke, 0.75px) var(--fg);`,
      '.knob': `margin-bottom: 1.5rem;`,
      '.knob-head': `display: flex; justify-content: space-between; margin-bottom: .5rem;`,
      '.k-name': `font-size: .6rem; letter-spacing: .25em; color: var(--mut);`,
      '.k-val': `font-size: .7rem;`,
      '.reset': `background: transparent; color: var(--fg); border: 1px solid var(--fg); border-radius: 999px; padding: .5rem 1rem; font-size: .65rem; letter-spacing: .2em; cursor: pointer; transition: background .3s, color .3s, transform .3s;`,
      '.reset:hover': `background: var(--fg); color: var(--bg); transform: translateY(-2px);`,
      '.phys-stage': `position: relative; height: 260px; overflow: hidden; border: 1px solid var(--line); margin-bottom: 2rem; transition: border-color .4s ease;`,
      '.phys-stage:hover': `border-color: var(--fg);`,
      '.phys-svg': `position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; color: var(--fg); transition: color .4s ease;`,
      '.phys-svg circle': `fill: currentColor;`
    }
  };
}

export default Component(Playground);