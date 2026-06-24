import { App } from 'valen'
import Text from '../past-questions/widgets/Text.js';

const HelloWorld = new App('#app', {
  template: () => `
    <h1>Hello, World!</h1>
    <Text ({ txt: "Hello, World!", size: 32 })>
      <Text { txt: "Hello, World!", size: 32, color: "inherit" } />
    </Text>
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