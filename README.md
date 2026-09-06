# Valen

> A high-performance, **buildless** JavaScript library for atomic state management and surgical UI updates.

[![Version](https://img.shields.io/badge/version-1.6.0-blue)](https://github.com/lahan-xyz/valen)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Valen is a lightweight, zero-build frontend library that lets you build reactive web applications using nothing but native ES modules and modern browser APIs. It combines **atomic state management** via JavaScript Proxies with **surgical DOM updates** — only the elements that depend on changed data are touched.

---

## Table of Contents

- [Why Valen?](#why-valen)
- [Core Concepts](#core-concepts)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [The Three Primitives](#the-three-primitives)
  - [Component](#component)
  - [Atom](#atom)
  - [Widget](#widget)
- [State & Reactivity](#state--reactivity)
  - [Component State](#component-state)
  - [Global Store](#global-store)
  - [How Reactivity Works](#how-reactivity-works)
- [Templating](#templating)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Styling](#styling)
- [Event Handling](#event-handling)
- [Routing](#routing)
- [Performance](#performance)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Browser Support](#browser-support)
- [License](#license)

---

## Why Valen?

| Feature | Valen |
|---------|-------|
| **Buildless** | No bundler, no transpiler, no `node_modules` bloat. Import and go. |
| **Atomic Updates** | Only DOM nodes bound to changed state are updated — never the whole tree. |
| **Tiny** | Double-digit KB footprint with 0 external dependencies. |
| **Native ESM** | Uses standard JavaScript modules and browser-native APIs. |
| **Proxy-Based Signals** | Fine-grained reactivity without virtual DOM diffing overhead. |
| **Scoped CSS** | Stylesheets are automatically scoped to components, atoms, and widgets. |

Valen is ideal for:
- Prototyping without toolchain setup
- Building performance-critical UIs where every millisecond counts
- Learning how modern reactive frameworks work under the hood

---

## Core Concepts

Valen is built around three primitives that mirror how you already think about UI:

1. **Component** — A self-contained UI unit with state, template, stylesheet, and lifecycle. Think of it as a "page" or "section."
2. **Atom** — A high-performance list renderer. Think of it as a `for` loop over data that surgically updates only changed rows.
3. **Widget** — A reusable, stateless UI element (like a button, card, or input) with its own scoped styles. Think of it as a function that returns markup.

State is managed through **signals** — Proxy-wrapped objects that automatically track which DOM nodes depend on which properties. When a property changes, only those nodes update.

---

## Installation

No npm install needed. Use an import map or direct CDN links:

### Option 1: Import Map (Recommended)

```html
<!DOCTYPE html>
<html>
<head>
  <script type="importmap">
  {
    "imports": {
      "valen": "https://unpkg.com/@lahan-xyz/valen/src/valen.js"
    }
  }
  </script>
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { Component, Atom, Widget, Store, render } from 'valen';
    // Your app here
  </script>
</body>
</html>
```

### Option 2: Direct Import

```html
<script type="module">
  import { Component, render } from 'https://unpkg.com/@lahan-xyz/valen/src/valen.js';
</script>
```

### Option 3: Local Copy

Download the `src/` folder and serve it statically:

```html
<script type="module">
  import { Component, render } from './src/valen.js';
</script>
```

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<body>
  <div id="app"></div>

  <script type="module">
    import { Component, render } from 'valen';

    function Counter() {
      return {
        mount: '#app',
        state: { count: 0 },
        template: `
          <div>
            <h1>Count: [ count ]</h1>
            <button @click="state.count++">Increment +1</button>
          </div>
        `
      };
    }

    const counter = Component(Counter);
    render(counter);
  </script>
</body>
</html>
```

That's it. No build step. No virtual DOM. Just reactive HTML.

---

## The Three Primitives

### Component

A `Component` is a named function that returns a plain object describing your UI. It is the foundation of every Valen app.

```javascript
import { Component } from 'valen';

function App() {
  return {
    // Mount point: CSS selector or DOM element (root component only)
    mount: '#app',
    
    // State (must be a plain object)
    state: { title: 'Valen App', user: null },
    
    // HTML template with Valen syntax
    template: `
      <div>
        <h1>[ title ]</h1>
        <p v:show="[ user ]">Welcome, [ user?.name ]</p>
        <button @click="this.login()">[ user ? "Logout" : "Login" ]</button>
      </div>
    `,
    
    // Lifecycle: called once after Component instantiation 
    created(state) {
      console.log('App created with state:', state);
      
     // Bind methods to instance
      this.login = () => {
        state.user = state.user ? null: { name: 'Alex' };
      }
    },
    
    // Lifecycle: called after the component is rendered to the DOM
    run() {
      console.log('App is now in the DOM');
    },
    
    // Scoped stylesheet (injected once, scoped automatically)
    stylesheet: {
      "div": `
        padding: 1rem;
        background: #111;
        color: #fff;
        `,
      "h1": "margin: 0;"
    }
  };
}

const app = Component(App);
```

**Rules:**
- Component functions **must be named** (no arrow functions or anonymous functions).
- Component names must be unique across your app.
- The return value must be a plain object (not an array or null).
- Only the root component should have }a `mount` property.

#### Nested Components

Non-root components don't need a `mount`. They are referenced inside templates using their name:

```javascript
function UserCard() {
  return {
    state: { name: 'Guest' },
    template: `<div class="card">[ name ]</div>`
  };
}

Component(UserCard);

function App() {
  return {
    mount: '#app',
    state: {},
    template: `
      <div>
        <UserCard />
      </div>
    `
  };
}

const app = Component(App);
```

#### Component Destruction

```javascript
app.destroy(); // Removes from DOM, cleans up state, and frees memory
```

---

### Atom

An `Atom` is a specialized component for rendering lists. It uses **requestAnimationFrame batching** to render large datasets without blocking the main thread, and supports both reactive and static modes.

```javascript
import { Atom, detach } from 'valen';

function TodoList() {
  return {
    id: 'todo-container', // Mount element ID
    isReactive: true, // Enable surgical updates
    template: (_, index) => `
      <div class="todo">
        <span>[ text ]</span>
        <button @click="this.remove(${index})">×</button>
      </div>
    `,
    stylesheet: {
      ".todo": `
        padding: 0.5rem;
        border-bottom: 1px solid #ccc;
      `
    },
    created() {
      console.log('TodoList created');
      this.remove = (index) => {
        detach(this, index);
      }
    },
    onCleanup() {
      console.log('TodoList cleaned up');
    }
  };
}

const todoList = Atom(TodoList);


// Render data
todoList.renderWith([
  { text: 'Learn Valen' },
  { text: 'Build something cool' }
]);

// Update a single item (surgical update, only that row re-renders)
todoList.set(0, { text: 'Master Valen' });

// Append more data
todoList.renderWith([{ text: 'Ship it!' }]);

// Prepend data
todoList.renderWith([{ text: 'Ship it!' }], "prepend");

// Detach a specific item
detach(todoList, 2);

// Detach everything 
detach(todoList);

// Reattach previously detached items
todoList.reAttach();

// You can also pass an array of new data
// todoList.reAttach([...])

// Destroy Atom
todoList.destroy();
```

**Atom API:**

| Method | Description |
|--------|-------------|
| `renderWith(data, position='append')` | Renders an array of items. Returns a Promise that resolves when done. |
| `set(index, value)` | Surgically updates a single item at the given index. |
| `reAttach(data, index)` | Re-attaches a detached item or re-renders the whole list. |
| `destroy()` | Removes all items, clears state, and cleans up DOM. |

**Batching:** Atom renders items in batches of 30 per animation frame to keep the UI responsive.

---

### Widget

A `Widget` is a reusable, stateless UI element that accepts `props` and `children`. Perfect for buttons, inputs, badges, etc.

```javascript
import { Widget } from 'valen';

function Button() {
  return {
    template: `
      <button class="btn btn-[ variant || 'primary' ]">
        [ label ]
      </button>
    `,
    stylesheet: {
      ".btn": `
        padding: 0.5rem 1rem;
        border: none;
        cursor: pointer;
      `,
      ".btn-primary": `
        background: blue;
        color: white;
      `,
      ".btn-danger": `
        background: red;
        color: white;
      `
    }
  }
}

Widget(Button);

// Usage inside any template:
<Button {
  variant: "danger",
  label: "Delete"
} />

<Button { label: "Save" } />
```

**Rules:**
- Widget functions **must be named**.
- Widget names must be unique.
- Props and children are passed automatically when used in templates.

---

## State & Reactivity

### Component State

State is a plain object that becomes a **reactive signal** under the hood. Changes trigger surgical DOM updates.

```javascript
function Profile() {
  return {
    state: {
      user: { name: 'Sam', age: 30 },
      theme: 'dark'
    },
    template: `
      <div class="profile [ theme ]">
        <h2>[ user.name ]</h2>
        <p>Age: [ user.age ]</p>
        <button @click="this.birthday()">Birthday</button>
      </div>
    `,
    created(state){
      this.birthday = () => {
        // Nested properties are reactive too!
        state.user.age++;
      }
    }
  };
}
```

**Important:** Always mutate state through its properties. Don't reassign the entire `state` object from outside — use `Object.assign` or property-level mutations:

```javascript
// ✅ Correct
state.count = 5;
state.user.name = 'New Name';

// ❌ Avoid (breaks reactivity)
// profile.state = { count: 5 };
```

### Global Store

For shared state across components, use `Store`:

```javascript
import { Store } from 'valen';

// Create a global reactive store,  names must be prefixed with '$'

const AppStore = Store('$app', {
  theme: 'light',
  user: null,
  notifications: []
}, false); // Set to true to persist in localStorage

// Access anywhere
AppStore.theme = 'dark';
AppStore.notifications.push({ id: 1, text: 'Hello!' });

// Use in templates:
// <div class="[ $app.theme ]">...</div>
```

When `shouldStore` is `true`, the store automatically syncs with `localStorage` using batched writes via `queueMicrotask`.

### How Reactivity Works

Valen's reactivity engine is built on **JavaScript Proxies**:

1. When a component renders, Valen parses the template and tracks which state properties are accessed.
2. Each accessed property records a dependency linking it to specific DOM nodes.
3. When you mutate a property, the Proxy `set` trap fires.
4. Valen batches the update via `queueMicrotask`, then surgically updates only the dependent nodes.
5. Nested objects are automatically wrapped in reactive Proxies (cached via `WeakMap` to avoid duplicates).

This means:
- No virtual DOM diffing
- No unnecessary re-renders
- Updates are granular and fast

---

## Templating

Valen uses an HTML-based template syntax inspired by Vue and Angular:

### Interpolation

```html
<p>[ user.name ]</p>
<p>[ count + 1 ]</p>
<p>[ 2 / count ]</p>
```

### Conditionals

```html
<div v:show="[ isLoggedIn ]">Welcome back!</div>
<div v:show="[ !isLoggedIn ] ">Please log in.</div>
```

### Loops

Use `Atom` for lists. Inline loops are not supported by design — Atoms provide better performance and lifecycle control.

### Event Binding

```html
<button @click="this.handleClick()">Click me</button>
<input @input="this.handleInput(e)" @keydown="this.handleKeydown(e)">
```

Events are handled via **event delegation** for performance. Valen attaches a single listener per component and routes events to the correct handler.

### Attribute Binding

```html
<img src="[ user.avatar ]" alt="[ user.name ]" />
<div class="[ isActive ]"></div>
```

## Directives


Directives are special HTML attributes that tells Valen to apply a reactive behaviour to an element. They are prefixed with `v:`.

### Built-in Directives

🔸 `v:show`: Toggles an element's CSS display between 'block' and 'none'

```html
<div v:show="[ isLoggedIn ]">Welcome back, [ user.name ]</div>
```

🔸 `v:exist`: Removes an element from the DOM once the value is false.

```html
<div v:exist="[ isModernBrowser ]">Hello World, from Valen.</div>
```

🔸 `v:text`: Sets the textContent attribute of an element

```html
<div v:text="Welcome back, [ user.name ]"></div>
```


🔸 `v:html`: Dangerously sets the innerHTML attribute of an element. Use sparingly unless the value is from a trusted source.

```html
<div v:html="[ html ]"></div>
```


🔸 `v:once:attribute`: For one-time reactivity.

```html
<img v:once:src="[ source ]" alt="Eko Hotel" />

<div class="privacy-policy" v:once:display="[ ppIsChecked ]"></div>
````

🔸 `v:syn`: This directive tells Valen to ignore the reactive templates between the tags of the element.

```html
<p v:syn>Template is preserved, [ text ].</div>
```

🔸 `v:copy:*`: This directive effectively simplifies copying to clipboard.

```html
// Copies the value of this.name to clipboard
<button v:copy:this.name>Copy</button>

// Copies state.currentMsg to clipboard then calls this.showToast
<button v:copy:state.currentMsg="this.showToast('Copied to clipboard')">Copy</button>


<button v:copy:this.type="console.log('Copied!')">Copy</button>
```


---

## Lifecycle Hooks

| Hook | When It Runs | Available On |
|------|--------------|--------------|
| `created(state)` | Once, immediately after state is initialized | Component, Atom |
| `run(state)` | Once, after the component is rendered to the DOM | Component, Atom |
| `onUpdate({ oldVal, key, newVal }, state)` | Before each reactive update (return `false` to cancel) | Component |
| `onCleanup(state)` | When the component/atom is being destroyed | Component, Atom |

```javascript
function DataFetcher() {
  return {
    state: { data: null, loading: true },
    template: `
      <div>
        <div v:show="[ loading ]">Loading...</div>
        <div v:show="[ !loading ]">[ data.title ]</div>
      </div>
    `,
    async run(state) {
      const res = await fetch('/api/data');
      state.data = await res.json();
      state.loading = false;
    },
    onUpdate({ key, newVal }) {
      console.log(`${key} changed to`, newVal);
      return true; // allow update
    },
    onCleanup(state) {
      console.log('Cleaning up Component');
    }
  };
}
```

---

## Styling

Valen automatically scopes styles to the component that defines them.

### Component Styles

```javascript
function Navbar() {
  return {
    stylesheet: {
      'nav': "display: flex; gap: 1rem;",
      'a': "color: #333; text-decoration: none;"
    }
  };
}
```

Styles are injected into a `<style>` tag in the document `<head>` and scoped using the component's unique identifier. No CSS-in-JS runtime overhead.

### Atom Styles

Atom styles are scoped to the atom's mount element using its `id`:

```javascript
function ItemList() {
  return {
    id: '#items',
    stylesheet: {
      '.item': "padding: 1rem;"
    }
  };
}
```

### Widget Styles

Widget styles use a class-based selector:

```javascript
function Badge() {
  return {
    stylesheet: {
      '.badge': `
        display: inline-block; padding: 0.25rem 0.5rem;
      `
    }
  };
}
```

---

### Direct CSS Properties 

Valen also supports writing direct CSS properties in HTML tags.
It gets converted to valid CSS properties under the hood.

```javascript
function ViewBox() {
  return {
    template: () => {
      return `
        <div
          width="[ size ]px"
          height="[ size ]px"
          display="[ display ]"
          backgroundColor="[ bg ]"
          fontWeight="[ fw ]"
        >
        [ content ]
        </div>
      `
    }
  };
}
```

---

## Event Handling

Valen uses **event delegation** at the component level. Instead of attaching listeners to every button, Valen attaches one listener to the component root and dispatches to your methods.

```javascript
function Form() {
  return {
    state: { email: '', password: '' },
    template: `
      <form @submit="this.submit(e)">
        <input 
          type="email"
          value="[ email ]"
          @input="state.email = value"
          placeholder="Email"
        />
        <input
          type="password"
          value="[ password ]"
          @input="state.password = value"
          placeholder="Password"
        />
        <button type="submit">Login</button>
      </form>
    `,
    created(state) {
      this.submit = (e) => {
        e.preventDefault();
        console.log('Login:', state.email, state.password);
      }
    }
  };
}
```


- `e` — the event object 
- `value` — the event target value
- `state` — component state


---

## Performance

Valen is designed for speed:

- **No Virtual DOM:** Direct DOM manipulation eliminates diffing overhead.
- **Proxy Signals:** Only changed properties trigger updates.
- **Microtask Batching:** State updates are batched in a single microtask to avoid layout thrashing.
- **RAF Batching:** Atom list rendering is chunked into batches of 30 items per animation frame.
- **WeakMap Caching:** Nested reactive objects are cached to avoid creating duplicate Proxies.
- **Event Delegation:** One listener per component instead of per element.
- **LRU Cache:** Internal caches prevent memory leaks and improve repeated lookups.

---

## API Reference

### `Component(componentFunc)`
Registers and returns a component instance.

### `Atom(activatorFunc)`
Registers and returns an atom instance for list rendering.

### `Widget(widgetFunc)`
Registers and returns a widget function for reusable UI elements.

### `render(component)`
Mounts the root component to the DOM. Should be called once.

### `Store(name, initialValue, shouldStore)`
Creates a global reactive store. If `shouldStore` is `true`, persists to `localStorage`.

### `createSignal(state, instance)`
Low-level API. Wraps an object in a reactive Proxy. Used internally by Component, Atom and Store.

---

## Project Structure

```
valen/
├── src/
│   ├── valen.js          # Main entry point — exports all public APIs
│   ├── internal.js       # Shared state, caches, context, utilities
│   ├── render.js         # Root render logic & component orchestration
│   ├── cleanup.js        # detach() & reAttach() lifecycle helpers
│   ├── core/
│   │   ├── component.js  # Component() factory & lifecycle
│   │   ├── atom.js       # Atom() list renderer with RAF batching
│   │   └── widget.js     # Widget() reusable element factory
│   ├── reactivity/
│   │   └── signal.js     # Proxy-based signals & Store implementation
│   ├── dom/
│   │   └── utils.js      # DOM manipulation, event delegation, markup processing
│   ├── parser/
│   │   └── utils.js      # Template parsing, widget rendering, placeholder linting
│   └── router/           # Routing utilities (evolving)
├── package.json
├── LICENSE
└── README.md
```

---

## Browser Support

Valen requires a modern browser with support for:
- ES Modules (`import`/`export`)
- JavaScript Proxies
- `queueMicrotask`
- `requestAnimationFrame`
- `DocumentFragment` and `template` elements

**Supported:** Chrome 63+, Firefox 67+, Safari 11.1+, Edge 79+

---

## License

MIT © 2026 [Tunde Gbolahan](https://github.com/lahan-xyz)

---

## Contributing

Contributions are welcome! Since Valen is buildless, you can start hacking immediately:

1. Clone the repo
2. Open `index.html` (or create one) in your browser
3. Edit files in `src/` and refresh

No `npm install`. No `npm run dev`. Just code.

---

*Built with atomic precision. No build step required.*