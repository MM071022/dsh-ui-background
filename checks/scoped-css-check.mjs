// Verify the scoped (chat/sidebar) features of the installed bundle:
// 1. scope root detection via custom-property-definition markers
// 2. chat-scoped label + markdown token CSS
// 3. sidebar-scoped label + zoom-with-compensation CSS
// 4. old-schema settings migration (fontColor/fontSize -> chatFontColor/chatFontSize)
import fs from "node:fs";

import { fileURLToPath } from "node:url";
const clientPath = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const code = fs.readFileSync(clientPath, "utf8");

let captured = null;
const windowStub = {
  __ModuleLoader__: { load(h) { captured = h; } },
  addEventListener() {}, removeEventListener() {}
};

// ---- fake DOM tree: body > frame > [sidebarCol > sidebarRoot, centerCol > chatRoot] ----
const tree = [];
function makeEl(tag, opts = {}) {
  const el = {
    tagName: (tag || "div").toUpperCase(), id: opts.id || "", hidden: false,
    style: {}, dataset: {}, attributes: {}, children: [], parentElement: null,
    innerHTML: "", textContent: "", src: "", value: "", _listeners: {},
    _vars: opts.vars || {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    contains(node) { return node === this || this.children.some((ch) => ch.contains(node)); },
    addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); },
    remove() {}, querySelector() { return makeEl("div"); },
    querySelectorAll() { return []; }, closest() { return null; }, click() {}
  };
  tree.push(el);
  return el;
}
const body = makeEl("body");
const frame = makeEl("div"); body.appendChild(frame);
const sidebarCol = makeEl("div"); frame.appendChild(sidebarCol);
const sidebarRoot = makeEl("div", { vars: { "--dsh-sidebar-inline-padding": "12px" } });
sidebarCol.appendChild(sidebarRoot);
const centerCol = makeEl("div"); frame.appendChild(centerCol);
const chatRoot = makeEl("div", { vars: { "--dsh-chat-content-width": "748px" } });
centerCol.appendChild(chatRoot);

const documentStub = {
  readyState: "complete",
  head: makeEl("head"), documentElement: makeEl("html"), body,
  createElement(tag) { return makeEl(tag); },
  getElementById(id) { return tree.find((e) => e.id === id) ?? null; },
  addEventListener() {},
  querySelectorAll() { return tree; },
  querySelector() { return null; }
};
const getComputedStyleStub = (el) => ({
  color: "rgb(17, 17, 17)",
  getPropertyValue(name) { return (el._vars && el._vars[name]) || ""; }
});

const saved = {
  window: globalThis.window, document: globalThis.document,
  getComputedStyle: globalThis.getComputedStyle, localStorage: globalThis.localStorage,
  alert: globalThis.alert, FileReader: globalThis.FileReader, Image: globalThis.Image
};
let stored = {};
globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.getComputedStyle = getComputedStyleStub;
globalThis.localStorage = {
  getItem(k) { return stored[k] ?? null; },
  setItem(k, v) { stored[k] = String(v); },
  removeItem(k) { delete stored[k]; }
};
globalThis.alert = () => {};
globalThis.FileReader = class {};
globalThis.Image = class {};

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok ? "" : "  <<< " + detail));
  if (!ok) failures++;
}

try {
  (0, eval)(code);
  const mod = captured.factory(() => { throw new Error("unexpected require"); });

  // --- migration check: seed old schema, call apply (loadSettings migrates) ---
  stored["dsh-ui-background:settings:v1"] = JSON.stringify({
    background: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    backgroundOpacity: 50,
    fontColor: "#aa2200",
    fontSize: 20
  });
  mod.apply({ on() {} });

  const css = documentStub.getElementById("dsh-ui-background-style").textContent;
  check("chat scope element tagged", chatRoot.getAttribute("data-dsh-ui-scope") === "chat");
  check("sidebar scope element tagged", sidebarRoot.getAttribute("data-dsh-ui-scope") === "sidebar");
  check("migrated chat color applied", css.includes('[data-dsh-ui-scope="chat"]{--dsw-alias-label-primary: #aa2200 !important'));
  check("migrated chat size applied (20px)", css.includes("--dsw-font-markdown-base: 400 20px/35px var(--dsw-font-family) !important"));
  check("no sidebar overrides when unset", !css.includes('data-dsh-ui-scope="sidebar"]{'));
  check("bg-base transparent on body", css.includes("body, body[data-ds-dark-theme]{--dsw-alias-bg-base: transparent !important}"));
  check("no zoom when sidebar size default", !css.includes("zoom:"));

  // --- set all scoped settings ---
  stored["dsh-ui-background:settings:v1"] = JSON.stringify({
    background: "",
    backgroundOpacity: 70,
    chatFontColor: "#ff3366",
    chatFontSize: 18,
    sidebarFontColor: "#2266ff",
    sidebarFontSize: 120
  });
  // re-apply via the panel's setSettings path is not directly reachable; re-run apply on a fresh eval instead
} finally {
  Object.assign(globalThis, saved);
}

// Second phase: fresh eval with full settings, reusing a clean fake DOM.
function secondPhase() {
  const tree2 = [];
  function makeEl(tag, opts = {}) {
    const el = {
      tagName: (tag || "div").toUpperCase(), id: opts.id || "", hidden: false,
      style: {}, dataset: {}, attributes: {}, children: [], parentElement: null,
      innerHTML: "", textContent: "", src: "", value: "", _listeners: {},
      _vars: opts.vars || {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
      contains(node) { return node === this || this.children.some((ch) => ch.contains(node)); },
      addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); },
      remove() {}, querySelector() { return makeEl("div"); },
      querySelectorAll() { return []; }, closest() { return null; }, click() {}
    };
    tree2.push(el);
    return el;
  }
  const body2 = makeEl("body");
  const frame2 = makeEl("div"); body2.appendChild(frame2);
  const sc2 = makeEl("div"); frame2.appendChild(sc2);
  const sr2 = makeEl("div", { vars: { "--dsh-sidebar-inline-padding": "12px" } }); sc2.appendChild(sr2);
  const cc2 = makeEl("div"); frame2.appendChild(cc2);
  const cr2 = makeEl("div", { vars: { "--dsh-chat-content-width": "748px" } }); cc2.appendChild(cr2);
  const doc2 = {
    readyState: "complete", head: makeEl("head"), documentElement: makeEl("html"), body: body2,
    createElement(tag) { return makeEl(tag); },
    getElementById(id) { return tree2.find((e) => e.id === id) ?? null; },
    addEventListener() {}, querySelectorAll() { return tree2; }, querySelector() { return null; }
  };
  const gcs2 = (el) => ({ color: "rgb(17, 17, 17)", getPropertyValue(name) { return (el._vars && el._vars[name]) || ""; } });
  const saved2 = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, localStorage: globalThis.localStorage };
  globalThis.window = windowStub;
  globalThis.document = doc2;
  globalThis.getComputedStyle = gcs2;
  globalThis.localStorage = {
    getItem() { return null; },
    setItem() {}, removeItem() {}
  };
  try {
    (0, eval)(code);
    const mod2 = captured.factory(() => { throw new Error("unexpected require"); });
    // reach into apply via a saved-settings seed then call apply
    const ls2 = globalThis.localStorage;
    ls2.getItem = (k) => JSON.stringify({
      background: "", backgroundOpacity: 70,
      chatFontColor: "#ff3366", chatFontSize: 18,
      sidebarFontColor: "#2266ff", sidebarFontSize: 120
    });
    mod2.apply({ on() {} });
    const css2 = doc2.getElementById("dsh-ui-background-style").textContent;
    check("chat color scoped", css2.includes('[data-dsh-ui-scope="chat"]{--dsw-alias-label-primary: #ff3366 !important'));
    check("chat secondary derived", css2.includes("--dsw-alias-label-secondary: rgba(255,51,102,0.78) !important"));
    check("chat markdown tokens", css2.includes("--dsw-font-markdown-h1: 700 26px/37px var(--dsw-font-family) !important"));
    check("sidebar color scoped", css2.includes('[data-dsh-ui-scope="sidebar"]{--dsw-alias-label-primary: #2266ff !important'));
    check("sidebar zoom", css2.includes("zoom: 1.2 !important"));
    check("sidebar width compensation", css2.includes("width: calc(100% / 1.2)"));
    check("sidebar height compensation", css2.includes("height: calc(100% / 1.2)"));
    check("no bg-base override without background", !css2.includes("--dsw-alias-bg-base: transparent"));
  } finally {
    Object.assign(globalThis, saved2);
  }
}
secondPhase();

// Third phase: background image width/height (长宽) — verify pixel-size rendering,
// lock-ratio derivation, manual number entry, and panel wiring.
function thirdPhase() {
  const tree3 = [];
  function makeEl(tag, opts = {}) {
    const el = {
      tagName: (tag || "div").toUpperCase(), id: opts.id || "", hidden: false,
      style: {}, dataset: {}, attributes: {}, children: [], parentElement: null,
      innerHTML: "", textContent: "", src: "", value: "", disabled: false,
      _listeners: {}, _vars: opts.vars || {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
      contains(node) { return node === this || this.children.some((ch) => ch.contains(node)); },
      addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); },
      remove() {}, querySelector() { return makeEl("div"); },
      querySelectorAll() { return []; }, closest() { return null; }, click() {}
    };
    tree3.push(el);
    return el;
  }
  const body3 = makeEl("body");
  const frame3 = makeEl("div"); body3.appendChild(frame3);
  const sc3 = makeEl("div"); frame3.appendChild(sc3);
  const sr3 = makeEl("div", { vars: { "--dsh-sidebar-inline-padding": "12px" } }); sc3.appendChild(sr3);
  const cc3 = makeEl("div"); frame3.appendChild(cc3);
  const cr3 = makeEl("div", { vars: { "--dsh-chat-content-width": "748px" } }); cc3.appendChild(cr3);
  const doc3 = {
    readyState: "complete", head: makeEl("head"), documentElement: makeEl("html"), body: body3,
    createElement(tag) { return makeEl(tag); },
    getElementById(id) { return tree3.find((e) => e.id === id) ?? null; },
    addEventListener() {}, querySelectorAll() { return tree3; }, querySelector() { return null; }
  };
  const gcs3 = (el) => ({ color: "rgb(17, 17, 17)", getPropertyValue(name) { return (el._vars && el._vars[name]) || ""; } });
  const saved3 = {
    window: globalThis.window, document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle, localStorage: globalThis.localStorage,
    alert: globalThis.alert, FileReader: globalThis.FileReader, Image: globalThis.Image
  };
  const win3 = { __ModuleLoader__: windowStub.__ModuleLoader__, innerWidth: 1920, innerHeight: 1080, addEventListener() {} };
  globalThis.window = win3;
  globalThis.document = doc3;
  globalThis.getComputedStyle = gcs3;
  const storage3 = {};
  globalThis.localStorage = {
    getItem(k) { return storage3[k] ?? null; },
    setItem(k, v) { storage3[k] = String(v); },
    removeItem(k) { delete storage3[k]; }
  };
  globalThis.alert = () => {};
  globalThis.FileReader = class {};
  globalThis.Image = class {};
  try {
    (0, eval)(code);
    const mod3 = captured.factory(() => { throw new Error("unexpected require"); });
    // 3840x2160 image; manual display size 2880x1620
    storage3["dsh-ui-background:settings:v1"] = JSON.stringify({
      background: "data:image/png;base64,AAAA",
      backgroundOpacity: 60,
      bgWidth: 2880,
      bgHeight: 1620,
      bgLockRatio: true,
      backgroundWidth: 3840,
      backgroundHeight: 2160
    });
    mod3.apply({ on() {} });
    const layer3 = doc3.getElementById("dsh-ui-background-layer");
    check("layer exists", !!layer3);
    check("custom w/h -> 2880px 1620px", layer3 && layer3.style.backgroundSize === "2880px 1620px", layer3 && layer3.style.backgroundSize);
    check("position center", layer3 && layer3.style.backgroundPosition === "50% 50%", layer3 && layer3.style.backgroundPosition);
    check("opacity 0.6", layer3 && layer3.style.opacity === "0.6");

    // Simulate slider input on width (lock ratio ON, image 3840x2160): width 1920 -> height 1080
    const panel3 = doc3.getElementById("dsh-ui-background-panel");
    const inputFn = (panel3._listeners["input"] || [])[0];
    const changeFn = (panel3._listeners["change"] || [])[0];
    check("panel input listener registered", typeof inputFn === "function");
    check("panel change listener registered", typeof changeFn === "function");
    inputFn({ target: { value: "1920", getAttribute: (k) => (k === "data-set" ? "w" : null) } });
    check("lock-ratio width 1920 -> height 1080", layer3.style.backgroundSize === "1920px 1080px", layer3.style.backgroundSize);

    // Manual number entry: wNum change to 960 -> height 540
    changeFn({ target: { value: "960", getAttribute: (k) => (k === "data-set" ? "wNum" : null) } });
    check("manual width 960 -> 960px 540px", layer3.style.backgroundSize === "960px 540px", layer3.style.backgroundSize);

    // Manual number entry: 0 = auto (cover)
    changeFn({ target: { value: "0", getAttribute: (k) => (k === "data-set" ? "wNum" : null) } });
    check("width 0 -> cover (auto)", layer3.style.backgroundSize === "cover", layer3.style.backgroundSize);

    // Lock OFF: height change must NOT touch width
    changeFn({ target: { checked: false, getAttribute: (k) => (k === "data-set" ? "lock" : null) } });
    inputFn({ target: { value: "2000", getAttribute: (k) => (k === "data-set" ? "w" : null) } });
    changeFn({ target: { value: "900", getAttribute: (k) => (k === "data-set" ? "hNum" : null) } });
    check("lock off: independent h 900 keeps w 2000", layer3.style.backgroundSize === "2000px 900px", layer3.style.backgroundSize);
  } finally {
    Object.assign(globalThis, saved3);
  }
}
thirdPhase();

console.log(failures === 0 ? "ALL SCOPED CHECKS PASSED" : failures + " CHECKS FAILED");
process.exit(failures === 0 ? 0 : 1);
