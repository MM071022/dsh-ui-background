// End-to-end check of the CSS generation with non-default settings:
// background image, font color and font size all set.
import fs from "node:fs";

import { fileURLToPath } from "node:url";
const clientPath = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const code = fs.readFileSync(clientPath, "utf8");

let captured = null;
const windowStub = {
  _listeners: {},
  addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); },
  removeEventListener(ev, fn) {
    const list = this._listeners[ev] ?? [];
    const index = list.indexOf(fn);
    if (index !== -1) list.splice(index, 1);
  },
  __ModuleLoader__: {
    load(handoff) { captured = handoff; }
  }
};

const elements = [];
function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    id: "", hidden: false, style: {}, dataset: {}, attributes: {},
    children: [], innerHTML: "", textContent: "", src: "", value: "",
    _listeners: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); },
    remove() {},
    querySelector() { return makeEl("div"); },
    querySelectorAll() { return []; },
    closest() { return null; },
    click() {}
  };
  elements.push(el);
  return el;
}
const documentStub = {
  readyState: "complete",
  head: makeEl("head"), documentElement: makeEl("html"), body: makeEl("body"),
  createElement(tag) { return makeEl(tag); },
  getElementById(id) { return elements.find((e) => e.id === id) ?? null; },
  addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }
};
const getComputedStyleStub = () => ({ color: "rgb(17, 17, 17)", getPropertyValue: () => "" });

const saved = {
  window: globalThis.window, document: globalThis.document,
  getComputedStyle: globalThis.getComputedStyle, localStorage: globalThis.localStorage,
  alert: globalThis.alert, FileReader: globalThis.FileReader, Image: globalThis.Image
};
const oldConsoleError = console.error;
const initializationErrors = [];
globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.getComputedStyle = getComputedStyleStub;
globalThis.localStorage = {
  _m: new Map([
    ["dsh-ui-background:settings:v1", JSON.stringify({
      background: "data:image/png;base64,AAAABBBBCCCC",
      backgroundOpacity: 45,
      fontColor: "#ff3366",
      fontSize: 18
    })]
  ]),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); }
};
globalThis.alert = () => {};
globalThis.FileReader = class {};
globalThis.Image = class {};
console.error = (...args) => initializationErrors.push(args.map(String).join(" "));

try {
  (0, eval)(code);
  const mod = captured.factory(() => { throw new Error("unexpected require"); });
  mod.apply({ on() {} });
  if (initializationErrors.length) {
    throw new Error("client initialization logged errors: " + initializationErrors.join(" | "));
  }

  const css = documentStub.getElementById("dsh-ui-background-style").textContent;
  const checks = [
    ["bg-base transparent", css.includes("--dsw-alias-bg-base: transparent !important")],
    ["label-primary color", css.includes("--dsw-alias-label-primary: #ff3366 !important")],
    ["label-secondary derived", css.includes("rgba(255,51,102,0.78)")],
    ["font base composite", css.includes("--dsw-font-markdown-base: 400 18px/32px var(--dsw-font-family) !important")],
    ["font h1 composite", css.includes("--dsw-font-markdown-h1: 700 26px/37px var(--dsw-font-family) !important")],
    ["font code composite", css.includes("--dsw-font-markdown-code: 400 18px/28px var(--ds-font-family-code) !important")],
    ["font small size", css.includes("--dsw-font-markdown-small-font-size: 16px !important")],
    ["layer exists", !!documentStub.getElementById("dsh-ui-background-layer")],
    ["layer bg url", documentStub.getElementById("dsh-ui-background-layer").style.backgroundImage === 'url("data:image/png;base64,AAAABBBBCCCC")'],
    ["layer opacity", documentStub.getElementById("dsh-ui-background-layer").style.opacity === "0.45"]
  ];
  let fail = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? "PASS" : "FAIL") + "  " + name);
    if (!ok) fail++;
  }
  console.log(fail === 0 ? "ALL CSS CHECKS PASSED" : fail + " CHECKS FAILED");
  process.exit(fail === 0 ? 0 : 1);
} finally {
  console.error = oldConsoleError;
  Object.assign(globalThis, saved);
}
