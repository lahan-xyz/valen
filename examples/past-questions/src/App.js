import { Component, render } from 'valen'
import AppView from './components/AppView.js'

const App = Component(function App() {
  return {
    mount: '#app',
    template: () => `
    <AppView/>
    `,
    stylesheet: {
      "html": `
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    `,
      "body": `
      color: #e4e4e7;
      min-height: 100vh;
      -webkit-tap-highlight-color: transparent;
    `,
      "body, *": "font-family: 'Inter'",
      
      "@font-face": `
      font-family: 'Inter';
      font-style: normal;
      font-weight: normal;
      font-display: swap;
      src: url('./src/assets/Inter-Bold.otf');
   `
    }
  }
});

render(App);