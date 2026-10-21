// The smallest DOM the dashboard's glue needs in Node (ui.mjs el/modal, publish-ui.mjs wirePublish): elements with
// children, text, attributes, classes and listeners, a <dialog> that opens and closes, document.body, and window /
// location stand-ins. No layout, no selectors beyond what the tests ask for. installFakeDom() returns the restore
// function; tests call it in a finally block, so the globals never leak into another test.

export class FakeNode {
  constructor(tagName, text = '') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.data = text;                       // the text of a #text node
    const classes = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const write = (set) => { this.className = [...set].join(' '); };
    this.classList = {
      add: (...names) => write(new Set([...classes(), ...names])),
      remove: (...names) => { const set = classes(); names.forEach((n) => set.delete(n)); write(set); },
      toggle: (name, on) => { const set = classes(); const add = on ?? !set.has(name); if (add) set.add(name); else set.delete(name); write(set); return add; },
      contains: (name) => classes().has(name),
    };
  }

  get textContent() {
    return this.tagName === '#TEXT' ? this.data : this.children.map((c) => c.textContent).join('');
  }

  set textContent(value) {
    this.replaceChildren(new FakeNode('#text', String(value ?? '')));
  }

  append(...nodes) {
    for (const node of nodes) {
      const child = node instanceof FakeNode ? node : new FakeNode('#text', String(node));
      child.parent?.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }

  after(node) {
    if (!this.parent) return;
    const siblings = this.parent.children;
    node.parent?.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
  }

  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }

  contains(node) {
    for (let n = node; n; n = n.parent) if (n === this) return true;
    return false;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...event }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() {}
  querySelector() { return null; }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatch('close'); }

  /** Every descendant (depth first) that matches `test`. */
  findAll(test) {
    const out = [];
    for (const child of this.children) {
      if (test(child)) out.push(child);
      out.push(...child.findAll(test));
    }
    return out;
  }
}

/** Installs document, Node, window and location on globalThis; returns the function that restores them. */
export function installFakeDom({ hash = '' } = {}) {
  const names = ['document', 'Node', 'window', 'location'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const body = new FakeNode('body');
  const document = {
    body,
    activeElement: null,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => new FakeNode('#text', text),
    querySelector: () => null,
  };
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define('document', document);
  define('Node', FakeNode);
  define('window', { addEventListener() {}, removeEventListener() {} });
  define('location', { hash });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}
