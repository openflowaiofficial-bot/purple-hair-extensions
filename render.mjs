/* Full-page screenshots of every page, via the Chrome DevTools Protocol.
   No dependencies — Node 24 has fetch and WebSocket built in. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync, deflateSync } from "node:zlib";

/* ---------------------------------------------------------------------------
   PNG in, PNG out — because captureBeyondViewport cannot be trusted on a long
   page and this harness's whole job is to produce a render Chrome actually
   paints.

   What it was doing instead: on index.html at 390px (9827 CSS px tall) the
   full-page capture came back the right size, looking entirely plausible, with
   the last third of the image showing the masthead, hero and ledger AGAIN in
   place of the invitation band and the colophon. Same failure at dpr 1 and at
   dpr 2, and it truncated customization-mobile mid-section. Sizing the viewport
   to the full page height and capturing without captureBeyondViewport produced
   the identical corruption, so it is the long-surface path itself.

   That is the --disable-gpu lesson again, and it is the more dangerous version:
   a wrong FLAG drops paint you might notice, a wrong CAPTURE hands you a
   different part of the page and looks correct. Two rounds of review were made
   from screenshots. They have to be the page.

   So a long page is now shot the only way that cannot lie: scroll to each
   viewport, capture exactly what is on screen, and stitch the tiles. Every tile
   is an ordinary in-viewport screenshot on the path Chrome uses for the real
   compositor. The decoder/encoder below is 8-bit non-interlaced RGB/RGBA only —
   what Chrome emits — and throws rather than guessing on anything else.
   --------------------------------------------------------------------------- */
function decodePng(b64) {
  const buf = Buffer.from(b64, "base64");
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    if (type === "IHDR") {
      const d = buf.subarray(p + 8, p + 8 + len);
      w = d.readUInt32BE(0); h = d.readUInt32BE(4);
      bitDepth = d[8]; colorType = d[9]; interlace = d[12];
    } else if (type === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6))
    throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

function encodePng(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none. Size is not the point here.
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

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
    /* NOT --disable-gpu. That flag does not merely alias the edges of the shade
       ring — it DROPS PAINT. Same page, same viewport, same build: under
       --disable-gpu the focus indicator on the selected blade painted on about
       40% of its perimeter (the whole lower-left long edge absent) and every
       blade silhouette carried a stippled stair-stepped contour. Under ANGLE's
       SwiftShader backend the same frame renders complete and clean. Two rounds
       of visual review were made against a render Chrome does not produce.
       SwiftShader is still software — no GPU is required in this container — but
       it is the same rasteriser path the real compositor drives. */
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
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

/* Chrome's captureBeyondViewport silently CORRUPTS past a surface limit of
   about 16384 device pixels: it returns a PNG of the full declared height whose
   lower region repeats earlier bands of the page instead of the content that
   belongs there. index.html at 390px is 9827 CSS px tall, so at dpr 2 it asked
   for 19654 and came back with the hero ledger pasted over the footer — a
   screenshot that looks plausible, is the right size, and is not the page.

   This is the same failure as --disable-gpu and it is worth naming as such:
   both produced renders Chrome does not actually paint, and both would have
   been reviewed as if they were the site. Anything measured from a corrupt
   band is a fiction, and a reviewer has no way to tell.

   So the density is chosen per shot from the page's real height, and the run
   says out loud when it had to drop one. A 1x mobile shot is a true render at
   lower detail; a 2x shot past the limit is not a render at all. */
const SURFACE_LIMIT = 16384;
let failures = 0;

for (const [page, w, h, dprWanted] of SHOTS) {
  await send("Emulation.setDeviceMetricsOverride",
    { width: w, height: h, deviceScaleFactor: dprWanted, mobile: w < 500 }, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Page.navigate", { url: `file://${ROOT}/${page}.html` }, sessionId);
  await sleep(2600); // fonts, strand field, reveal observer

  const pageH = await send("Runtime.evaluate", {
    expression: "document.documentElement.scrollHeight", returnByValue: true
  }, sessionId).then((r) => r.result.value);

  const dpr = dprWanted;

  /* Sweep the whole page before capturing. Anything drawn lazily on its first
     IntersectionObserver hit — the plate canvases — is never drawn otherwise,
     because captureBeyondViewport screenshots a page that was never scrolled.
     Without this the full-page shot shows empty plates that a real reader
     never sees, which makes the screenshot lie in the flattering direction. */
  await send("Runtime.evaluate", {
    expression:
      /* rAF-synced, and it overruns the page bottom. IntersectionObserver
         delivers on a frame boundary, so a bare setTimeout can outrun the
         observer and leave the last plates of a page undrawn — which is the
         precise way this screenshot would lie in the flattering direction. */
      "(async()=>{document.documentElement.style.scrollBehavior='auto';" +
      "const H=document.body.scrollHeight;" +
      "for(let y=0;y<H+900;y+=400){window.scrollTo(0,y);" +
      "await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,110)));}})()",
    awaitPromise: true
  }, sessionId);
  await sleep(400);

  /* Reveal everything, so a full-page shot is not half empty by design, and
     un-stick the masthead.

     THE HARNESS WAS LYING. captureBeyondViewport grows the viewport and a
     position:sticky element re-resolves against the grown box, so in every
     desktop PNG the trade rail and masthead were painted across the MIDDLE of
     the hero, sitting on top of the h1 — on customization.html they cut "The
     Color / Lab" in half. The live page is fine: .masthead
     getBoundingClientRect().y is exactly 0 at scroll 0. The evidence was not,
     and anyone reviewing from these files would file a masthead bug that does
     not exist. */
  /* Reveal everything, un-stick the masthead, and freeze the scroll-driven
     parallax. The reveal and the un-sticking are the same reasons as before.
     The strand planes are new and specific to tiling: they drift on
     animation-timeline: view(), so each tile would catch them at a different
     offset and the hero would show a seam. Frozen at their rest pose, which is
     what a reader sees on arrival and what a still image can honestly show. */
  /* SMOOTH SCROLLING IS THE ROOT CAUSE, and it was poisoning this harness long
     before the tiling. styles.css sets html { scroll-behavior: smooth }, so
     every window.scrollTo here is ANIMATED: the sweep above, the scrollTo(0,0)
     below, and each tile position. The old full-page capture fired while the
     page was still gliding back to the top, which is how captureBeyondViewport
     came back with the masthead and hero pasted over the invitation band and
     the colophon. Turning it off makes every scroll land on the frame it is
     asked for, which is the whole basis of a tile plan being contiguous. */
  await send("Runtime.evaluate", {
    expression:
      "document.documentElement.style.scrollBehavior='auto';" +
      "document.querySelectorAll('.reveal').forEach(el=>el.setAttribute('data-shown','true'));" +
      "document.querySelectorAll('.masthead,.apply-grid > :first-child,.split-top > :first-child')" +
      ".forEach(el=>{el.dataset.wasSticky='1';el.style.position='static';});" +
      "document.querySelectorAll('.strand-plane').forEach(el=>" +
      "{el.style.animation='none';el.style.translate='none';});" +
      "window.scrollTo(0,0);"
  }, sessionId);
  await sleep(700);

  /* Height is re-read HERE, after the reveal and the un-sticking, because both
     can change it — and the tile plan has to be built from the page that is
     actually about to be photographed. */
  const finalH = await send("Runtime.evaluate", {
    expression: "document.documentElement.scrollHeight", returnByValue: true
  }, sessionId).then((r) => r.result.value);

  const tileH = h;
  const outW = Math.round(w * dpr);
  const outH = Math.round(finalH * dpr);
  const canvas = Buffer.alloc(outW * outH * 3);
  // Exact coverage, not inferred from pixel values: this page is mostly
  // near-black and "looks unpainted" is not the same question as "was painted".
  const painted = new Uint8Array(outH);

  for (let y = 0; y < finalH; y += tileH) {
    const top = Math.min(y, Math.max(0, finalH - tileH));
    await send("Runtime.evaluate", { expression: `window.scrollTo(0,${top})` }, sessionId);
    await sleep(220);
    /* The scroll may not land where it was asked (a short last tile, or a
       clamp at the document end), so the tile is pasted at the position the
       page ACTUALLY reports — never at the position we hoped for. Read on the
       frame immediately before the capture, so the number and the pixels are
       the same moment. */
    const realTop = await send("Runtime.evaluate", {
      expression: "new Promise(r=>requestAnimationFrame(()=>r(Math.round(window.scrollY))))",
      returnByValue: true, awaitPromise: true
    }, sessionId).then((r) => r.result.value);

    const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    const img = decodePng(shot.data);
    const dstY0 = Math.round(realTop * dpr);
    for (let ty = 0; ty < img.h; ty++) {
      const dy = dstY0 + ty;
      if (dy < 0 || dy >= outH) continue;
      painted[dy] = 1;
      for (let tx = 0; tx < Math.min(img.w, outW); tx++) {
        const s = (ty * img.w + tx) * img.ch;
        const d = (dy * outW + tx) * 3;
        canvas[d] = img.data[s];
        canvas[d + 1] = img.data[s + 1];
        canvas[d + 2] = img.data[s + 2];
      }
    }
    if (realTop + tileH >= finalH) break;
  }

  await send("Runtime.evaluate", {
    expression:
      "document.querySelectorAll('[data-was-sticky]').forEach(el=>{el.style.position='';delete el.dataset.wasSticky;});"
  }, sessionId);

  const name = `${page}-${w < 500 ? "mobile" : "desktop"}.png`;
  const buf = encodePng(outW, outH, canvas);

  /* Nothing may be left unpainted. Every tile is a real screenshot, so the only
     way a row stays at the zero-fill this buffer started as is if the tile plan
     missed it — which would be a silent hole in the middle of the evidence. */
  let blank = 0;
  for (let yy = 0; yy < outH; yy++) if (!painted[yy]) blank++;
  if (blank > 0) {
    console.log(`  !! ${name}: ${blank} unpainted row(s) — the tile plan missed part of the page`);
    failures++;
  }

  writeFileSync(resolve(OUT, name), buf);
  console.log(`wrote ${name}  (${outW}x${outH}, dpr ${dpr}, ${Math.ceil(finalH / tileH)} tiles)`);
}

ws.close();
chrome.kill();
if (failures) {
  console.log(`\n${failures} screenshot(s) are NOT a faithful render — do not review them.`);
  process.exit(1);
}
console.log("\nall shots verified against page height and the capture surface limit");
process.exit(0);
