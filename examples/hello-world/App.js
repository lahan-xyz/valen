import { App } from 'valen'

const HelloWorld = new App('#app', {
  template: () => `
    <h1>Hello, World!</h1>
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
});

HelloWorld.render();