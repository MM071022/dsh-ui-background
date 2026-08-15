// Browser E2E test: drives a RUNNING dsh web GUI via Chrome DevTools Protocol.
// Verifies the plugin loads, scope detection works, and interactive features
// work in a real browser; captures screenshots into ../screenshots/e2e/.
// Usage: node checks/browser-e2e.mjs   (dsh web must be running)
// Env overrides: DSH_URL (default http://127.0.0.1:3080/), CHROME_PATH
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.DSH_E2E_PORT || 9223);
const PROFILE = `${HERE}/e2e-profile`;
const SHOT_DIR = `${HERE}/../screenshots/e2e`;
const TMP_IMG = `${HERE}/e2e-bg.png`;
const TARGET_URL = process.env.DSH_URL || "http://127.0.0.1:3080/";

fs.mkdirSync(SHOT_DIR, { recursive: true });
// a small colorful test wallpaper (solid gradient-ish png 32x32)
{
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKElEQVR42u3NMQEAAAgDINc/9K3hGkIoZgAAgAEAADQBAABMAQAAwB8AAUAAAVQ8K2cAAAAASUVORK5CYII=";
  fs.writeFileSync(TMP_IMG, Buffer.from(b64, "base64"));
}

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) passes++; else failures++;
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok ? "" : "  <<< " + detail));
}

// ── launch chrome ──
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  "--window-size=1400,900",
  TARGET_URL
], { stdio: "ignore", detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CDP helpers ──
let ws = null;
let seq = 0;
const pending = new Map();

function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }
    }, 15000);
  });
}

async function evaluate(expression) {
  const r = await cdpSend("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (r.exceptionDetails) {
    return { error: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || "eval error").slice(0, 200) };
  }
  return r.result?.value;
}

async function shot(name) {
  try {
    const r = await cdpSend("Page.captureScreenshot", { format: "png" });
    const file = `${SHOT_DIR}/${name}.png`;
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  } catch (err) {
    console.error("screenshot failed:", err.message);
    return null;
  }
}

async function waitFor(expr, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evaluate(expr)) return true;
    } catch (err) { /* page may still be booting */ }
    await sleep(300);
  }
  console.error("waitFor timeout: " + label);
  return false;
}

async function main() {
  // wait for chrome debugging endpoint
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.length) break;
    } catch (err) { /* not up yet */ }
    await sleep(500);
  }
  if (!targets || !targets.length) throw new Error("chrome debugging endpoint unreachable");
  const page = targets.find((t) => t.type === "page" && t.url.includes("3080")) || targets[0];
  console.log("target:", page.url);

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  };
  await cdpSend("Page.enable");
  await cdpSend("Runtime.enable");

  // ── 1. plugin loads ──
  check("E2E1 toggle button appears", await waitFor('!!document.getElementById("dsh-ui-background-toggle")', 40000, "plugin toggle"));
  await sleep(1500); // let app settle
  const scopesOk = await evaluate('!!document.querySelector(\'[data-dsh-ui-scope="chat"]\') && !!document.querySelector(\'[data-dsh-ui-scope="sidebar"]\')');
  check("E2E2 scopes detected in real DOM", !!scopesOk);

  // ── 2. open panel ──
  await evaluate('document.getElementById("dsh-ui-background-toggle").click()');
  await sleep(300);
  check("E2E3 panel opens", await evaluate('!document.getElementById("dsh-ui-background-panel").hidden'));
  await shot("01-panel-open");

  // ── 3. add a local image via file input (CDP setFileInputFiles) ──
  {
    const doc = await cdpSend("DOM.getDocument");
    const q = await cdpSend("DOM.querySelector", { nodeId: doc.root.nodeId, selector: '#dsh-ui-background-panel input[type="file"]' });
    await cdpSend("DOM.setFileInputFiles", { nodeId: q.nodeId, files: [TMP_IMG] });
    await evaluate('document.querySelector(\'#dsh-ui-background-panel input[type="file"]\').dispatchEvent(new Event("change", { bubbles: true }))');
    const ok = await waitFor('!!document.getElementById("dsh-ui-background-layer")', 10000, "background layer");
    check("E2E4 local image added + layer", ok);
    const layerInfo = await evaluate('JSON.stringify({bg: document.getElementById("dsh-ui-background-layer").style.backgroundImage.slice(0,40), opacity: document.getElementById("dsh-ui-background-layer").style.opacity})');
    check("E2E5 layer styled", layerInfo.includes("data:image/png") && layerInfo.includes("0.7"));
    const stored = await evaluate('JSON.parse(localStorage.getItem("dsh-ui-background:settings:v1")).images.length');
    check("E2E6 settings persisted (1 image)", stored === 1, "images=" + stored);
    await shot("02-background-set");
  }

  // ── 4. styling controls (dispatch input/change on real panel) ──
  {
    const setRange = (key, value) => `(() => { const el = document.querySelector('#dsh-ui-background-panel [data-set="${key}"]'); el.value = "${value}"; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`;
    const setSelect = (key, value) => `(() => { const el = document.querySelector('#dsh-ui-background-panel [data-set="${key}"]'); el.value = "${value}"; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
    const setCheck = (key, checked) => `(() => { const el = document.querySelector('#dsh-ui-background-panel [data-set="${key}"]'); el.checked = ${checked}; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;

    await evaluate(setRange("opacity", "55"));
    check("E2E7 opacity", await evaluate('document.getElementById("dsh-ui-background-layer").style.opacity') === "0.55");
    await evaluate(setRange("blur", "6"));
    check("E2E8 blur", await evaluate('document.getElementById("dsh-ui-background-layer").style.filter') === "blur(6px)");
    await evaluate(setRange("overlay", "25"));
    check("E2E9 overlay", await evaluate('document.getElementById("dsh-ui-background-overlay").style.background') === "rgba(0, 0, 0, 0.25)");
    await evaluate(setRange("posX", "15"));
    check("E2E10 position", (await evaluate('document.getElementById("dsh-ui-background-layer").style.backgroundPosition')).startsWith("15%"));
    await evaluate(setSelect("fill", "contain"));
    check("E2E11 fill contain", await evaluate('document.getElementById("dsh-ui-background-layer").style.backgroundSize') === "contain");
    await evaluate(setRange("w", "2200"));
    check("E2E12 custom width", (await evaluate('document.getElementById("dsh-ui-background-layer").style.backgroundSize')).startsWith("2200px"));
    await evaluate(setCheck("glass", true));
    const glassCss = await evaluate('document.getElementById("dsh-ui-background-style").textContent');
    check("E2E13 glass rules", glassCss.includes("--dsw-specific-bubble: rgba(255,255,255,0.5) !important"));
    await shot("03-styled-glass");

    // background scope: 整体贯穿 —— sidebar column AND root become fully transparent
    await evaluate(setSelect("scope", "all"));
    const sideFill = await evaluate('getComputedStyle(document.querySelector(\'[data-dsh-ui-scope="sidebar"]\')).backgroundColor');
    check("E2E13b bg scope all -> sidebar transparent", sideFill === "rgba(0, 0, 0, 0)", sideFill);
    const colFill = await evaluate('getComputedStyle(document.querySelector(\'[data-dsh-ui-scope="sidebar"]\').parentElement.parentElement).backgroundColor');
    check("E2E13b2 bg scope all -> sidebar column transparent", colFill === "rgba(0, 0, 0, 0)", colFill);
    const scopeCss = await evaluate('document.getElementById("dsh-ui-background-style").textContent');
    check("E2E13c scope rule emitted", scopeCss.includes("--dsw-specific-sidebar-fill: transparent !important"));
    await shot("03b-bg-scope-all");
    await evaluate(setSelect("scope", "chat"));
    const sideFill2 = await evaluate('getComputedStyle(document.querySelector(\'[data-dsh-ui-scope="sidebar"]\')).backgroundColor');
    const colFill2 = await evaluate('getComputedStyle(document.querySelector(\'[data-dsh-ui-scope="sidebar"]\').parentElement.parentElement).backgroundColor');
    check("E2E13d scope chat -> fills back", sideFill2 !== "rgba(0, 0, 0, 0)" && colFill2 !== "rgba(0, 0, 0, 0)", sideFill2 + " / " + colFill2);

    // font color (chat) — probe element INSIDE chat scope resolves the overridden token
    await evaluate('(() => { const el = document.querySelector(\'#dsh-ui-background-panel [data-set="chatColor"]\'); el.value = "#e6194b"; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()');
    const chatProbe = await evaluate('(() => { const p = document.createElement("span"); p.style.color = "var(--dsw-alias-label-primary)"; document.querySelector(\'[data-dsh-ui-scope="chat"]\').appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; })()');
    check("E2E14 chat color applied", chatProbe === "rgb(230, 25, 75)", chatProbe);
    const chatToken = await evaluate('getComputedStyle(document.querySelector(\'[data-dsh-ui-scope="chat"]\')).getPropertyValue("--dsw-alias-label-primary")');
    check("E2E14b chat token on scope", chatToken === "#e6194b", chatToken);

    // sidebar color + zoom
    await evaluate('(() => { const el = document.querySelector(\'#dsh-ui-background-panel [data-set="sidebarColor"]\'); el.value = "#1a66ff"; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()');
    await evaluate(setRange("sidebarSize", "115"));
    const sideColor = await evaluate('getComputedStyle(document.querySelector(\'[data-dsh-ui-scope="sidebar"]\')).color');
    check("E2E15 sidebar color applied", sideColor === "rgb(26, 102, 255)", sideColor);
    const sideZoom = await evaluate('getComputedStyle(document.querySelector(\'[data-dsh-ui-scope="sidebar"]\')).zoom');
    check("E2E16 sidebar zoom", sideZoom === "1.15" || sideZoom === "115%", sideZoom);
    await shot("04-fonts");

    // add a second image so carousel has something to cycle
    {
      const doc = await cdpSend("DOM.getDocument");
      const q = await cdpSend("DOM.querySelector", { nodeId: doc.root.nodeId, selector: '#dsh-ui-background-panel input[type="file"]' });
      await cdpSend("DOM.setFileInputFiles", { nodeId: q.nodeId, files: [TMP_IMG] });
      await evaluate('document.querySelector(\'#dsh-ui-background-panel input[type="file"]\').dispatchEvent(new Event("change", { bubbles: true }))');
      await waitFor('JSON.parse(localStorage.getItem("dsh-ui-background:settings:v1")).images.length === 2', 10000, "second image");
      check("E2E17a second image added", await evaluate('JSON.parse(localStorage.getItem("dsh-ui-background:settings:v1")).images.length') === 2);
    }
    // carousel: enable, interval 5s, wait for switch
    await evaluate(setCheck("carousel", true));
    await evaluate('(() => { const el = document.querySelector(\'#dsh-ui-background-panel [data-set="interval"]\'); el.value = "5"; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
    const currentBefore = await evaluate('JSON.parse(localStorage.getItem("dsh-ui-background:settings:v1")).current');
    await sleep(7000);
    const currentAfter = await evaluate('JSON.parse(localStorage.getItem("dsh-ui-background:settings:v1")).current');
    check("E2E17b carousel switches image", currentAfter !== currentBefore, currentBefore + " -> " + currentAfter);
  }

  // ── 5. export/import ──
  {
    await evaluate('document.querySelector(\'#dsh-ui-background-panel [data-act="export"]\').click()');
    const boxVal = await evaluate('document.querySelector(\'#dsh-ui-background-panel [data-set="importText"]\').value');
    check("E2E18 export fills box", typeof boxVal === "string" && boxVal.includes('"images"'), boxVal);
    // import: change chat color via JSON and apply
    const parsed = JSON.parse(boxVal);
    parsed.chatFontColor = "#00cc66";
    await evaluate(`document.querySelector('#dsh-ui-background-panel [data-set="importText"]').value = ${JSON.stringify(JSON.stringify(parsed))}`);
    await evaluate('document.querySelector(\'#dsh-ui-background-panel [data-act="importApply"]\').click()');
    const newColor = await evaluate('(() => { const p = document.createElement("span"); p.style.color = "var(--dsw-alias-label-primary)"; document.querySelector(\'[data-dsh-ui-scope="chat"]\').appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; })()');
    check("E2E19 import applies", newColor === "rgb(0, 204, 102)", newColor);
  }

  // ── 6. quick next button + reset ──
  {
    const nextVisible = await evaluate('!!document.getElementById("dsh-ui-background-next") && document.getElementById("dsh-ui-background-next").hasAttribute("data-show")');
    check("E2E20 next button visible", nextVisible === true, nextVisible);
    const curBefore = await evaluate('JSON.parse(localStorage.getItem("dsh-ui-background:settings:v1")).current');
    await evaluate('document.getElementById("dsh-ui-background-next").click()');
    await sleep(400);
    const cur = await evaluate('JSON.parse(localStorage.getItem("dsh-ui-background:settings:v1")).current');
    check("E2E21 next cycles", cur === (curBefore + 1) % 2, "before=" + curBefore + " after=" + cur);
    await evaluate('document.querySelector(\'#dsh-ui-background-panel [data-act="resetAll"]\').click()');
    await sleep(400);
    const diag = await evaluate('JSON.stringify({ layer: !!document.getElementById("dsh-ui-background-layer"), layerBg: (document.getElementById("dsh-ui-background-layer") || {}).style?.backgroundImage || "", raw: localStorage.getItem("dsh-ui-background:settings:v1"), styleHasBgRule: document.getElementById("dsh-ui-background-style").textContent.includes("--dsw-alias-bg-base: transparent") })');
    console.error("[diag] after resetAll:", diag);
    const layerGone = await evaluate('!document.getElementById("dsh-ui-background-layer")');
    check("E2E22 reset removes background", layerGone === true, layerGone);
    await shot("05-reset");
  }

  console.log(`\n==== E2E ${passes} PASS / ${failures} FAIL ====`);
}

main().then(async () => {
  try { await cdpSend("Browser.close"); } catch (err) { /* ignore */ }
  try { chrome.kill(); } catch (err) { /* ignore */ }
  process.exit(failures === 0 ? 0 : 1);
}).catch(async (err) => {
  console.error("E2E ERROR:", err.message);
  try { chrome.kill(); } catch (e) { /* ignore */ }
  process.exit(1);
});
