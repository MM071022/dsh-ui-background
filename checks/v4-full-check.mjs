// Comprehensive v4 checks for dsh-ui-background:
// migration v3->v4, multi-image, carousel, blur/overlay/position/fillMode,
// glass, next button, width/height + lock, import/export, drag handlers.
import fs from "node:fs";

import { fileURLToPath } from "node:url";
const clientPath = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const code = fs.readFileSync(clientPath, "utf8");

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok ? "" : "  <<< " + detail));
  if (!ok) failures++;
}

function makeEnv(seedSettings, opts = {}) {
  let captured = null;
  const intervals = [];
  const cleared = [];
  const listeners = {};
  const win = {
    __ModuleLoader__: { load(h) { captured = h; } },
    innerWidth: 1920, innerHeight: 1080,
    addEventListener(ev, fn) { (listeners[ev] ??= []).push(fn); },
    removeEventListener(ev, fn) {
      const arr = listeners[ev] ?? [];
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval(id) { cleared.push(id); }
  };
  const els = [];
  function makeEl(tag, o = {}) {
    const el = {
      tagName: (tag || "div").toUpperCase(), id: o.id || "", hidden: false,
      style: {}, dataset: {}, attributes: {}, children: [], parentElement: null,
      innerHTML: "", textContent: "", src: "", value: "", disabled: false, checked: false,
      _listeners: {}, _vars: o.vars || {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      hasAttribute(k) { return k in this.attributes; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
      contains(n) { return n === this || this.children.some((ch) => ch.contains(n)); },
      addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); },
      remove() {},
      querySelector(sel) { (this._qs ??= {})[sel] ??= makeEl("div"); return this._qs[sel]; },
      querySelectorAll() { return []; }, closest() { return null; }, click() {}, focus() {}
    };
    els.push(el);
    return el;
  }
  const body = makeEl("body");
  const frame = makeEl("div"); body.appendChild(frame);
  const sc = makeEl("div"); frame.appendChild(sc);
  const sr = makeEl("div", { vars: { "--dsh-sidebar-inline-padding": "12px" } }); sc.appendChild(sr);
  const cc = makeEl("div"); frame.appendChild(cc);
  const cr = makeEl("div", { vars: { "--dsh-chat-content-width": "748px" } }); cc.appendChild(cr);
  const doc = {
    readyState: "complete", head: makeEl("head"), documentElement: makeEl("html"), body,
    createElement(tag) { return makeEl(tag); },
    getElementById(id) { return els.find((e) => e.id === id) ?? null; },
    addEventListener() {}, querySelectorAll: () => els, querySelector: () => null
  };
  const gcs = (el) => ({ color: "rgb(17,17,17)", getPropertyValue(name) { return (el._vars && el._vars[name]) || ""; } });
  const storage = {};
  if (seedSettings !== null) storage["dsh-ui-background:settings:v1"] = JSON.stringify(seedSettings);
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.getComputedStyle = gcs;
  globalThis.localStorage = {
    getItem(k) { return storage[k] ?? null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; }
  };
  globalThis.alert = () => {};
  globalThis.prompt = () => null;
  globalThis.FileReader = class {};
  globalThis.Image = class {};
  globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  globalThis.clearInterval = (id) => { cleared.push(id); };
  (0, eval)(code);
  const mod = captured.factory(() => { throw new Error("unexpected require"); });
  mod.apply({ on() {} });
  return { win, doc, storage, listeners, intervals, cleared, panel: () => doc.getElementById("dsh-ui-background-panel"), css: () => doc.getElementById("dsh-ui-background-style").textContent };
}

const savedGlobals = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, localStorage: globalThis.localStorage, alert: globalThis.alert, prompt: globalThis.prompt, FileReader: globalThis.FileReader, Image: globalThis.Image };

try {
  // ── Phase 1: migration v3 -> v4 ──
  {
    const env = makeEnv({
      background: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      backgroundOpacity: 50, backgroundWidth: 3840, backgroundHeight: 2160,
      bgWidth: 2880, bgHeight: 1620, bgLockRatio: true,
      fontColor: "#aa2200", fontSize: 20
    });
    const stored = JSON.parse(env.storage["dsh-ui-background:settings:v1"]);
    check("P1 images migrated", Array.isArray(stored.images) && stored.images.length === 1 && stored.images[0].data === "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
    check("P1 legacy keys removed", !("background" in stored) && !("fontColor" in stored) && !("fontSize" in stored));
    check("P1 bgWidth preserved", stored.bgWidth === 2880 && stored.bgHeight === 1620);
    const css = env.css();
    check("P1 chat color migrated", css.includes('[data-dsh-ui-scope="chat"]{--dsw-alias-label-primary: #aa2200 !important'));
    check("P1 chat size migrated", css.includes("--dsw-font-markdown-base: 400 20px/35px var(--dsw-font-family) !important"));
    check("P1 bg-base transparent", css.includes("body, body[data-ds-dark-theme]{--dsw-alias-bg-base: transparent !important}"));
    const layer = env.doc.getElementById("dsh-ui-background-layer");
    check("P1 layer size from bgWidth/Height", layer && layer.style.backgroundSize === "2880px 1620px", layer && layer.style.backgroundSize);
    check("P1 layer opacity", layer && layer.style.opacity === "0.5");
  }

  // ── Phase 2: full v4 background styling + glass + carousel ──
  {
    const env = makeEnv({
      images: [
        { id: "a", data: "data:image/png;base64,AA", width: 3840, height: 2160, name: "A" },
        { id: "b", data: "data:image/png;base64,BB", width: 1000, height: 500, name: "B" }
      ],
      current: 0, backgroundOpacity: 70, blur: 8, overlay: 30, fillMode: "cover",
      positionX: 30, positionY: 70, glass: true,
      carousel: true, carouselInterval: 15, carouselRandom: true,
      chatFontColor: "#ff3366", chatFontSize: 18,
      sidebarFontColor: "#2266ff", sidebarFontSize: 120
    });
    const css = env.css();
    check("P2 chat color", css.includes('[data-dsh-ui-scope="chat"]{--dsw-alias-label-primary: #ff3366 !important'));
    check("P2 markdown tokens", css.includes("--dsw-font-markdown-h1: 700 26px/37px var(--dsw-font-family) !important"));
    check("P2 sidebar zoom", css.includes("zoom: 1.2 !important") && css.includes("width: calc(100% / 1.2)"));
    check("P2 glass bubble light", css.includes("--dsw-specific-bubble: rgba(255,255,255,0.5) !important"));
    check("P2 glass bubble dark", css.includes("body[data-ds-dark-theme] [data-dsh-ui-scope=\"chat\"]{--dsw-specific-bubble: rgba(21,21,23,0.55) !important"));
    check("P2 glass sidebar", css.includes('body{--dsw-specific-sidebar-fill: rgba(255,255,255,0.5) !important}'));
    const layer = env.doc.getElementById("dsh-ui-background-layer");
    check("P2 layer image A", layer && layer.style.backgroundImage === 'url("data:image/png;base64,AA")');
    check("P2 blur filter", layer && layer.style.filter === "blur(8px)");
    check("P2 blur inset", layer && layer.style.inset === "-12px", layer && layer.style.inset);
    check("P2 position", layer && layer.style.backgroundPosition === "30% 70%");
    check("P2 fillMode cover", layer && layer.style.backgroundSize === "cover");
    const overlay = env.doc.getElementById("dsh-ui-background-overlay");
    check("P2 overlay alpha", overlay && overlay.style.background === "rgba(0,0,0,0.3)");
    const next = env.doc.getElementById("dsh-ui-background-next");
    check("P2 next button visible", next && next.hasAttribute("data-show"));
    check("P2 carousel scheduled 15000ms", env.intervals.some((i) => i.ms === 15000));
  }

  // ── Phase 3: interactions (w/h lock, manual, fill, next, blur/overlay, glass toggle, import/export) ──
  {
    const env = makeEnv({
      images: [
        { id: "a", data: "data:image/png;base64,AA", width: 3840, height: 2160, name: "A" },
        { id: "b", data: "data:image/png;base64,BB", width: 1000, height: 500, name: "B" }
      ],
      current: 0, backgroundOpacity: 60, blur: 0, overlay: 0, fillMode: "cover",
      bgWidth: 2880, bgHeight: 1620, bgLockRatio: true,
      positionX: 50, positionY: 50, carousel: false, carouselInterval: 10,
      carouselRandom: false, glass: false
    });
    const panel = env.panel();
    const layer = env.doc.getElementById("dsh-ui-background-layer");
    const inputFn = (panel._listeners["input"] || [])[0];
    const changeFn = (panel._listeners["change"] || [])[0];
    const clickFn = (panel._listeners["click"] || [])[0];
    const ev = (o) => ({ target: o });

    inputFn(ev({ value: "1920", getAttribute: (k) => (k === "data-set" ? "w" : null) }));
    check("P3 lock width 1920 -> height 1080", layer.style.backgroundSize === "1920px 1080px", layer.style.backgroundSize);
    changeFn(ev({ value: "960", getAttribute: (k) => (k === "data-set" ? "wNum" : null) }));
    check("P3 manual width 960 -> 960px 540px", layer.style.backgroundSize === "960px 540px", layer.style.backgroundSize);
    changeFn(ev({ value: "0", getAttribute: (k) => (k === "data-set" ? "wNum" : null) }));
    check("P3 width 0 -> cover", layer.style.backgroundSize === "cover");
    changeFn(ev({ checked: false, getAttribute: (k) => (k === "data-set" ? "lock" : null) }));
    inputFn(ev({ value: "2000", getAttribute: (k) => (k === "data-set" ? "w" : null) }));
    changeFn(ev({ value: "900", getAttribute: (k) => (k === "data-set" ? "hNum" : null) }));
    check("P3 lock off independent", layer.style.backgroundSize === "2000px 900px", layer.style.backgroundSize);

    // clear custom w/h so fill modes take effect
    changeFn(ev({ value: "0", getAttribute: (k) => (k === "data-set" ? "wNum" : null) }));
    changeFn(ev({ value: "0", getAttribute: (k) => (k === "data-set" ? "hNum" : null) }));
    check("P3 cleared -> cover", layer.style.backgroundSize === "cover");
    changeFn(ev({ value: "stretch", getAttribute: (k) => (k === "data-set" ? "fill" : null) }));
    check("P3 fill stretch", layer.style.backgroundSize === "100% 100%");
    changeFn(ev({ value: "tile", getAttribute: (k) => (k === "data-set" ? "fill" : null) }));
    check("P3 fill tile repeat+auto", layer.style.backgroundRepeat === "repeat" && layer.style.backgroundSize === "auto");
    changeFn(ev({ value: "cover", getAttribute: (k) => (k === "data-set" ? "fill" : null) }));

    inputFn(ev({ value: "12", getAttribute: (k) => (k === "data-set" ? "blur" : null) }));
    check("P3 blur 12 -> filter+inset", layer.style.filter === "blur(12px)" && layer.style.inset === "-18px", layer.style.filter + " / " + layer.style.inset);
    inputFn(ev({ value: "40", getAttribute: (k) => (k === "data-set" ? "overlay" : null) }));
    const overlay = env.doc.getElementById("dsh-ui-background-overlay");
    check("P3 overlay 40", overlay.style.background === "rgba(0,0,0,0.4)");
    inputFn(ev({ value: "10", getAttribute: (k) => (k === "data-set" ? "posX" : null) }));
    check("P3 positionX 10", layer.style.backgroundPosition === "10% 50%");
    changeFn(ev({ checked: true, getAttribute: (k) => (k === "data-set" ? "glass" : null) }));
    check("P3 glass enabled in css", env.css().includes("--dsw-specific-bubble: rgba(255,255,255,0.5) !important"));
    changeFn(ev({ checked: false, getAttribute: (k) => (k === "data-set" ? "glass" : null) }));

    // next image via quick button
    const nextBtn = env.doc.getElementById("dsh-ui-background-next");
    const nextClick = (nextBtn._listeners["click"] || [])[0];
    nextClick({});
    const stored = JSON.parse(env.storage["dsh-ui-background:settings:v1"]);
    check("P3 next -> current 1", stored.current === 1);
    check("P3 next -> layer B", layer.style.backgroundImage === 'url("data:image/png;base64,BB")');

    // export: clipboard unavailable -> fallback fills textarea
    const makeActBtn = (act) => {
      const btn = { closest: () => btn };
      btn.getAttribute = (k) => (k === "data-act" ? act : null);
      return btn;
    };
    clickFn({ target: makeActBtn("export") });
    const box = panel.querySelector('[data-set="importText"]');
    const io = panel.querySelector('[data-val="ioStatus"]');
    check("P3 export fallback fills box", box && typeof box.value === "string" && box.value.includes('"images"'));
    check("P3 export status", io && io.textContent.includes("已填入"));

    // import: paste modified JSON (2 images -> 1) and apply
    const parsed = JSON.parse(box.value);
    parsed.images = parsed.images.slice(0, 1);
    box.value = JSON.stringify(parsed);
    clickFn({ target: makeActBtn("importApply") });
    const after = JSON.parse(env.storage["dsh-ui-background:settings:v1"]);
    check("P3 import applied (1 image)", Array.isArray(after.images) && after.images.length === 1);
    check("P3 import status", io.textContent.includes("导入成功"));

    // invalid import -> error status
    box.value = "{not json";
    clickFn({ target: makeActBtn("importApply") });
    check("P3 import bad json error", io.textContent.includes("导入失败"));
  }

  // ── Phase 4: carousel on -> interval; disable -> clear; drag handlers registered ──
  {
    const env = makeEnv({
      images: [
        { id: "a", data: "data:image/png;base64,AA", width: 100, height: 100, name: "A" },
        { id: "b", data: "data:image/png;base64,BB", width: 100, height: 100, name: "B" }
      ],
      current: 0, carousel: true, carouselInterval: 20
    });
    check("P4 carousel 20000ms", env.intervals.some((i) => i.ms === 20000));
    const panel = env.panel();
    const changeFn = (panel._listeners["change"] || [])[0];
    const ev = (o) => ({ target: o });
    changeFn(ev({ checked: false, getAttribute: (k) => (k === "data-set" ? "carousel" : null) }));
    check("P4 carousel disabled -> cleared", env.cleared.length > 0);
    check("P4 drag handlers registered", ["dragenter", "dragover", "dragleave", "drop"].every((e) => (env.listeners[e] || []).length > 0));
    // drop event with a non-image file should not crash
    const dropFn = (env.listeners["drop"] || [])[0];
    dropFn({ dataTransfer: { files: [{ type: "text/plain", name: "a.txt" }] }, preventDefault() {} });
    check("P4 drop non-image ignored", true);
  }
} finally {
  Object.assign(globalThis, savedGlobals);
}

console.log(failures === 0 ? "ALL V4 CHECKS PASSED" : failures + " CHECKS FAILED");
process.exit(failures === 0 ? 0 : 1);
