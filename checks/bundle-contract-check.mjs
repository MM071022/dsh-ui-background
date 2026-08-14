// Simulate the browser module-loader contract for the built client bundle:
// 1. window.__ModuleLoader__.load captures { id, factory }
// 2. factory(require) returns module exports containing apply + inject
// 3. apply() initializes without throwing (DOM APIs are stubbed)
import fs from "node:fs";

import { fileURLToPath } from "node:url";
const clientPath = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const code = fs.readFileSync(clientPath, "utf8");

let captured = null;
const windowStub = {
  __ModuleLoader__: {
    load(handoff) {
      captured = handoff;
    }
  }
};

// Minimal DOM stubs so apply() can run outside a browser.
const elements = new Map();
function makeEl(tag) {
  return {
    tagName: (tag || "div").toUpperCase(),
    id: "",
    hidden: false,
    style: {},
    dataset: {},
    attributes: {},
    children: [],
    innerHTML: "",
    textContent: "",
    src: "",
    value: "",
    _listeners: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); },
    remove() { /* noop */ },
    querySelector() { return makeEl("div"); },
    querySelectorAll() { return []; },
    closest() { return null; },
    click() {}
  };
}
const documentStub = {
  readyState: "complete",
  head: makeEl("head"),
  documentElement: makeEl("html"),
  body: makeEl("body"),
  _els: [],
  createElement(tag) { const el = makeEl(tag); this._els.push(el); return el; },
  getElementById(id) { return this._els.find((e) => e.id === id) ?? null; },
  addEventListener() {},
  querySelectorAll() { return []; },
  querySelector() { return null; }
};

const getComputedStyleStub = () => ({ color: "rgb(17, 17, 17)", getPropertyValue: () => "" });

const oldWindow = globalThis.window;
const oldDocument = globalThis.document;
const oldGetComputedStyle = globalThis.getComputedStyle;
const oldLocalStorage = globalThis.localStorage;

globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.getComputedStyle = getComputedStyleStub;
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); }
};
globalThis.alert = () => {};
globalThis.FileReader = class {};
globalThis.Image = class {};

try {
  // eslint-disable-next-line no-eval
  (0, eval)(code);

  if (!captured) throw new Error("bundle did not call __ModuleLoader__.load");
  console.log("registered id:", captured.id);

  const mod = captured.factory((spec) => {
    throw new Error("unexpected require call: " + spec);
  });
  console.log("exports keys:", Object.keys(mod).join(", "));
  console.log("inject:", JSON.stringify(mod.inject));
  console.log("apply type:", typeof mod.apply);

  const ctxStub = { on() {} };
  mod.apply(ctxStub);
  console.log("apply() ran without throwing");

  const panel = documentStub.getElementById("dsh-ui-background-panel");
  const toggle = documentStub.getElementById("dsh-ui-background-toggle");
  const styleEl = documentStub.getElementById("dsh-ui-background-style");
  console.log("panel created:", !!panel, "| toggle created:", !!toggle, "| style created:", !!styleEl);
  console.log("style css length:", (styleEl && styleEl.textContent || "").length);
  console.log("css contains bg-base transparent:", (styleEl && styleEl.textContent || "").includes("--dsw-alias-bg-base: transparent"));

  console.log("OK: bundle contract verified");
} finally {
  globalThis.window = oldWindow;
  globalThis.document = oldDocument;
  globalThis.getComputedStyle = oldGetComputedStyle;
  globalThis.localStorage = oldLocalStorage;
}
