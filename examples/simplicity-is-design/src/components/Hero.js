import { Component } from 'valen';

function Hero() {
  return {
    template: `
      <section class="hero stagger">
        <p class="kicker reveal">A manifesto for UI designers</p>
        <h1 class="statement reveal">Simplicity<br /><span class="outline">is design.</span></h1>
        <p class="sub hero-sub reveal">Every pixel you remove is a decision you&rsquo;ve made. Design is not decoration &mdash; it is the discipline of leaving only what serves.</p>
        <div class="scroll-cue mono reveal">SCROLL&nbsp;&nbsp;&darr;</div>
      </section>
    `,
    stylesheet: {
      '.hero': `min-height: 100vh; display: flex; flex-direction: column; justify-content: center; max-width: 1100px; margin: 0 auto; padding: 0 2rem; position: relative;`,
      '.statement': `font-size: clamp(3.5rem, 13vw, 10rem); font-weight: var(--st-weight, 900); line-height: var(--st-leading, 0.92); letter-spacing: var(--st-tracking, -0.05em); margin: 0 0 2rem; transition: font-weight .2s ease, letter-spacing .2s ease, line-height .2s ease;`,
      '.outline': `color: transparent; -webkit-text-stroke: var(--st-stroke, 2.5px) var(--fg); transition: -webkit-text-stroke-color .4s ease;`,
      '.hero-sub': `font-size: 1.125rem;`,
      '.scroll-cue': `position: absolute; bottom: 2.5rem; left: 2rem; font-size: .7rem; letter-spacing: .3em; color: var(--mut); animation: float 3s ease-in-out infinite; animation-delay: 1.5s;`
    }
  };
}

export default Component(Hero);