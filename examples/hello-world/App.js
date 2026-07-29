import { Component, render } from 'valen'

const App = Component(function App() {
  return {
    mount: '#app',
    template: () => `
      <h1>Hello, World!</h1>
    `,
    stylesheet: {
      "html": `
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        color: #F7017A;
        text-align: center;
    `
    }
  }
});

render(App);