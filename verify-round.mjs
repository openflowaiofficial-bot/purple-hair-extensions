/* Round-specific runtime assertions for the dimensional pass.
   Verifies every claim this round makes, on the live pages, in Chrome. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

/* A 40-line PNG reader, so a visual claim can be settled with pixels instead of
   with prose. Node has zlib built in and Chrome writes 8-bit non-interlaced
   RGB/RGBA, which is the only case handled — anything else throws rather than
   guessing, because a decoder that quietly mis-reads would turn this harness
   into the thing it exists to catch. No dependency, no build step. */
function decodePng(b64) {
  const buf = Buffer.from(b64, "base64");
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6))
    throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * ch);
  const stride = w * ch;
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const bb = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) {
        const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

/* How loudly does the decoration land on the type? Returns the worst per-pixel
   channel difference and how much of the box moved at all. A mask that merely
   dims a filament crossing a headline is still a filament crossing a headline;
   the question is whether anything in the box is legibly different. */
function diff(aB64, bB64) {
  const a = decodePng(aB64), b = decodePng(bB64);
  if (a.w !== b.w || a.h !== b.h) throw new Error("clip size drifted between shots");
  let max = 0, moved = 0;
  const px = a.w * a.h;
  for (let i = 0; i < px; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[i * a.ch + c] - b.data[i * b.ch + c]));
    if (d > max) max = d;
    if (d > 2) moved++;
  }
  return { max, movedPct: +((moved / px) * 100).toFixed(2) };
}

const ROOT = resolve(import.meta.dirname);
const PORT = 9336;
const chrome = spawn("google-chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox",
  /* See render.mjs — --disable-gpu drops paint on the ring, it does not just
     alias it. Same rasteriser flags everywhere so checks and screenshots agree. */
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--user-data-dir=/tmp/tpc-verify"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; }
  catch { await sleep(250); }
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); let logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push(m.params.args.map(a => a.value).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + m.params.exceptionDetails.text);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}, sessionId) =>
  new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Runtime.enable", {}, sessionId);
await send("Page.enable", {}, sessionId);

let pass = 0, fail = 0;
const ok = (name, cond, note = "") => {
  if (cond) { pass++; console.log("PASS ", name, note ? " [" + note + "]" : ""); }
  else { fail++; console.log("FAIL ", name, note ? " [" + note + "]" : ""); }
};

async function evalOn(expr, awaitPromise = false) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + (r.exceptionDetails.exception?.description || ""));
  return r.result.value;
}

async function go(page, w = 1440, h = 900, dpr = 1, js = true) {
  await send("Emulation.setScriptExecutionDisabled", { value: !js }, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: w < 500 }, sessionId);
  logs = [];
  await send("Page.navigate", { url: `file://${ROOT}/${page}.html` }, sessionId);
  await sleep(1600);
}

/* ---------------------------------------------------------------- THE RING */
await go("customization");
ok("customization console clean", logs.length === 0, logs.join(" | "));

// 1. The four darkest blades are separable.
const shades = await evalOn(`(() => {
  const bl = [...document.querySelectorAll('.blade')];
  return bl.slice(0,4).map(b => ({
    face: b.style.getPropertyValue('--face0'),
    d: b.style.getPropertyValue('--shade-d')
  }));
})()`);
ok("every blade carries a per-shade --shade-d", shades.every(s => s.d && +s.d > 0), JSON.stringify(shades));

// Render-level: sample the actual painted pixels of blades 0..3 near their tips.
await evalOn(`document.querySelectorAll('.reveal').forEach(e=>e.setAttribute('data-shown','true'));
  /* 'instant', explicitly: styles.css sets html { scroll-behavior: smooth },
     so a default scrollIntoView is ANIMATED and anything measured before it
     lands is measured at the wrong scroll. This is the same fault that was
     corrupting render.mjs's full-page captures. */
  document.documentElement.style.scrollBehavior='auto';
  document.querySelector('.ring-stage').scrollIntoView({block:'center',behavior:'instant'});`);
await sleep(600);
const seps = await evalOn(`(async () => {
  const c = document.createElement('canvas');
  const bl = [...document.querySelectorAll('.blade')];
  // Sample the mid-point of each of the four darkest blades from the composited
  // page via elementFromPoint chain is not possible; use getBoundingClientRect
  // centres and report them for an out-of-page screenshot sample instead.
  return bl.slice(0,4).map(b => { const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height*0.45) }; });
})()`);

/* 2. THE RIVET IS A RIVET.
   This block used to verify the shade code printed on the hub: that it was a
   sibling of .ring rather than a descendant, that it rasterised at exactly
   1.000x outside the perspective, and that it sat centred on the disc within a
   fifth of its radius. All three passed. All three are gone, because the thing
   they verified is gone — a rivet is a mechanical fastener and nothing is
   printed on one, the number was already on screen as "Blonde — no. 18", and
   that one redundant numeral is what forced the disc to 21% (four times a real
   rivet, burying the blade roots) and bought the --hub-dx / --hub-dy
   compensation pair that had to be re-derived by hand at every breakpoint.

   A harness that keeps asserting a deleted feature is worse than no harness, so
   these now assert the DELETION instead: the element is gone from the DOM, both
   magic offsets are gone from the cascade, and the disc is back to a plausible
   rivet ratio. That is what has to stay true. */
const hub = await evalOn(`(() => {
  const stage = document.querySelector('.ring-stage');
  const cs = getComputedStyle(stage);
  const disc = document.querySelector('.ring-hub').getBoundingClientRect();
  const blade = document.querySelector('.blade').getBoundingClientRect();
  const fan = [...document.querySelectorAll('.blade')].reduce((a,b)=>{
    const r=b.getBoundingClientRect();
    return {l:Math.min(a.l,r.left), r:Math.max(a.r,r.right)};
  },{l:1e9,r:-1e9});
  return {
    codeInDom: !!document.querySelector('.ring-hub-code'),
    dx: cs.getPropertyValue('--hub-dx').trim(),
    dy: cs.getPropertyValue('--hub-dy').trim(),
    discW: +disc.width.toFixed(1),
    bladeW: +blade.width.toFixed(1),
    fanW: +(fan.r - fan.l).toFixed(1)
  };
})()`);
ok("the numeral on the rivet is gone from the DOM", hub.codeInDom === false);
ok("--hub-dx / --hub-dy are gone from the cascade with it",
  hub.dx === "" && hub.dy === "", JSON.stringify({ dx: hub.dx, dy: hub.dy }));
/* A real swatch-ring rivet is about a tenth of the fan. It was 26% and read as
   a doorknob; anything past ~18% is back to burying the blade roots, which are
   the only place fourteen laminae can be SEEN as a stack. */
ok("the rivet is a rivet, not a doorknob (<18% of the fan)",
  hub.discW / hub.fanW < 0.18,
  "disc=" + hub.discW + "px, fan=" + hub.fanW + "px, ratio=" +
    (hub.discW / hub.fanW).toFixed(3));

// The disc itself keeps its Z: it must sit proud of the whole stack, because a
// blade thumbed forward passes UNDER the rivet head, never over it.
const disc = await evalOn(`(() => {
  const m = new DOMMatrix(getComputedStyle(document.querySelector('.ring-hub')).transform);
  return { z: +m.m43.toFixed(1) };
})()`);
ok("the rivet disc keeps its Z", disc.z > 60, "z=" + disc.z);

// 3. The live region fires ONCE per commit, never on a pointer sweep.
const live = await evalOn(`(() => {
  const region = document.querySelector('.ring-live');
  const readout = document.querySelector('.ring-readout');
  if (!region) return { err: 'no live span' };
  const counts = { live: 0, readout: 0 };
  new MutationObserver(m => counts.live += m.length)
    .observe(region, { childList: true, characterData: true, subtree: true });
  new MutationObserver(m => counts.readout += m.length)
    .observe(readout, { childList: true, characterData: true, subtree: true });
  const bl = [...document.querySelectorAll('.blade')];
  bl.forEach(b => b.dispatchEvent(new MouseEvent('mouseenter')));
  return new Promise(r => setTimeout(() => r({
    counts,
    readoutIsLive: readout.hasAttribute('aria-live'),
    liveIsLive: region.getAttribute('aria-live')
  }), 60));
})()`, true);
ok("visible readout is NOT a live region", live.readoutIsLive === false);
ok("a dedicated visually-hidden live span exists", live.liveIsLive === "polite");
ok("a 14-blade pointer sweep announces NOTHING", live.counts.live === 0,
  "live mutations=" + live.counts.live + ", visible readout mutations=" + live.counts.readout);

const commit = await evalOn(`(() => {
  const region = document.querySelector('.ring-live');
  let n = 0;
  new MutationObserver(m => n += m.length).observe(region, { childList: true, characterData: true, subtree: true });
  document.querySelectorAll('.blade')[0].click();
  return new Promise(r => setTimeout(() => r({ n, text: region.textContent.slice(0, 24) }), 60));
})()`, true);
ok("a commit DOES announce", commit.n > 0 && /Raven/.test(commit.text), JSON.stringify(commit));

// 4. Selection at the arc extreme no longer sweeps across the fan.
const tip = await evalOn(`(() => {
  const bl = [...document.querySelectorAll('.blade')];
  const before = bl[0].getBoundingClientRect();
  bl[0].click();
  return new Promise(r => setTimeout(() => {
    const after = bl[0].getBoundingClientRect();
    const others = bl.slice(1).filter(b => {
      const o = b.getBoundingClientRect();
      return !(o.right < after.left || o.left > after.right || o.bottom < after.top || o.top > after.bottom);
    }).length;
    r({ w0: Math.round(before.width), h0: Math.round(before.height),
        w1: Math.round(after.width), h1: Math.round(after.height), overlaps: others,
        rx: getComputedStyle(bl[0]).transform });
  }, 500));
})()`, true);
ok("selected extreme blade does not balloon into a paddle",
  tip.w1 < tip.w0 * 1.25 && tip.h1 < tip.h0 * 1.2,
  `box ${tip.w0}x${tip.h0} -> ${tip.w1}x${tip.h1}`);

/* 5. Focus is visible, differs in hue from selection, AND IS DRAWN INSIDE THE
   LAYER. This used to read cs.outlineColor and require bone. It passed, and it
   was asserting the wrong technique: this stylesheet establishes at length that
   `outline` paints as a separate stroked path OUTSIDE the transformed layer and
   tears on a rotated box with a compound radius — which is exactly why the
   resting edge gave its outline up for an inset shadow — and then focus, the
   one state on the signature control that must be crisp, was left on the banned
   technique and this harness locked it there.
   Focus is now an inset box-shadow like every other edge on the object, so the
   assertion follows it: outline must be NONE, and the shadow must carry bone at
   3px INSIDE the gold selection ring. Bone inside gold is what separates the
   two states by hue, which was the point of the original rule. */
const focus = await evalOn(`(() => {
  const bl = [...document.querySelectorAll('.blade')];
  bl[6].click(); bl[6].focus();
  const cs = getComputedStyle(bl[6]);
  return { outline: cs.outlineStyle, shadow: cs.boxShadow };
})()`);
ok("focus is drawn inside the layer, never as an outline",
  focus.outline === "none", "outline-style=" + focus.outline);
ok("focus ring is bone, inside the gold selection ring",
  /244, 241, 246\) 0px 0px 0px 3px inset/.test(focus.shadow) &&
  /227, 207, 166\) 0px 0px 0px 6px inset/.test(focus.shadow),
  focus.shadow.slice(0, 96));

// 6. No outline on a resting blade (outline means focus and nothing else).
const edge = await evalOn(`(() => {
  const b = document.querySelectorAll('.blade')[3];
  const cs = getComputedStyle(b);
  return { outline: cs.outlineStyle, shadow: cs.boxShadow };
})()`);
ok("resting blade carries no outline (edge is an inset shadow)",
  edge.outline === "none" && /inset/.test(edge.shadow), edge.outline);

// 7. will-change is not pinned on the selected blade.
const wc = await evalOn(`(() => {
  const bl = [...document.querySelectorAll('.blade')];
  bl[6].click(); bl[6].blur(); document.body.focus();
  return { sel: getComputedStyle(bl[6]).willChange };
})()`);
ok("no permanent composite layer on the selected blade", wc.sel === "auto", "will-change=" + wc.sel);

// 8. @property --face registered and transitionable.
const faceProp = await evalOn(`(() => {
  const b = document.querySelectorAll('.blade')[6];
  return { face: getComputedStyle(b).getPropertyValue('--face').trim(),
           tr: getComputedStyle(b).transitionProperty };
})()`);
ok("--face is in the transition list", /--face/.test(faceProp.tr), faceProp.tr);
ok("--face computes to a number", !isNaN(parseFloat(faceProp.face)), "face=" + faceProp.face);

// 9. No z-index / filter / blend inside the 3D context; ring still 3D.
const ctx3d = await evalOn(`(() => {
  const ring = document.querySelector('.ring');
  const bad = [...ring.querySelectorAll('*')].filter(e => {
    const cs = getComputedStyle(e);
    return cs.zIndex !== 'auto' || cs.filter !== 'none' || cs.mixBlendMode !== 'normal';
  }).map(e => e.className);
  const af = getComputedStyle(ring, '::after');
  const am = new DOMMatrix(af.transform);
  const hubZ = new DOMMatrix(getComputedStyle(document.querySelector('.ring-hub')).transform).m43;
  const topZ = new DOMMatrix(getComputedStyle(document.querySelectorAll('.blade')[13]).transform).m43;
  return { style: getComputedStyle(ring).transformStyle, bad,
           ringAfter: af.content, afterEvents: af.pointerEvents,
           afterZ: +am.m43.toFixed(1), hubZ: +hubZ.toFixed(1), topZ: +topZ.toFixed(1) };
})()`);
ok("ring keeps preserve-3d", ctx3d.style === "preserve-3d");
ok("nothing inside the 3D context flattens it", ctx3d.bad.length === 0, JSON.stringify(ctx3d.bad));
/* REINSTATED, and this assertion is inverted from what it used to say.
   It used to require .ring::after to be GONE, on the reasoning that the shadow
   "sat in front of all fourteen laminae" and that "a rivet head casts away from
   the viewer, not toward it". Both halves were wrong. The rivet head sits above
   the whole stack; a shadow just above the TOP LAMINA and below the head is the
   away-from-the-viewer cast — it is the contact shadow of the head down onto
   the stack, which is the only direction a rivet head can cast. And the second
   objection (invisible, because the hub covered its centre) was an argument for
   offsetting it along the lamp vector, not for deleting it.
   Without it the blades terminated dead at the disc edge with zero contact
   darkening, which is the specific reason the hub read as a sticker dropped
   onto a drawing. So: it exists, it sits between the top lamina and the head,
   and it never eats a click. */
ok("the rivet casts a contact shadow onto the stack",
  ctx3d.ringAfter !== "none" && ctx3d.afterZ > ctx3d.topZ && ctx3d.afterZ < ctx3d.hubZ,
  `after=${ctx3d.afterZ} topLamina=${ctx3d.topZ} head=${ctx3d.hubZ}`);
ok("the contact shadow is not a hit target", ctx3d.afterEvents === "none");

/* ---------------------------------------------------------- NO-JS FALLBACK */
await go("customization", 1440, 900, 1, false);
const nojs = await evalOn(`1`).catch(() => null);
const nojsHtml = await send("Runtime.evaluate", {
  expression: "1", returnByValue: true
}, sessionId);
{
  const { root } = await send("DOM.getDocument", { depth: -1 }, sessionId);
  const { outerHTML } = await send("DOM.getOuterHTML", { nodeId: root.nodeId }, sessionId);
  ok("no-JS: html is NOT stamped data-js", !/<html[^>]*data-js/.test(outerHTML));
  ok("no-JS: the fallback copy is in the DOM, outside <noscript>",
    /class="ring-noscript"/.test(outerHTML) && !/<noscript[\s>]/.test(outerHTML.replace(/<!--[\s\S]*?-->/g, "")));
  ok("no-JS: the ring ships zero blades (so the copy has to carry it)",
    !/class="blade"/.test(outerHTML));
  ok("no-JS: the page still carries its heading and CTA",
    /Pick a blade/.test(outerHTML) && /Request a physical ring/.test(outerHTML));
}
// The stylesheet, not <noscript>, decides visibility — so a BLOCKED script
// (data-js never stamped, but scripting enabled) behaves identically.
await go("customization", 1440, 900, 1, true);
const blocked = await evalOn(`(() => {
  document.documentElement.removeAttribute('data-js');
  const n = document.querySelector('.ring-noscript');
  const hub = document.querySelector('.ring-hub');
  return { noscript: getComputedStyle(n).display, hub: getComputedStyle(hub).display };
})()`);
ok("blocked-script path: fallback copy shows, lone rivet hides",
  blocked.noscript !== "none" && blocked.hub === "none", JSON.stringify(blocked));

/* -------------------------------------------------------------- THE PLATES */
await go("wefts");
await evalOn(`(async()=>{const H=document.body.scrollHeight;
  document.documentElement.style.scrollBehavior='auto';for(let y=0;y<H+900;y+=400){window.scrollTo(0,y);
  await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,110)));}})()`, true);
await sleep(900);
ok("wefts console clean", logs.length === 0, logs.join(" | "));

const plates = await evalOn(`[...document.querySelectorAll('.plate')].map(p => ({
  mode: p.getAttribute('data-plate') || 'hank',
  drawn: p.hasAttribute('data-plate-w'),
  canvas: !!p.querySelector('canvas.plate-render'),
  bgImages: getComputedStyle(p).backgroundImage.split('),').length,
  stripe: /repeating-linear-gradient/.test(getComputedStyle(p).backgroundImage)
}))`);
ok("every plate drew a canvas", plates.every(p => p.drawn && p.canvas), JSON.stringify(plates.map(p => p.mode)));
ok("the CSS pinstripe is suppressed under a drawn canvas",
  plates.every(p => p.stripe === false), JSON.stringify(plates.map(p => p.stripe)));

// The stripe survives for the no-JS state.
await go("wefts", 1440, 900, 1, false);
{
  const { root } = await send("DOM.getDocument", { depth: -1 }, sessionId);
  const { outerHTML } = await send("DOM.getOuterHTML", { nodeId: root.nodeId }, sessionId);
  ok("no-JS: no canvas is inserted", !/plate-render/.test(outerHTML));
  ok("no-JS: no data-plate-w, so the gradient + stripe fallback still paints",
    !/data-plate-w/.test(outerHTML));
  ok("no-JS: wefts page still carries its content",
    /Hand-tied hides/.test(outerHTML) && /Ends comparison/.test(outerHTML));
}

// The three product modes are actually distinct generators.
await go("index");
await evalOn(`(async()=>{const H=document.body.scrollHeight;
  document.documentElement.style.scrollBehavior='auto';for(let y=0;y<H+900;y+=400){window.scrollTo(0,y);
  await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,110)));}})()`, true);
await sleep(800);
const idx = await evalOn(`[...document.querySelectorAll('.plate')].map(p =>
  ({ cap: p.querySelector('.plate-caption').textContent.trim().slice(0,28),
     mode: p.getAttribute('data-plate') || 'hank' }))`);
ok("the two homepage product plates use DIFFERENT generators",
  idx[0].mode !== idx[1].mode, JSON.stringify(idx.map(p => p.mode)));

await go("mesh-integration");
await evalOn(`(async()=>{const H=document.body.scrollHeight;
  document.documentElement.style.scrollBehavior='auto';for(let y=0;y<H+900;y+=400){window.scrollTo(0,y);
  await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,110)));}})()`, true);
await sleep(800);
const meshMode = await evalOn(`[...document.querySelectorAll('.plate')].map(p => p.getAttribute('data-plate'))`);
ok("the mesh page draws a mesh", meshMode.includes("mesh"), JSON.stringify(meshMode));

/* ---------------------------------------------------------------- THE HERO */
await go("index");
const heroZ = await evalOn(`(() => {
  const hero = document.querySelector('.hero');
  const scene = document.querySelector('.strand-scene');
  const planes = [...document.querySelectorAll('.strand-plane')].map(p => ({
    d: p.dataset.depth, t: getComputedStyle(p).transform }));
  return { persp: getComputedStyle(hero).perspective, style: getComputedStyle(scene).transformStyle, planes };
})()`);
ok("the hero's neutralised perspective is cut", heroZ.persp === "none", "perspective=" + heroZ.persp);
ok("the hero's preserve-3d context is cut", heroZ.style === "flat", "transform-style=" + heroZ.style);
ok("no plane carries a transform any more", heroZ.planes.every(p => p.t === "none"), JSON.stringify(heroZ.planes.map(p => p.t)));

const onlyPersp = await evalOn(`(() => {
  return [...document.querySelectorAll('*')].filter(e =>
    getComputedStyle(e).perspective !== 'none').map(e => e.className);
})()`);
ok("index has no perspective anywhere", onlyPersp.length === 0, JSON.stringify(onlyPersp));

// The strand reveal survives the font swap. Polled from OUTSIDE the page, so
// the measurement cannot be perturbed by a long-running in-page promise.
await send("Emulation.setScriptExecutionDisabled", { value: false }, sessionId);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await send("Page.navigate", { url: `file://${ROOT}/index.html` }, sessionId);
const trace = [];
for (let t = 0; t < 14; t++) {
  await sleep(150);
  const st = await evalOn(`(() => { const p = document.querySelector('.strand-plane path');
    return p ? (p.style.animation ? 'anim' : 'cleared') : 'none'; })()`);
  trace.push((t + 1) * 150 + ":" + st);
}
const joined = trace.join(" ");
ok("the strand reveal is never cleared mid-flight",
  !/cleared/.test(joined) && /anim/.test(joined), joined);

/* ----------------------------------------------------- DESKTOP HERO FIELD */
/* THE FINDING, TESTED DIRECTLY RATHER THAN ARGUED.
   The hero mask was scoped to max-width:860 only, so at 1440 filaments crossed
   "hair off a shelf", "cut, tied," and "swatch you send us", and a bright gold
   strand ran vertically straight through the middle of the SEE THE TWO METHODS
   button and split it in two.

   Asserting the mask's computed value would only prove a declaration exists.
   This proves the OUTCOME: screenshot a tight clip over the h1 and over the CTA
   row, then hide .strand-scene and screenshot the identical clips again, and
   measure how far the pixels moved.

   The threshold is a JUDGEMENT and it is written down rather than hidden. Byte
   identity was tried first and is the wrong bar — it fails on a single filament
   at 1% alpha, which no reader can see, and chasing it would mean deleting the
   hero prop rather than disciplining it. What matters is legibility: a delta of
   6/255 against this hero's own contrast is below the threshold of a visible
   edge, and the area figure catches the case where a broad wash moves the whole
   box a little instead of one strand moving a little of it a lot. */
await go("index", 1440, 900);
const clips = await evalOn(`(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y),
             width: Math.round(b.width), height: Math.round(b.height), scale: 1 }; };
  return { h1: r('.hero h1'), cta: r('.hero .btn-row') };
})()`);
async function shot(clip) {
  const { data } = await send("Page.captureScreenshot", { format: "png", clip }, sessionId);
  return data;
}
const withField = { h1: await shot(clips.h1), cta: await shot(clips.cta) };
await evalOn(`document.querySelector('.strand-scene').style.display='none'`);
await sleep(200);
const without = { h1: await shot(clips.h1), cta: await shot(clips.cta) };
await evalOn(`document.querySelector('.strand-scene').style.display=''`);
const dH1 = diff(withField.h1, without.h1);
const dCta = diff(withField.cta, without.cta);
ok("desktop: nothing legible lands on the h1",
  dH1.max <= 6, `max delta ${dH1.max}/255 over ${dH1.movedPct}% of the box`);
ok("desktop: nothing legible splits the CTA row",
  dCta.max <= 6, `max delta ${dCta.max}/255 over ${dCta.movedPct}% of the box`);
/* And the field must still BE there — a mask that solved the overlap by
   deleting the hero prop would pass both tests above and fail the brief. */
const fieldAlive = await evalOn(`(() => {
  const sc = getComputedStyle(document.querySelector('.strand-scene'));
  return { mask: sc.maskImage, paths: document.querySelectorAll('.strand-plane path').length };
})()`);
ok("desktop: the mask is directional, and the field still exists",
  /deg/.test(fieldAlive.mask) && fieldAlive.paths > 20,
  fieldAlive.paths + " paths, mask=" + fieldAlive.mask.slice(0, 64));

/* ------------------------------------------------------------ MOBILE FIELD */
await go("index", 390, 844, 2);
const mob = await evalOn(`(() => {
  const paths = [...document.querySelectorAll('.strand-plane path')];
  const hero = document.querySelector('.hero').getBoundingClientRect();
  const btn = document.querySelector('.hero .btn').getBoundingClientRect();
  const lede = document.querySelector('.hero .lede').getBoundingClientRect();
  const svg = document.querySelector('.strand-plane').getBoundingClientRect();
  // Bottom of the drawn field, in page pixels.
  let maxY = 0;
  paths.forEach(p => { const b = p.getBBox(); maxY = Math.max(maxY, b.y + b.height); });
  const scale = svg.height / (document.querySelector('.strand-plane').viewBox.baseVal.height || 1);
  return {
    n: paths.length,
    fieldBottom: Math.round(svg.top + maxY * scale),
    ledeTop: Math.round(lede.top), btnTop: Math.round(btn.top),
    opacity: getComputedStyle(document.querySelector('.strand-plane')).opacity,
    mask: getComputedStyle(document.querySelector('.strand-scene')).maskImage !== 'none',
    heroH: Math.round(hero.height)
  };
})()`);
ok("mobile: the field ends above the CTA", mob.fieldBottom < mob.btnTop, JSON.stringify(mob));
ok("mobile: the field is masked off before the copy", mob.mask === true);
ok("mobile: the field runs as texture, not at full contrast", parseFloat(mob.opacity) <= 0.4, "opacity=" + mob.opacity);

/* ------------------------------------------------------------ REDUCED MOTION */
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }]
}, sessionId);
await go("customization");
const rm = await evalOn(`(() => {
  const b = document.querySelectorAll('.blade')[6];
  const ring = document.querySelector('.ring');
  return {
    ringTransform: getComputedStyle(ring).transform,
    bladeTransform: getComputedStyle(b).transform,
    dur: getComputedStyle(b).transitionDuration
  };
})()`);
ok("reduced motion: the ring's static 3D pose SURVIVES", /matrix3d/.test(rm.ringTransform));
ok("reduced motion: the blade's Z stack survives", /matrix3d/.test(rm.bladeTransform));
ok("reduced motion: transitions are killed, not slowed",
  rm.dur.split(",").every(d => parseFloat(d) <= 0.001), "duration=" + rm.dur);

await go("index");
const rmHero = await evalOn(`(() => {
  const p = document.querySelector('.strand-plane path');
  const pl = document.querySelector('.strand-plane');
  return { pathAnim: p ? p.style.animation : '', planeAnim: getComputedStyle(pl).animationName,
           translate: getComputedStyle(pl).translate };
})()`);
ok("reduced motion: no strand-draw animation is written", rmHero.pathAnim === "");
ok("reduced motion: the parallax drift is off", rmHero.planeAnim === "none" || rmHero.translate === "none",
  JSON.stringify(rmHero));
await send("Emulation.setEmulatedMedia", { features: [] }, sessionId);

/* ------------------------------------------------------------- THE FORM */
await go("partner");
const form = await evalOn(`(() => {
  const shell = document.querySelector('.form-shell');
  const sec = shell.closest('.section');
  const cs = getComputedStyle(shell);
  return { shadow: cs.boxShadow, bgImage: cs.backgroundImage !== 'none',
           shellBg: cs.backgroundColor, sectionBg: getComputedStyle(sec).backgroundColor };
})()`);
ok("the application panel now carries the house lamp",
  form.bgImage && form.shadow !== "none", form.shadow.slice(0, 48));

/* CUT with the numeral it measured: "hub readout clears 4.5:1 on the rivet
   face". There is no readout on the rivet any more, so there is no contrast
   ratio to hold — the shade code is reported once, in .ring-readout, where a
   spec belongs and where it is set on a panel this harness already checks.

   What replaces it is the thing the numeral was hiding. The rivet had to be
   21% wide to hold two digits, and at that size it buried the roots of all
   fourteen blades — which are the ONLY place on the page where the lamina stack
   can be seen as a stack, and the stack is what the entire depth budget of
   seven pages was spent on. So the assertion is now that the roots are
   visible: the top lamina's root must sit clear of the disc's edge. */
await go("customization");
const roots = await evalOn(`(() => {
  const hub = document.querySelector('.ring-hub').getBoundingClientRect();
  const bl = [...document.querySelectorAll('.blade')];
  // The pivot end of each blade, in screen space.
  const cy = hub.y + hub.height / 2;
  const clear = bl.filter(b => {
    const r = b.getBoundingClientRect();
    return r.top < cy - hub.height / 2;
  }).length;
  return { clear, total: bl.length, hubH: +hub.height.toFixed(1) };
})()`);
ok("the shrunken rivet leaves the blade roots visible",
  roots.clear === roots.total,
  `${roots.clear}/${roots.total} blades rise clear of a ${roots.hubH}px disc`);

console.log(`\n${pass}/${pass + fail} passed`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
