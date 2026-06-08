import { Nugget } from 'queflow';

const Text = new Nugget ('Text', {
  template: (data) => {
    data.color = data.color || "dodgerblue"
    data.align = data.align || "center"
    data.size = data.size || 20
    
    
    return (`
      <span color=[ color ] text-align=[ align ] font-size="[ size ]px" onclick=[ click ]>[ txt ] </> 
      </span>
    `)
  },
  stylesheet: {
    'span': `
      font-weight: 500;
      display: block;
    `
  }
}
)

export default Text;