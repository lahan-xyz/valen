import { Component } from 'valen';
import { Theme } from '../store/theme.js';

function ThemeToggle() {
  return {
    template: `
      <button class="toggle" @click="this.flip()">
        <span class="t-dot"></span>
        <span class="t-label mono">[ $theme.inverted ? 'BLACK' : 'WHITE' ]</span>
      </button>
    `,
    created() {
      this.flip = () => {
        Theme.inverted = !Theme.inverted;
        document.documentElement.classList.toggle('inverted', Theme.inverted);
      };
    },
    run() {
      if (Theme.inverted) {
        document.documentElement.classList.add('inverted');
      }
    },
    stylesheet: {
      '.toggle': `position: fixed; top: 1.5rem; right: 1.5rem; z-index: 50; display: inline-flex; align-items: center; gap: .6rem; padding: .55rem .9rem; background: transparent; color: var(--fg); border: 1px solid var(--fg); border-radius: 999px; cursor: pointer; font-family: 'Space Mono', monospace; font-size: .7rem; letter-spacing: .2em; transition: background .3s, color .3s, border-color .3s, transform .3s; opacity: 0; animation: fadeIn 1s ease 0.5s forwards;`,
      '.toggle:hover': `background: var(--fg); color: var(--bg); transform: translateY(-2px);`,
      '.t-dot': `width: .6rem; height: .6rem; border-radius: 50%; background: var(--fg); transition: background .3s, transform .5s cubic-bezier(0.16, 1, 0.3, 1);`,
      '.toggle:hover .t-dot': `background: var(--bg); transform: scale(1.3) rotate(90deg);`
    }
  };
}

export default Component(ThemeToggle);