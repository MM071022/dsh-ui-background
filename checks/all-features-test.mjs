// ALL-FEATURES test suite for dsh-ui-background (node simulation).
// Covers: bundle contract, bootstrap, scopes, migration (v1/v2/v3->v4),
// multi-image list, carousel/random, styling (opacity/blur/overlay/position/
// fillMode/w-h/lock), glass, fonts (chat/sidebar), import/export, reset,
// drag&drop, lifecycle/dispose, edge cases.
import fs from "node:fs";

import { fileURLToPath } from "node:url";
const clientPath = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const code = fs.readFileSync(clientPath, "utf8");

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) passes++;
  else failures++;
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok ? "" : "  <<< " + detail));
}

// ---- FileReader polyfill (Node has no FileReader) ----
class FakeFileReader {
  constructor() { this.result = ""; }
  readAsDataURL(file) {
    Promise.resolve(file.arrayBuffer()).then((buf) => {
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      this.result = "data:" + (file.type || "application/octet-stream") + ";base64," + btoa(binary);
      if (this.onload) this.onload();
    }).catch((err) => { if (this.onerror) this.onerror(err); });
  }
}

// ---- environment factory ----
function makeEnv(options = {}) {
  const {
    seed = null,
    imageDims = { w: 3840, h: 2160 },
    promptResult = null,
    clipboard = null
  } = options;

  let captured = null;
  const intervals = [];
  const cleared = [];
  const windowListeners = {};
  let disposeFn = null;

  const win = {
    __ModuleLoader__: { load(h) { captured = h; } },
    innerWidth: 1920, innerHeight: 1080,
    addEventListener(ev, fn) { (windowListeners[ev] ??= []).push(fn); },
    removeEventListener(ev, fn) {
      const arr = windowListeners[ev] ?? [];
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    }
  };

  const els = [];
  function makeEl(tag, o = {}) {
    const el = {
      tagName: (tag || "div").toUpperCase(), id: o.id || "", hidden: false,
      style: {}, dataset: {}, attributes: {}, children: [], parentElement: null,
      _innerHTML: "", textContent: "", src: "", value: "", disabled: false, checked: false,
      files: null, _listeners: {}, _qs: {}, _vars: o.vars || {},
      set innerHTML(v) { this._innerHTML = String(v); this.children.length = 0; },
      get innerHTML() { return this._innerHTML; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      hasAttribute(k) { return k in this.attributes; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
      contains(n) { return n === this || this.children.some((ch) => ch.contains(n)); },
      addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); },
      remove() {
        const i = els.indexOf(this);
        if (i !== -1) els.splice(i, 1);
        if (this.parentElement) {
          const pi = this.parentElement.children.indexOf(this);
          if (pi !== -1) this.parentElement.children.splice(pi, 1);
          this.parentElement = null;
        }
      },
      querySelector(sel) { (this._qs[sel] ??= makeEl("div")); return this._qs[sel]; },
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
  if (seed !== null) storage["dsh-ui-background:settings:v1"] = JSON.stringify(seed);

  const saved = {
    window: globalThis.window, document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle, localStorage: globalThis.localStorage,
    alert: globalThis.alert, prompt: globalThis.prompt, FileReader: globalThis.FileReader,
    Image: globalThis.Image, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval
  };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.getComputedStyle = gcs;
  globalThis.localStorage = {
    getItem(k) { return storage[k] ?? null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; }
  };
  globalThis.alert = (m) => { options.lastAlert = m; };
  globalThis.prompt = () => promptResult;
  globalThis.FileReader = FakeFileReader;
  class FakeImage {
    constructor() { this._src = ""; }
    set src(v) {
      this._src = v;
      const d = (options.imageDimsFn && options.imageDimsFn(v)) || imageDims;
      this.naturalWidth = d.w;
      this.naturalHeight = d.h;
      this.width = d.w;
      this.height = d.h;
      queueMicrotask(() => { if (this.onload) this.onload(); });
    }
    get src() { return this._src; }
  }
  globalThis.Image = FakeImage;
  globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  globalThis.clearInterval = (id) => { cleared.push(id); };
  try {
    if (clipboard) {
      Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: clipboard } }, configurable: true });
    } else {
      Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    }
  } catch (err) { /* ignore */ }

  (0, eval)(code);
  const mod = captured.factory(() => { throw new Error("unexpected require"); });
  mod.apply({ on(ev, fn) { if (ev === "dispose") disposeFn = fn; } });

  const helpers = {
    panel: () => doc.getElementById("dsh-ui-background-panel"),
    css: () => doc.getElementById("dsh-ui-background-style")?.textContent || "",
    layer: () => doc.getElementById("dsh-ui-background-layer"),
    overlay: () => doc.getElementById("dsh-ui-background-overlay"),
    stored: () => JSON.parse(storage["dsh-ui-background:settings:v1"] || "null"),
    get storage() { return storage; },
    intervals, cleared, windowListeners,
    dispose: () => { if (disposeFn) disposeFn(); },
    input: (key, value) => {
      const panel = doc.getElementById("dsh-ui-background-panel");
      const fn = (panel._listeners["input"] || [])[0];
      if (fn) fn({ target: { value: String(value), getAttribute: (k) => (k === "data-set" ? key : null) } });
    },
    change: (key, value, checked) => {
      const panel = doc.getElementById("dsh-ui-background-panel");
      const fn = (panel._listeners["change"] || [])[0];
      if (fn) fn({ target: { value: String(value ?? ""), checked: !!checked, getAttribute: (k) => (k === "data-set" ? key : null) } });
    },
    clickAct: (act) => {
      const panel = doc.getElementById("dsh-ui-background-panel");
      const fn = (panel._listeners["click"] || [])[0];
      const btn = { closest: () => btn };
      btn.getAttribute = (k) => (k === "data-act" ? act : null);
      if (fn) fn({ target: btn });
    },
    addFile(file) {
      const panel = doc.getElementById("dsh-ui-background-panel");
      const fileInput = panel.querySelector('input[type="file"]');
      fileInput.files = [file];
      const fn = (fileInput._listeners["change"] || [])[0];
      if (fn) fn({ target: fileInput });
    },
    get chatScope() { return cr; },
    get sidebarScope() { return sr; }
  };
  return { helpers, dispose: () => Object.assign(globalThis, saved) };
}

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
function tinyPngFile(name = "a.png", type = "image/png") {
  return new File([Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0))], name, { type });
}

const IMG_A = "data:image/png;base64,AAAA";
const IMG_B = "data:image/png;base64,BBBB";
const v4seed = (over = {}) => Object.assign({
  images: [
    { id: "a", data: IMG_A, width: 3840, height: 2160, name: "A" },
    { id: "b", data: IMG_B, width: 1000, height: 500, name: "B" }
  ],
  current: 0, backgroundOpacity: 70, blur: 0, overlay: 0, fillMode: "cover",
  bgWidth: 0, bgHeight: 0, bgLockRatio: true, positionX: 50, positionY: 50,
  carousel: false, carouselInterval: 10, carouselRandom: false, glass: false,
  chatFontColor: "", chatFontSize: 16, sidebarFontColor: "", sidebarFontSize: 100
}, over);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ══════════════════ A. bundle contract ══════════════════
{
  const { helpers, dispose } = makeEnv({ seed: null });
  check("A1 module registered", typeof globalThis.window.__ModuleLoader__ !== "undefined");
  dispose();
}

// ══════════════════ B. bootstrap ══════════════════
{
  const { helpers, dispose } = makeEnv({ seed: v4seed() });
  check("B1 style created", !!helpers.css());
  check("B2 panel created", !!helpers.panel());
  check("B3 toggle created", !!document.getElementById("dsh-ui-background-toggle"));
  check("B4 next created", !!document.getElementById("dsh-ui-background-next"));
  check("B5 drop overlay created", !!document.getElementById("dsh-ui-background-drop"));
  check("B6 layer created", !!helpers.layer());
  check("B7 scopes tagged", helpers.chatScope.getAttribute("data-dsh-ui-scope") === "chat" &&
    helpers.sidebarScope.getAttribute("data-dsh-ui-scope") === "sidebar");
  dispose();
}

// ══════════════════ C. migration v1/v2/v3 -> v4 ══════════════════
{
  // v1: single background + global font settings
  let env = makeEnv({ seed: { background: IMG_A, backgroundOpacity: 50, fontColor: "#aa2200", fontSize: 20 } });
  let s = env.helpers.stored();
  check("C1 v1 images migrated", Array.isArray(s.images) && s.images.length === 1 && s.images[0].data === IMG_A);
  check("C2 v1 chat color migrated", s.chatFontColor === "#aa2200");
  check("C3 v1 chat size migrated", s.chatFontSize === 20);
  check("C4 v1 legacy keys cleaned", !("background" in s) && !("fontColor" in s) && !("fontSize" in s));
  env.dispose();

  // v2: backgroundScale -> px (3840x2160, viewport 1920x1080, scale 150 -> 2880x1620)
  env = makeEnv({ seed: { background: IMG_A, backgroundOpacity: 60, backgroundScale: 150, backgroundWidth: 3840, backgroundHeight: 2160 } });
  s = env.helpers.stored();
  check("C5 v2 scale -> px", s.bgWidth === 2880 && s.bgHeight === 1620);
  check("C6 v2 layer size", env.helpers.layer().style.backgroundSize === "2880px 1620px");
  env.dispose();

  // v3: full single-image schema
  env = makeEnv({ seed: { background: IMG_B, backgroundOpacity: 40, backgroundWidth: 1000, backgroundHeight: 500, bgWidth: 900, bgHeight: 450, bgLockRatio: true } });
  s = env.helpers.stored();
  check("C7 v3 images migrated", s.images.length === 1 && s.images[0].data === IMG_B);
  check("C8 v3 bgWidth preserved", s.bgWidth === 900 && s.bgHeight === 450);
  env.dispose();

  // v4 untouched
  env = makeEnv({ seed: v4seed({ chatFontColor: "#123456" }) });
  s = env.helpers.stored();
  check("C9 v4 not re-migrated", s.images.length === 2 && s.chatFontColor === "#123456" && !("background" in s));
  env.dispose();
}

// ══════════════════ D. image list + add/remove/switch ══════════════════
{
  const { helpers, dispose } = makeEnv({ seed: v4seed() });
  // add local file (real File + FileReader polyfill path)
  await helpers.addFile(tinyPngFile("wall.png"));
  await wait(20);
  let s = helpers.stored();
  check("D1 add local file", s.images.length === 3 && s.current === 2 && s.images[2].name === "wall.png");
  check("D2 dims read", s.images[2].width === 3840 && s.images[2].height === 2160);

  // add URL image
  let prompted = false;
  // prompt is already stubbed to return null in env; use a fresh env with promptResult
  dispose();
  const env2 = makeEnv({ seed: v4seed(), promptResult: "https://example.com/bg.jpg" });
  const h2 = env2.helpers;
  h2.clickAct("addUrl");
  await wait(10);
  s = h2.stored();
  check("D3 add URL image", s.images.length === 3 && s.images[2].url === "https://example.com/bg.jpg" && !s.images[2].data);
  check("D4 url dims read", s.images[2].width === 3840);
  check("D5 next button shown (3 images)", document.getElementById("dsh-ui-background-next").hasAttribute("data-show"));

  // switch to image 0 via thumb click
  const panel = h2.panel();
  const area = panel.querySelector('[data-area="images"]');
  const thumb0 = area.children[0];
  const thumbImg = thumb0 && thumb0.children[0];
  const clickL = (thumbImg && thumbImg._listeners["click"] || [])[0];
  if (clickL) clickL({});
  await wait(5);
  check("D6 thumb click switches", h2.stored().current === 0 && h2.layer().style.backgroundImage.includes("AAAA"));

  // remove image 1 (index 1)
  const thumb1 = area.children[1];
  const delBtn = thumb1.children[1];
  const delL = (delBtn._listeners["click"] || [])[0];
  if (delL) delL({ stopPropagation() {} });
  await wait(5);
  s = h2.stored();
  check("D7 remove image", s.images.length === 2 && s.images[0].data === IMG_A);

  // remove all -> layer gone, size reset
  while (h2.stored().images.length) {
    const a = h2.panel().querySelector('[data-area="images"]');
    const d = a.children[0].children[1];
    (d._listeners["click"] || [])[0]({ stopPropagation() {} });
    await wait(5);
  }
  s = h2.stored();
  check("D8 remove all clears size", s.images.length === 0 && s.bgWidth === 0 && s.bgHeight === 0);
  check("D9 layer removed", !document.getElementById("dsh-ui-background-layer"));
  check("D10 next hidden", !document.getElementById("dsh-ui-background-next").hasAttribute("data-show"));
  env2.dispose();
}

// ══════════════════ E. carousel / random / next ══════════════════
{
  // sequential
  const env = makeEnv({ seed: v4seed({ carousel: true, carouselInterval: 15, carouselRandom: false }) });
  const h = env.helpers;
  check("E1 interval scheduled 15000", env.helpers.intervals.some((i) => i.ms === 15000));
  const cb = env.helpers.intervals[0].fn;
  cb(); // fire -> next image
  await wait(5);
  check("E2 carousel advances", h.stored().current === 1);
  cb(); // wraps back to 0
  await wait(5);
  check("E3 carousel wraps", h.stored().current === 0);
  env.dispose();

  // random: 20 fires must visit more than one index
  const env2 = makeEnv({ seed: v4seed({ carousel: true, carouselRandom: true }) });
  const h2 = env2.helpers;
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    env2.helpers.intervals[0].fn();
    seen.add(h2.stored().current);
    await wait(2);
  }
  check("E4 random varies", seen.size > 1);
  env2.dispose();

  // disable carousel -> clearInterval
  const env3 = makeEnv({ seed: v4seed({ carousel: true }) });
  env3.helpers.change("carousel", "", false);
  check("E5 disable clears timer", env3.helpers.cleared.length >= 1);
  check("E6 no new interval after disable", env3.helpers.intervals.length === 1);
  env3.dispose();

  // next button cycles
  const env4 = makeEnv({ seed: v4seed({ carouselRandom: false }) });
  const h4 = env4.helpers;
  h4.clickAct("next");
  await wait(5);
  check("E7 next button cycles", h4.stored().current === 1 && h4.layer().style.backgroundImage.includes("BBBB"));
  env4.dispose();

  // next with single image: no-op
  const env5 = makeEnv({ seed: v4seed({ images: [{ id: "a", data: IMG_A, width: 10, height: 10, name: "A" }] }) });
  env5.helpers.clickAct("next");
  await wait(5);
  check("E8 single image next no-op", env5.helpers.stored().current === 0);
  env5.dispose();
}

// ══════════════════ F. styling: opacity/blur/overlay/position/fill/w-h ══════════════════
{
  const env = makeEnv({ seed: v4seed() });
  const h = env.helpers;
  const layer = h.layer();

  h.input("opacity", 42);
  check("F1 opacity", layer.style.opacity === "0.42");
  h.input("blur", 10);
  check("F2 blur filter", layer.style.filter === "blur(10px)");
  check("F3 blur inset", layer.style.inset === "-15px", layer.style.inset);
  h.input("blur", 0);
  check("F4 blur off resets", layer.style.filter === "" && layer.style.inset === "0");
  h.input("overlay", 35);
  check("F5 overlay alpha", h.overlay().style.background === "rgba(0,0,0,0.35)");
  h.input("overlay", 0);
  check("F6 overlay off", h.overlay().style.background === "rgba(0,0,0,0)");
  h.input("posX", 20);
  h.input("posY", 80);
  check("F7 position", layer.style.backgroundPosition === "20% 80%");

  h.change("fill", "contain");
  check("F8 fill contain", layer.style.backgroundSize === "contain");
  h.change("fill", "stretch");
  check("F9 fill stretch", layer.style.backgroundSize === "100% 100%");
  h.change("fill", "tile");
  check("F10 fill tile", layer.style.backgroundSize === "auto" && layer.style.backgroundRepeat === "repeat");
  h.change("fill", "cover");
  check("F11 fill cover", layer.style.backgroundSize === "cover" && layer.style.backgroundRepeat === "no-repeat");

  // custom w/h overrides fill
  h.input("w", 2000);
  check("F12 custom w -> derived h (lock)", layer.style.backgroundSize === "2000px 1125px", layer.style.backgroundSize);
  h.change("wNum", "0");
  check("F13 w 0 -> cover", layer.style.backgroundSize === "cover");
  h.change("lock", "", false);
  h.input("w", 1500);
  h.change("hNum", "700");
  check("F14 lock off independent", layer.style.backgroundSize === "1500px 700px", layer.style.backgroundSize);
  h.change("lock", "", true);
  h.change("hNum", "0");
  check("F15 h 0 -> cover", layer.style.backgroundSize === "cover");
  env.dispose();
}

// ══════════════════ G. glass ══════════════════
{
  const env = makeEnv({ seed: v4seed({ glass: true }) });
  const css = env.helpers.css();
  check("G1 glass bubble light", css.includes("--dsw-specific-bubble: rgba(255,255,255,0.5) !important"));
  check("G2 glass bubble dark", css.includes("body[data-ds-dark-theme] [data-dsh-ui-scope=\"chat\"]{--dsw-specific-bubble: rgba(21,21,23,0.55) !important"));
  check("G3 glass sidebar", css.includes('[data-dsh-ui-scope="sidebar"]{--dsw-specific-sidebar-fill: rgba(255,255,255,0.5) !important'));
  check("G4 glass input-major", css.includes("--dsw-specific-input-major: rgba(255,255,255,0.55) !important"));
  check("G5 glass code block", css.includes("--dsw-alias-markdown-code-block: rgba(255,255,255,0.72) !important"));
  env.dispose();

  // glass without image -> no glass rules
  const env2 = makeEnv({ seed: v4seed({ glass: true, images: [] }) });
  check("G6 glass no image -> no rules", !env2.helpers.css().includes("--dsw-specific-bubble"));
  env2.dispose();

  // toggle off removes rules
  const env3 = makeEnv({ seed: v4seed({ glass: true }) });
  env3.helpers.change("glass", "", false);
  check("G7 glass off removes rules", !env3.helpers.css().includes("--dsw-specific-bubble"));
  env3.dispose();
}

// ══════════════════ H. fonts (chat/sidebar separated) ══════════════════
{
  const env = makeEnv({ seed: v4seed({
    chatFontColor: "#ff3366", chatFontSize: 18,
    sidebarFontColor: "#2266ff", sidebarFontSize: 120
  }) });
  const css = env.helpers.css();
  check("H1 chat color scoped", css.includes('[data-dsh-ui-scope="chat"]{--dsw-alias-label-primary: #ff3366 !important'));
  check("H2 chat markdown", css.includes("--dsw-font-markdown-base: 400 18px/32px var(--dsw-font-family) !important"));
  check("H3 sidebar color scoped", css.includes('[data-dsh-ui-scope="sidebar"]{--dsw-alias-label-primary: #2266ff !important'));
  check("H4 sidebar zoom", css.includes("zoom: 1.2 !important") && css.includes("width: calc(100% / 1.2)") && css.includes("height: calc(100% / 1.2)"));
  env.dispose();

  // default zoom absent
  const env2 = makeEnv({ seed: v4seed() });
  check("H5 no zoom at 100", !env2.helpers.css().includes("zoom:"));
  // reset chat color -> only markdown tokens remain
  env2.helpers.clickAct("resetChatColor");
  check("H6 reset chat color", !env2.helpers.css().includes("--dsw-alias-label-primary: #") || !env2.helpers.css().includes('[data-dsh-ui-scope="chat"]{--dsw-alias-label-primary'));
  env2.dispose();
}

// ══════════════════ I. import / export ══════════════════
{
  // export fallback (no clipboard)
  const env = makeEnv({ seed: v4seed() });
  const h = env.helpers;
  h.clickAct("export");
  const box = h.panel().querySelector('[data-set="importText"]');
  const io = h.panel().querySelector('[data-val="ioStatus"]');
  check("I1 export fallback fills box", box.value.includes('"images"') && box.value.includes(IMG_A));
  check("I2 export status", io.textContent.includes("已填入"));

  // export clipboard path
  let clipText = null;
  const env2 = makeEnv({ seed: v4seed(), clipboard: (t) => { clipText = t; return Promise.resolve(); } });
  env2.helpers.clickAct("export");
  await wait(10);
  check("I3 export clipboard", clipText && clipText.includes('"images"'));
  check("I4 clipboard status", env2.helpers.panel().querySelector('[data-val="ioStatus"]').textContent.includes("已复制"));
  env2.dispose();

  // import round-trip + sanitize clamps
  const env3 = makeEnv({ seed: v4seed() });
  const h3 = env3.helpers;
  h3.clickAct("export");
  const parsed = JSON.parse(h3.panel().querySelector('[data-set="importText"]').value);
  parsed.blur = 999;
  parsed.chatFontSize = 99;
  parsed.fillMode = "bogus";
  parsed.images.push({ id: "bad", data: "not-data-url", name: "x" }); // invalid -> dropped
  parsed.images.push({ id: "url", url: "https://x.com/a.png", width: 100, height: 50, name: "url" }); // valid url
  h3.panel().querySelector('[data-set="importText"]').value = JSON.stringify(parsed);
  h3.clickAct("importApply");
  await wait(5);
  const s = h3.stored();
  check("I5 import clamps blur", s.blur === 30);
  check("I6 import clamps font size", s.chatFontSize === 24);
  check("I7 import fallback fillMode", s.fillMode === "cover");
  check("I8 import drops invalid image", !s.images.some((im) => im.data === "not-data-url"));
  check("I9 import keeps url image", s.images.some((im) => im.url === "https://x.com/a.png"));
  check("I10 import status", h3.panel().querySelector('[data-val="ioStatus"]').textContent.includes("导入成功"));

  // invalid json
  h3.panel().querySelector('[data-set="importText"]').value = "{oops";
  h3.clickAct("importApply");
  check("I11 import bad json", h3.panel().querySelector('[data-val="ioStatus"]').textContent.includes("导入失败"));
  env3.dispose();
}

// ══════════════════ J. reset all ══════════════════
{
  const env = makeEnv({ seed: v4seed({ chatFontColor: "#ff0000", blur: 9, glass: true }) });
  const h = env.helpers;
  h.clickAct("resetAll");
  const s = h.stored();
  check("J1 reset clears storage", s === null || s.images.length === 0);
  check("J2 reset removes layer", !document.getElementById("dsh-ui-background-layer"));
  check("J3 reset resets css", !env.helpers.css().includes("#ff0000") && !env.helpers.css().includes("blur("));
  env.dispose();
}

// ══════════════════ J2. regression: add to EMPTY storage then reset ══════════════════
// (previously DEFAULTS.images got mutated by push/splice through the shallow copy,
//  causing resetAll to resurrect the old background)
{
  const env = makeEnv({ seed: null });
  const h = env.helpers;
  await h.addFile(tinyPngFile("first.png"));
  await wait(20);
  check("J2a add to empty storage works", h.stored().images.length === 1);
  h.clickAct("resetAll");
  await wait(10);
  check("J2b reset after empty-storage add removes layer", !document.getElementById("dsh-ui-background-layer"));
  check("J2c reset style has no bg rule", !env.helpers.css().includes("--dsw-alias-bg-base: transparent"));
  check("J2d storage empty after reset", h.stored() === null);
  // add another image after reset — must work cleanly
  await h.addFile(tinyPngFile("second.png"));
  await wait(20);
  check("J2e re-add after reset works", h.stored().images.length === 1 && h.stored().images[0].name === "second.png");
  env.dispose();
}

// ══════════════════ K. drag & drop ══════════════════
{
  const env = makeEnv({ seed: v4seed() });
  const wl = env.helpers.windowListeners;
  check("K1 drag handlers registered", ["dragenter", "dragover", "dragleave", "drop"].every((e) => (wl[e] || []).length > 0));
  const drop = (wl["drop"] || [])[0];
  drop({ dataTransfer: { files: [tinyPngFile("drag.png")] }, preventDefault() {} });
  await wait(20);
  const s = env.helpers.stored();
  check("K2 drop adds image", s.images.length === 3 && s.images[2].name === "drag.png");
  // non-image drop ignored
  const before = s.images.length;
  drop({ dataTransfer: { files: [{ type: "text/plain", name: "a.txt" }] }, preventDefault() {} });
  await wait(10);
  check("K3 non-image drop ignored", env.helpers.stored().images.length === before);
  // dragenter/over/leave toggle drop overlay
  const dropEl = document.getElementById("dsh-ui-background-drop");
  (wl["dragenter"] || [])[0]({ dataTransfer: { types: ["Files"] } });
  check("K4 dragenter shows overlay", dropEl.hasAttribute("data-show"));
  (wl["dragleave"] || [])[0]({});
  check("K5 dragleave hides overlay", !dropEl.hasAttribute("data-show"));
  env.dispose();
}

// ══════════════════ L. lifecycle / dispose ══════════════════
{
  const env = makeEnv({ seed: v4seed({ carousel: true }) });
  const h = env.helpers;
  const ids = ["dsh-ui-background-style", "dsh-ui-background-layer", "dsh-ui-background-overlay",
    "dsh-ui-background-drop", "dsh-ui-background-panel", "dsh-ui-background-toggle", "dsh-ui-background-next"];
  const beforeWindow = Object.keys(env.helpers.windowListeners).reduce((n, k) => n + env.helpers.windowListeners[k].length, 0);
  check("L1 resize handler registered", (env.helpers.windowListeners["resize"] || []).length === 1);
  // resize re-renders layer (change opacity then resize)
  h.input("opacity", 33);
  (env.helpers.windowListeners["resize"] || [])[0]();
  check("L2 resize keeps layer", h.layer().style.opacity === "0.33");
  env.helpers.dispose(); // plugin dispose (cleanup)
  const stillThere = ids.filter((id) => document.getElementById(id));
  check("L3 dispose removes all DOM", stillThere.length === 0, stillThere.join(","));
  check("L4 dispose removes scopes attrs", !h.chatScope.hasAttribute("data-dsh-ui-scope") && !h.sidebarScope.hasAttribute("data-dsh-ui-scope"));
  const afterWindow = Object.keys(env.helpers.windowListeners).reduce((n, k) => n + env.helpers.windowListeners[k].length, 0);
  check("L5 dispose removes window listeners", afterWindow === 0, "before=" + beforeWindow + " after=" + afterWindow);
  check("L6 dispose clears timer", env.helpers.cleared.length >= 1);
}

// ══════════════════ M. edge cases ══════════════════
{
  // out-of-range current clamps
  const env = makeEnv({ seed: v4seed({ current: 99 }) });
  const h = env.helpers;
  check("M1 current clamped", h.layer().style.backgroundImage.includes("BBBB"));
  check("M2 settings write-back did not loop", h.stored().images.length === 2);
  env.dispose();

  // no settings at all
  const env2 = makeEnv({ seed: null });
  check("M3 defaults safe", !document.getElementById("dsh-ui-background-layer"));
  check("M4 no crash", true);
  env2.dispose();

  // bg-base transparent only with image
  const env3 = makeEnv({ seed: v4seed() });
  check("M5 bg-base transparent present", env3.helpers.css().includes("body, body[data-ds-dark-theme]{--dsw-alias-bg-base: transparent !important}"));
  env3.dispose();
  const env4 = makeEnv({ seed: v4seed({ images: [] }) });
  check("M6 bg-base transparent absent without image", !env4.helpers.css().includes("--dsw-alias-bg-base: transparent"));
  env4.dispose();

  // MutationObserver guard present (boot handles late-mounted roots)
  check("M7 observer guard in source", code.includes("typeof MutationObserver"));
}

console.log(`\n==== ${passes} PASS / ${failures} FAIL ====`);
process.exit(failures === 0 ? 0 : 1);
