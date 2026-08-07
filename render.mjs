/* Full-page screenshots of every page, via the Chrome DevTools Protocol.
   No dependencies — Node 24 has fetch and WebSocket built in. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const OUT = resolve(ROOT, "screens");
const PORT = 9333;

const SHOTS = [
  ["index", 1440, 900, 1],
  ["mesh-integration", 1440, 900, 1],
  ["wefts", 1440, 900, 1],
  ["customization", 1440, 900, 1],
  ["education", 1440, 900, 1],
  ["about", 1440, 900, 1],
  ["partner", 1440, 900, 1],
  ["index", 390, 844, 2],
  ["partner", 390, 844, 2],
  ["customization", 390, 844, 2]
];

mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--hide-scrollbars",
    "--no-sandbox",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    "--user-data-dir=/tmp/tpc-render"
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("chrome did not come up");
}

const wsUrl = await connect();
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((r) => {
    const n = ++id;
    pending.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });

for (const [page, w, h, dpr] of SHOTS) {
  await send("Emulation.setDeviceMetricsOverride",
    { width: w, height: h, deviceScaleFactor: dpr, mobile: w < 500 }, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Page.navigate", { url: `file://${ROOT}/${page}.html` }, sessionId);
  await sleep(2600); // fonts, strand field, reveal observer

  // Reveal everything, so a full-page shot is not half empty by design.
  await send("Runtime.evaluate", {
    expression:
      "document.querySelectorAll('.reveal').forEach(el=>el.setAttribute('data-shown','true'));" +
      "window.scrollTo(0,0);"
  }, sessionId);
  await sleep(700);

  const { data } = await send("Page.captureScreenshot",
    { format: "png", captureBeyondViewport: true }, sessionId);
  const name = `${page}-${w < 500 ? "mobile" : "desktop"}.png`;
  writeFileSync(resolve(OUT, name), Buffer.from(data, "base64"));
  console.log("wrote", name);
}

ws.close();
chrome.kill();
process.exit(0);
