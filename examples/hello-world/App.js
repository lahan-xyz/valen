import { App } from 'valen'

const HelloWorld = new App('#app', {
  data: {
    text: ""
  },
  template: () => `
    <h1 color="#F7017A">Hello, World!<h1/>
    <div>[ text ]</div>
    <input
      type="text"
      @input=[ data.text = e.target.value; ]
    />
    `,
  stylesheet: {
    "html": `
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    `
  },
  run() {
    
  }
});

HelloWorld.render();