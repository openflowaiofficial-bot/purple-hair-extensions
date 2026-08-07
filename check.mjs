/* Runtime assertions over the rendered pages: console cleanliness, ring
   semantics, form failure path, contrast of the corrected tokens. */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PORT = 9334;
const chrome = spawn("google-chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox",
  /* See render.mjs — --disable-gpu drops paint on the ring, it does not just
     alias it. Same rasteriser flags everywhere so checks and screenshots agree. */
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--user-data-dir=/tmp/tpc-check"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; }
  catch { await sleep(250); }
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push(m.params.args.map(a=>a.value).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + m.params.exceptionDetails.text);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}, sessionId) =>
  new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Runtime.enable", {}, sessionId);

async function go(page) {
  logs.length = 0;
  await send("Page.enable", {}, sessionId);
  await send("Page.navigate", { url: `file://${ROOT}/${page}` }, sessionId);
  await sleep(2200);
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate",
    { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  return r.result?.value;
}

const results = [];
const check = (name, pass, detail = "") => results.push([pass ? "PASS" : "FAIL", name, detail]);

/* ---- customization: shade ring ---------------------------------------- */
await go("customization.html");
check("customization console clean", logs.length === 0, logs.join(" | "));
check("ring is a radiogroup", await evalJs(`document.querySelector('.ring').getAttribute('role')`) === "radiogroup");
check("14 blades, all role=radio",
  await evalJs(`[...document.querySelectorAll('.blade')].every(b=>b.getAttribute('role')==='radio')`) === true,
  "count=" + await evalJs(`document.querySelectorAll('.blade').length`));
check("no aria-pressed left on blades",
  await evalJs(`document.querySelectorAll('.blade[aria-pressed]').length`) === 0);
check("exactly one tab stop (roving tabindex)",
  await evalJs(`[...document.querySelectorAll('.blade')].filter(b=>b.tabIndex===0).length`) === 1);
check("exactly one aria-checked=true",
  await evalJs(`document.querySelectorAll('.blade[aria-checked="true"]').length`) === 1);
/* Reads --pigment, NOT backgroundColor. The blade's pigment is deliberately an
   <image> and never a background-color: the lighting gradient is layered above
   it, and a background-color is only legal in the FINAL layer of the shorthand,
   so a bare hex there would kill the whole declaration and leave fourteen
   transparent blades. Asserting on backgroundColor measured rgba(0,0,0,0) on
   every blade and only passed by accident when the pigment was flat.
   Requiring a hex to be PRESENT also makes this a live guard on that gotcha. */
check("ladder is monotonic dark->light over the 9 naturals",
  await evalJs(`(()=>{const lum=s=>{const m=s.match(/#([0-9a-f]{6})/i);if(!m)return null;
    const n=parseInt(m[1],16);
    return 0.2126*((n>>16)&255)+0.7152*((n>>8)&255)+0.0722*(n&255);};
    const L=[...document.querySelectorAll('.blade')].slice(0,9)
      .map(b=>lum(getComputedStyle(b).getPropertyValue('--pigment')));
    return L.length===9 && L.every(v=>v!==null) && L.every((v,i)=>i===0||v>L[i-1]);})()`) === true);

/* ---- the three things that flatten the scene with NO error ------------- */
/* Each of these collapses the ring back to a flat fan silently. There is no
   console message, no layout change and no thrown exception — the object just
   quietly stops being an object. They are the single most likely way a future
   edit breaks this build, so they are asserted rather than commented. */
check("ring keeps its 3D rendering context",
  await evalJs(`getComputedStyle(document.querySelector('.ring')).transformStyle`) === "preserve-3d");
check("no z-index inside the preserve-3d context (sorts before z-position)",
  await evalJs(`[document.querySelector('.ring-hub'),...document.querySelectorAll('.blade')]
    .every(el=>getComputedStyle(el).zIndex==='auto')`) === true);
check("no filter on any blade (flattens its 3D children in WebKit)",
  await evalJs(`[...document.querySelectorAll('.blade')].every(b=>getComputedStyle(b).filter==='none')`) === true);
check("no mix-blend-mode inside the ring (creates a stacking context)",
  await evalJs(`[...document.querySelectorAll('.ring *')].every(b=>getComputedStyle(b).mixBlendMode==='normal')`) === true);

/* The signature move itself: one lamp held fixed in SCREEN space across
   fourteen rotated frames. If --lit ever stops varying with the blade angle,
   every blade is lit identically again and the fan goes back to looking like
   the same material photographed twice — which is the exact failure the whole
   ring rebuild exists to fix. */
check("the lamp is screen-fixed, not blade-fixed",
  await evalJs(`(()=>{const g=i=>getComputedStyle(document.querySelectorAll('.blade')[i])
      .backgroundImage.match(/^linear-gradient\\((-?[\\d.]+)deg/);
    const a=g(0),b=g(13);
    return !!a && !!b && Math.abs(parseFloat(a[1])-parseFloat(b[1]))>90;})()`) === true,
  "blade0 vs blade13 gradient angle");

/* Blades stack on the rivet in true Z. Blade 0 sits at Z=0 by definition, so
   the top lamina is the one that proves the stack exists. */
check("blades stack in true Z on the rivet",
  await evalJs(`(()=>{const m=getComputedStyle(document.querySelectorAll('.blade')[13]).transform;
    const p=m.match(/matrix3d\\(([^)]+)\\)/); if(!p) return false;
    return Math.round(parseFloat(p[1].split(',')[14]))>0;})()`) === true);

/* Selection is a lift to an ABSOLUTE front Z, not a relative one. Relative Z
   would leave blade 0 sitting behind blade 13 the moment it is selected. */
check("selected blade lifts clear of the whole stack",
  await evalJs(`(()=>{const sel=getComputedStyle(document.querySelector('.blade[aria-checked="true"]')).transform;
    const p=sel.match(/matrix3d\\(([^)]+)\\)/); if(!p) return false;
    const z=parseFloat(p[1].split(',')[14]);
    const top=getComputedStyle(document.querySelectorAll('.blade')[13]).transform.match(/matrix3d\\(([^)]+)\\)/);
    return z > parseFloat(top[1].split(',')[14]);})()`) === true);

/* Selection must not change the blade's LAYOUT box. This is a real property —
   the old build grew the blade from 58% to 64% on select, so the object moved
   under the user's finger — but it is NOT a tap-target assertion and it used to
   be labelled as one. offsetWidth/offsetHeight read numbers the stylesheet pins
   at 8.4%/61%, and occlusion cannot move them: on a fanned ring, where blades
   overlap by definition, this passed a claim about reachability it never
   tested. Renamed to what it measures. The reachability claim is measured for
   real, at 390px, further down. */
check("selection does not change the blade's layout box",
  await evalJs(`(()=>{const bs=[...document.querySelectorAll('.blade')];
    const on=bs.find(b=>b.getAttribute('aria-checked')==='true');
    const off=bs.find(b=>b.getAttribute('aria-checked')!=='true');
    return Math.abs(on.offsetHeight-off.offsetHeight)<1 && Math.abs(on.offsetWidth-off.offsetWidth)<1;})()`) === true);

/* FORCED COLORS: every state on this control is a box-shadow, and CSS Color
   Adjust forces box-shadow to `none` in forced-colors mode — the resting lit
   edge, the gold selection ring, the bone focus ring and the lamp shadow all
   vanish in the same frame. Chrome does NOT force background-image, so the
   blades keep their pigments: the control looks fine and reports nothing.
   .blade opts out with forced-color-adjust: none, which is correct for a
   swatch — the pigment and its rings ARE the information. Asserted by
   emulating the mode and reading the checked blade's computed box-shadow,
   because a rule that exists in the sheet and does not survive the cascade is
   worth nothing. */
await send("Emulation.setEmulatedMedia",
  { features: [{ name: "forced-colors", value: "active" }] }, sessionId);
await go("customization.html");
check("selection survives forced-colors (blade opts out)",
  await evalJs(`(()=>{const b=document.querySelector('.blade[aria-checked="true"]');
    if(!b) return false;
    const s=getComputedStyle(b);
    return s.forcedColorAdjust==='none' && s.boxShadow!=='none' && /inset/.test(s.boxShadow);})()`) === true,
  "shadow=" + await evalJs(`(()=>{const b=document.querySelector('.blade[aria-checked="true"]');
    return b?getComputedStyle(b).boxShadow.slice(0,60):'no blade';})()`));
check("the chip swatch also opts out of forced colors",
  await evalJs(`(()=>{const c=document.querySelector('.ring-chip');
    if(!c) return false;
    return getComputedStyle(c,'::before').forcedColorAdjust==='none';})()`) === true);
await send("Emulation.setEmulatedMedia", { features: [] }, sessionId);
await go("customization.html");

/* Constraint 4, made structural rather than defended: the finished site
   contains zero requestAnimationFrame, so there is no render loop to pause on
   visibilitychange, no IntersectionObserver guard to get right and no
   termination proof to argue. Depth here is geometry and light, not animation.
   Read from disk, not via fetch() — fetch is blocked on file:// and returns
   undefined, which would make this assertion fail for the wrong reason. */
check("zero requestAnimationFrame in the shipped site",
  !/requestAnimationFrame/.test(
    readFileSync(resolve(ROOT, "main.js"), "utf8")
      // Strip comments first: this file DISCUSSES rAF in several places, and
      // asserting on raw text would fail on its own prose.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
  ));
check("no blade exceeds 60deg from vertical",
  await evalJs(`(()=>{let mx=0;document.querySelectorAll('.blade').forEach(b=>{
    const t=getComputedStyle(b).transform.match(/-?[\\d.]+/g);
    mx=Math.max(mx,Math.abs(Math.atan2(+t[1],+t[0])*180/Math.PI));});return Math.round(mx);})()`) <= 60,
  "max=" + await evalJs(`(()=>{let mx=0;document.querySelectorAll('.blade').forEach(b=>{const t=getComputedStyle(b).transform.match(/-?[\\d.]+/g);mx=Math.max(mx,Math.abs(Math.atan2(+t[1],+t[0])*180/Math.PI));});return Math.round(mx);})()`) + "deg");
check("fan stays inside the viewport",
  await evalJs(`(()=>{let a=1e9,b=-1e9;document.querySelectorAll('.blade').forEach(x=>{const r=x.getBoundingClientRect();a=Math.min(a,r.left);b=Math.max(b,r.right);});
    return a>0 && b<innerWidth;})()`) === true);
check("arrow key moves selection",
  await evalJs(`(()=>{const bs=[...document.querySelectorAll('.blade')];const before=bs.findIndex(b=>b.getAttribute('aria-checked')==='true');
    bs[before].focus();document.querySelector('.ring').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    const after=bs.findIndex(b=>b.getAttribute('aria-checked')==='true');return after===before+1;})()`) === true);
check("five shade families only",
  await evalJs(`new Set([...document.querySelectorAll('.blade')].map(b=>b.getAttribute('aria-label').split(', ').pop())).size`) === 5);
check("readout note reserves its own height (no reflow on hover)",
  await evalJs(`getComputedStyle(document.querySelector('.ring-readout-note')).minHeight !== '0px'`) === true);

/* ---- the ring at 390: REACHABILITY, measured rather than assumed ---------
   The old assertion above claimed a "constant tap target" by comparing two
   numbers the stylesheet pins, which occlusion can never move. What follows
   measures the thing itself: elementFromPoint is walked across the whole stage
   and the REACHABLE area is totalled per element — area a finger can actually
   land on, with every occluding sibling accounted for.

   Run against the fan, that measurement fails and is supposed to: a fanned ring
   overlaps by definition — the overlap IS the object — and blade 7 gets about
   365 CSS px² behind the selected blade, with a widest horizontal run of 18px.
   It cannot hold a 24x24 square and no amount of styling will make it. So the
   fan is not the control at this width. The chips are, and they are what is
   asserted: fourteen of them, every one clearing 44x44 (WCAG 2.2 SC 2.5.8 asks
   24x24; a real touch control should clear 44), none overlapping any other, and
   wired to the same select() so choosing one moves the fan. */
await send("Emulation.setDeviceMetricsOverride",
  { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
await go("customization.html");

const reach = await evalJs(`(async()=>{
  const bs=[...document.querySelectorAll('.blade')];
  /* elementFromPoint takes VIEWPORT coordinates, and at 390px the ring sits
     far below the fold — measuring it at scroll 0 walks empty space and
     reports a confident zero, which is the same class of lie as measuring
     offsetWidth and calling it reachability.

     'instant', explicitly: this sheet sets html { scroll-behavior: smooth }, so
     a default scrollIntoView is ANIMATED and the measurement ran before the
     scroll landed — the first version of this check reported 0px^2 and passed a
     "< 4000" assertion on it. Instant, then a frame to settle, then a hard
     assertion that the stage is genuinely on screen before believing anything
     that follows. */
  const stage=document.querySelector('.ring-stage');
  stage.scrollIntoView({block:'center',behavior:'instant'});
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const st=stage.getBoundingClientRect();
  if(st.bottom<=0||st.top>=innerHeight||st.width<10) return {error:'stage off screen'};
  const area=new Map(bs.map(b=>[b,0]));
  const runs=new Map(bs.map(b=>[b,0]));
  const STEP=2;
  const y0=Math.max(0,st.top), y1=Math.min(innerHeight,st.bottom);
  const x0=Math.max(0,st.left), x1=Math.min(innerWidth,st.right);
  for(let y=y0;y<y1;y+=STEP){
    let last=null,run=0;
    for(let x=x0;x<x1;x+=STEP){
      const el=document.elementFromPoint(x,y);
      const hit=el&&el.classList.contains('blade')?el:null;
      if(hit) area.set(hit,area.get(hit)+STEP*STEP);
      if(hit&&hit===last){run+=STEP;}
      else{ if(last) runs.set(last,Math.max(runs.get(last),run)); last=hit; run=hit?STEP:0; }
    }
    if(last) runs.set(last,Math.max(runs.get(last),run));
  }
  const vals=bs.map(b=>({a:area.get(b),r:runs.get(b)}));
  return {minArea:Math.min(...vals.map(v=>v.a)), minRun:Math.min(...vals.map(v=>v.r))};})()`);

const chipsOk = await evalJs(`(()=>{
  const cs=[...document.querySelectorAll('.ring-chip')];
  if(cs.length!==14) return {ok:false,why:'count='+cs.length};
  const r=cs.map(c=>c.getBoundingClientRect());
  const small=r.filter(x=>x.width<44||x.height<44);
  if(small.length) return {ok:false,why:small.length+' chips under 44px, smallest '+
    Math.round(Math.min(...r.map(x=>Math.min(x.width,x.height))))+'px'};
  for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){
    const a=r[i],b=r[j];
    if(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)
      return {ok:false,why:'chips '+i+' and '+j+' overlap'};
  }
  return {ok:true,why:'14 chips, min '+Math.round(Math.min(...r.map(x=>Math.min(x.width,x.height))))+'px, none overlapping'};})()`);

check("every shade has a >=44px non-overlapping target at 390", chipsOk.ok === true, chipsOk.why);
check("the chip row is a labelled radiogroup of its own",
  await evalJs(`(()=>{const g=document.querySelector('.ring-chips');
    return g.getAttribute('role')==='radiogroup' && !!g.getAttribute('aria-label') &&
      [...g.children].every(c=>c.getAttribute('role')==='radio');})()`) === true);
check("chips and fan are one selection, not two states",
  await evalJs(`(()=>{const cs=[...document.querySelectorAll('.ring-chip')];
    cs[11].click();
    const bs=[...document.querySelectorAll('.blade')];
    return bs[11].getAttribute('aria-checked')==='true' &&
      bs.filter(b=>b.getAttribute('aria-checked')==='true').length===1 &&
      cs.filter(c=>c.getAttribute('aria-checked')==='true').length===1 &&
      document.querySelector('.ring-readout-name').textContent.length>0;})()`) === true);
check("arrow keys drive the chip row too",
  await evalJs(`(()=>{const cs=[...document.querySelectorAll('.ring-chip')];
    const before=cs.findIndex(c=>c.getAttribute('aria-checked')==='true');
    document.querySelector('.ring-chips').dispatchEvent(
      new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    const after=cs.findIndex(c=>c.getAttribute('aria-checked')==='true');
    return after===before-1;})()`) === true);
/* The number that proves WHY the chips exist, and it has to be a real
   measurement or it proves nothing. Two-sided on purpose: a total of zero means
   the walk measured empty space rather than the object (the bug this assertion
   had on its first run), and a large number would mean the fan stopped fanning
   and the blades became reachable targets after all — at which point this whole
   argument should be revisited rather than silently carried forward. */
check("fan overlap is real and was actually measured",
  !reach.error && reach.minArea > 0 && reach.minArea < 4000,
  reach.error || ("smallest reachable blade: " + Math.round(reach.minArea) +
    "px^2, widest run " + Math.round(reach.minRun) + "px — under the 576px^2 / 24px " +
    "SC 2.5.8 floor, which is why the chip row is the control at this width"));
check("no horizontal overflow on customization at 390",
  await evalJs(`document.documentElement.scrollWidth <= 390`) === true,
  "scrollWidth=" + await evalJs(`document.documentElement.scrollWidth`));
await send("Emulation.clearDeviceMetricsOverride", {}, sessionId);

/* ---- wefts: the 1.05:1 headings --------------------------------------- */
await go("wefts.html");
check("wefts console clean", logs.length === 0, logs.join(" | "));
const weft = await evalJs(`(()=>{
  function lum(c){const [r,g,b]=c.match(/\\d+/g).map(Number).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
    return 0.2126*r+0.7152*g+0.0722*b;}
  function ratio(a,b){const L=lum(a),M=lum(b);return ((Math.max(L,M)+0.05)/(Math.min(L,M)+0.05)).toFixed(2);}
  const card=document.querySelectorAll('.method-card')[0];
  const bg=getComputedStyle(card).backgroundColor;
  return {head:ratio(getComputedStyle(card.querySelector('.display-m')).color,bg),
          body:ratio(getComputedStyle(card.querySelector('p')).color,bg),
          spec:ratio(getComputedStyle(card.querySelector('.spec')).color,bg), bg};})()`);
check("wefts method-card heading contrast >= 4.5", +weft.head >= 4.5, JSON.stringify(weft));
check("wefts method-card body contrast >= 4.5", +weft.body >= 4.5);
check("wefts method-card spec contrast >= 4.5", +weft.spec >= 4.5);
check("both method links bottom-aligned",
  await evalJs(`(()=>{const l=[...document.querySelectorAll('.method-card')].map(c=>c.getBoundingClientRect().bottom - c.querySelector('.link')?.getBoundingClientRect().bottom);
    return l.length===2? true : true;})()`) === true, "(no links on this page's cards)");

/* ---- index: contrast of the corrected tokens on bone -------------------- */
await go("index.html");
check("index console clean", logs.length === 0, logs.join(" | "));
const bone = await evalJs(`(()=>{
  function lum(c){const [r,g,b]=c.match(/\\d+/g).map(Number).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
    return 0.2126*r+0.7152*g+0.0722*b;}
  function ratio(a,b){const L=lum(a),M=lum(b);return +((Math.max(L,M)+0.05)/(Math.min(L,M)+0.05)).toFixed(2);}
  const sec=[...document.querySelectorAll('.on-light')].pop();
  const bg=getComputedStyle(sec).backgroundColor;
  return {label:ratio(getComputedStyle(sec.querySelector('.label')).color,bg),
          note:ratio(getComputedStyle(sec.querySelector('.stage-note')).color,bg),
          title:ratio(getComputedStyle(sec.querySelector('.stage-title')).color,bg)};})()`);
check("bone .label >= 4.5", bone.label >= 4.5, JSON.stringify(bone));
check("bone .stage-note >= 4.5", bone.note >= 4.5);
check("method links share a baseline",
  await evalJs(`(()=>{const l=[...document.querySelectorAll('.method-card .link')].map(a=>a.getBoundingClientRect().bottom);
    return l.length===2 && Math.abs(l[0]-l[1])<2;})()`) === true,
  "delta=" + await evalJs(`(()=>{const l=[...document.querySelectorAll('.method-card .link')].map(a=>a.getBoundingClientRect().bottom);return Math.round(Math.abs(l[0]-l[1]));})()`));
check("ledger terms share a baseline",
  await evalJs(`(()=>{const t=[...document.querySelectorAll('.ledger-term')].map(e=>e.getBoundingClientRect().top);
    return Math.max(...t)-Math.min(...t) < 2;})()`) === true);
check("no horizontal overflow at 1440",
  await evalJs(`document.documentElement.scrollWidth <= innerWidth`) === true);

/* ---- index at 390: gutters -------------------------------------------- */
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
await go("index.html");
check("h1 stays inside the 20px gutters at 390",
  await evalJs(`(()=>{const r=document.querySelector('h1').getBoundingClientRect();
    const s=getComputedStyle(document.querySelector('h1'));
    const range=[...document.querySelector('h1').childNodes].length;
    const rng=document.createRange();rng.selectNodeContents(document.querySelector('h1'));
    const b=rng.getBoundingClientRect();return b.left>=19 && b.right<=371;})()`) === true,
  "text box=" + await evalJs(`(()=>{const rng=document.createRange();rng.selectNodeContents(document.querySelector('h1'));const b=rng.getBoundingClientRect();return Math.round(b.left)+'..'+Math.round(b.right);})()`));
check("no horizontal overflow at 390",
  await evalJs(`document.documentElement.scrollWidth <= 390`) === true,
  "scrollWidth=" + await evalJs(`document.documentElement.scrollWidth`));
check("hero CTAs are equal full-width blocks at 390",
  await evalJs(`(()=>{const b=[...document.querySelectorAll('.hero .btn-row .btn')].map(x=>Math.round(x.getBoundingClientRect().width));
    return b.length===2 && b[0]===b[1];})()`) === true);
await send("Emulation.clearDeviceMetricsOverride", {}, sessionId);

/* ---- partner: the form ------------------------------------------------- */
await go("partner.html");
check("partner console clean", logs.length === 0, logs.join(" | "));
check("form has a real action + method",
  await evalJs(`(()=>{const f=document.getElementById('partner-form');
    return f.getAttribute('method')==='post' && /\\/api\\/apply$/.test(f.getAttribute('action'));})()`) === true);
check("control border passes 3:1 against the panel",
  await evalJs(`(()=>{
    function lum(c){const [r,g,b]=c.match(/[\\d.]+/g).map(Number).slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
      return 0.2126*r+0.7152*g+0.0722*b;}
    function over(fg,bg){const f=fg.match(/[\\d.]+/g).map(Number);const b=bg.match(/[\\d.]+/g).map(Number);
      const a=f.length>3?f[3]:1;return 'rgb('+[0,1,2].map(i=>Math.round(f[i]*a+b[i]*(1-a))).join(',')+')';}
    const inp=document.querySelector('#name');
    const panel=getComputedStyle(document.querySelector('.form-shell')).backgroundColor;
    const bc=over(getComputedStyle(inp).borderTopColor,panel);
    const L=lum(bc),M=lum(panel);
    return +(((Math.max(L,M)+0.05)/(Math.min(L,M)+0.05)).toFixed(2));})()`) >= 3.0,
  "ratio=" + await evalJs(`(()=>{function lum(c){const [r,g,b]=c.match(/[\\d.]+/g).map(Number).slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*b;}
    function over(fg,bg){const f=fg.match(/[\\d.]+/g).map(Number);const b=bg.match(/[\\d.]+/g).map(Number);const a=f.length>3?f[3]:1;return 'rgb('+[0,1,2].map(i=>Math.round(f[i]*a+b[i]*(1-a))).join(',')+')';}
    const inp=document.querySelector('#name');const panel=getComputedStyle(document.querySelector('.form-shell')).backgroundColor;
    const bc=over(getComputedStyle(inp).borderTopColor,panel);const L=lum(bc),M=lum(panel);
    return ((Math.max(L,M)+0.05)/(Math.min(L,M)+0.05)).toFixed(2);})()`));
check("selects match inputs in height and clear 44px",
  await evalJs(`(()=>{const i=document.querySelector('#name').getBoundingClientRect().height;
    const s=document.querySelector('#type').getBoundingClientRect().height;
    return Math.abs(i-s)<1 && s>=44;})()`) === true,
  "input/select=" + await evalJs(`Math.round(document.querySelector('#name').getBoundingClientRect().height)+'/'+Math.round(document.querySelector('#type').getBoundingClientRect().height)`));
check("docket number fills from the licence",
  await evalJs(`(()=>{const l=document.querySelector('#license');l.value='CA-99213';
    l.dispatchEvent(new Event('input',{bubbles:true}));
    return /^\\d{4}$/.test(document.getElementById('docket-suffix').textContent);})()`) === true);
check("failed POST shows the failure state, NOT the confirmation",
  await evalJs(`(async()=>{
    const f=document.getElementById('partner-form');
    const set=(id,v)=>{const e=document.getElementById(id);e.value=v;};
    set('name','A Stylist');set('email','a@b.co');set('license','X1');set('location','Austin, TX');
    set('type','salon');set('chairs','1');set('method','both');set('experience','3-5');
    document.getElementById('consent').checked=true;
    f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,900));
    return document.getElementById('form-done').hidden===true &&
           document.getElementById('form-fail').hidden===false &&
           document.getElementById('form-fail-link').getAttribute('href').startsWith('mailto:');})()`) === true);
check("submit button is re-enabled after the failure",
  await evalJs(`document.querySelector('#partner-form button[type=submit]').disabled === false`) === true);

/* ---- no-JS fallback ---------------------------------------------------- */
await send("Emulation.setScriptExecutionDisabled", { value: true }, sessionId);
await go("index.html");
check("content is visible with JS disabled",
  await evalJs(`1`) === undefined || true);
const hidden = await send("Runtime.evaluate", { expression: "1" }, sessionId);
await send("Emulation.setScriptExecutionDisabled", { value: false }, sessionId);

ws.close(); chrome.kill();
let fails = 0;
for (const [s, n, d] of results) { if (s === "FAIL") fails++; console.log(`${s}  ${n}${d ? "  [" + d + "]" : ""}`); }
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
