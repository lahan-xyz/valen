import { Component, Atom } from 'valen';

const PRINCIPLES = [
  { num: '01', title: 'Subtract first.', body: 'Remove until it breaks, then add back one. Emptiness is not the absence of design — it is the proof of it.' },
  { num: '02', title: 'Contrast is hierarchy.', body: 'In black and white there is nowhere to hide. What you emphasize tells people what matters. When everything is bold, nothing is.' },
  { num: '03', title: 'Whitespace is a material.', body: 'It is not empty space; it is the pause between notes. Give ideas room to breathe and meaning room to land.' },
  { num: '04', title: 'Consistency is kindness.', body: 'A predictable interface respects attention. Cleverness fades; clarity compounds. Design for the second visit, not the first.' }
];

function PrincipleList() {
  return {
    id: 'principles-list',
    isReactive: false,
    template: () => `
      <div class="principle reveal">
        <span class="p-num">[ num ]</span>
        <div class="p-body">
          <h3 class="p-title">[ title ]</h3>
          <p class="p-text">[ body ]</p>
        </div>
      </div>
    `,
    stylesheet: {
      '.principle': `display: grid; grid-template-columns: 90px 1fr; gap: 2rem; padding: 3rem 0; border-top: 1px solid var(--line); align-items: baseline; transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.4s ease;`,
      '.principle:hover': `transform: translateX(12px); border-color: var(--fg);`,
      '.p-num': `font-family: 'Space Mono', monospace; font-size: 1rem; color: var(--mut); transition: color 0.4s ease;`,
      '.principle:hover .p-num': `color: var(--fg);`,
      '.p-title': `font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 600; letter-spacing: -0.02em; margin: 0 0 .75rem; transition: letter-spacing 0.4s ease;`,
      '.principle:hover .p-title': `letter-spacing: -0.01em;`,
      '.p-text': `margin: 0; color: var(--mut); line-height: 1.6; max-width: 60ch;`
    }
  };
}

const principleList = Atom(PrincipleList);

function Principles() {
  return {
    template: `
      <section class="principles reveal">
        <p class="kicker" v:copy:this.name>03 &mdash; Principles</p>
        <h2 class="h2">Four things simplicity requires.</h2>
        <div id="principles-list"></div>
      </section>
    `,
    run() {
      principleList.renderWith(PRINCIPLES);
    },
    stylesheet: {
      '.principles': `max-width: 1100px; margin: 0 auto; padding: 8rem 2rem;`
    }
  };
}

export default Component(Principles);