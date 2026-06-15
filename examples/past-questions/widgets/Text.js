import { Widget } from 'valen';

function Text() {
  return {
    template() {
      return (`
      <span
        color=[ color || "dodgerblue" ]
        text-align=[ align || "center" ]
        font-size="[ size || 20 ]px"
        >[ txt ]</span>
    `)
    },
    stylesheet: {
      'span': `
        font-weight: 600;
        display: block;
    `
    }
  }
}

export default Widget(Text);