globalThis.toPage = (path) => {
  history.pushState({}, '', path);
  loadComponent(path)
}

const loadComponent = (path) => {
  const len = routerObj.length;
  let comp404 = '';
  
  const changeView = (name, title) => {
    const instance = components.get(name);
    ctx.currentComponent?.hide();
    if (instance.isMounted) {
      instance.show();
    } else {
      instance.mount();
      instance.show();
    }
    document.title = title;
    ctx.currentComponent = instance;
    ctx.currentComponent.navigateFunc(ctx.currentComponent.data);
  }
  
  for (let i = 0; i < len; i++) {
    const { component, route, title } = routerObj[i];
    if (route === "*") {
      comp404 = component;
    }
    if (route === path) {
      changeView(component, title);
      break;
    } else {
      if (i === len - 1) {
        changeView(comp404, title)
      }
    }
  }
  navigateFunc(path);
  window.scrollTo(0, 0);
}


const Link = new Nugget('Link', {
  template: (data) => {
    const classN = data.class ? 'class=[ class ]' : '';
    return `
      <a href=[ to ] ${ classN } onclick="
        e.preventDefault()
        toPage('[ to ]')">${ data.isBtn ? '<button>[ label ]</button>' : '[ label ]' }</a>`
  }
})

function handleRouter(input) {
  const routerReg = /<(Router)\s*\{([\s\S]*?)\}\s*\/>/g;
  let out = '',
    computed = '';
  
  if (routerReg.test(input)) {
    const extr = input.match(routerReg)[0],
      whiteSpaceIndex = extr.indexOf(" "),
      d = extr.slice(whiteSpaceIndex, -2).trim(),
      path = window.location.pathname;
    const data = Function(`return ${d}.routes`)(),
      len = data.length;
    
    let comp404 = '',
      isSet = false;
    
    computed = data.map(({ route, component }, i) => {
      data[i].component = stringBetween(component, " <", "/>");
      
      const name = data[i].component;
      const title = data[i].title;
      if (!title) {
        throw new Error(`Valen Router Error:\nTitle not set for component '${ name }'`)
      }
      
      let instance = components.get(name);
      
      if (!instance) throw new Error(`\n\nValen Router Error:\nAn error occured while rendering component '${name}'`);
      
      if (route === "*") {
        comp404 = name;
      }
      
      if (route === path) {
        isSet = true;
        ctx.currentComponent = instance;
        document.title = title;
        return renderComponent(instance, name);
      } else {
        if (i === len - 1 && !isSet) {
          instance = components.get(comp404);
          ctx.currentComponent = instance;
          document.title = title;
          return renderComponent(instance, comp404);
        } else {
          const id = instance.element;
          return `<div id="${id}" display="none"></div>`;
        }
      }
    }).join('');
    routerObj = data;
    out = input.replace(extr, computed);
  } else {
    return input;
  }
  
  window.addEventListener('popstate', () => {
    const path = window.location.pathname;
    loadComponent(path);
  });
  
  return out;
}

const onNavigate = (func, instance) => {
  navigateFunc = func.bind(instance);
}


export default handleRouter;