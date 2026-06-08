import { App } from 'queflow'
import AppView from './components/AppView.js'

const JambApp = new App('#app', {
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
      font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: #e4e4e7;
      min-height: 100vh;
      -webkit-tap-highlight-color: transparent;
    `,
  },
});

JambApp.render();