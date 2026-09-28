import { Component } from 'valen';

function Footer() {
  return {
    template: `
      <footer class="footer reveal">
        <div class="f-rule"></div>
        <p class="f-quote">&ldquo;Simplicity is not the absence of clutter. Simplicity is the presence of intent.&rdquo;</p>
        <div class="f-meta mono">
          <span>BUILT WITH VALEN</span>
          <span>NO BUILD STEP &middot; NO VIRTUAL DOM &middot; JUST SIGNAL &rarr; DOM</span>
        </div>
      </footer>
    `,
    stylesheet: {
      '.footer': `max-width: 1100px; margin: 0 auto; padding: 4rem 2rem 5rem;`,
      '.f-rule': `height: 1px; background: var(--line); margin-bottom: 3rem; transition: background 0.4s ease;`,
      '.f-quote': `font-size: clamp(1.25rem, 3vw, 2rem); font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; margin: 0 0 3rem; max-width: 32ch;`,
      '.f-meta': `display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; font-size: .65rem; letter-spacing: .2em; color: var(--mut);`
    }
  };
}

export default Component(Footer);