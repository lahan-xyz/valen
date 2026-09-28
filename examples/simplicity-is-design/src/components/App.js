import { Component } from 'valen';
import ThemeToggle from './ThemeToggle.js';
import Hero from './Hero.js';
import NoiseDemo from './NoiseDemo.js';
import Principles from './Principles.js';
import Playground from './Playground.js';
import Footer from './Footer.js';

function App() {
  return {
    mount: '#app',
    template: `
      <div class="app">
        <div class="brand">VALEN &mdash; 1.6</div>
        <ThemeToggle />
        <Hero />
        <NoiseDemo />
        <Principles />
        <Playground />
        <Footer />
      </div>
    `,
    run() {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
      
      const observeReveals = () => {
        document.querySelectorAll('.reveal:not(.is-visible)').forEach(el => {
          observer.observe(el);
        });
      };
      
      observeReveals();
      
      const mutObs = new MutationObserver(observeReveals);
      mutObs.observe(document.getElementById('app'), { childList: true, subtree: true });
    }
  };
}

export default Component(App);