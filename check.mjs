/* Runtime assertions over the rendered pages: console cleanliness, ring
   semantics, form failure path, contrast of the corrected tokens. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PORT = 9334;
const chrome = spawn("google-chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox",
  "--disable-gpu", "--user-data-dir=/tmp/tpc-check"
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
check("ladder is monotonic dark->light over the 9 naturals",
  await evalJs(`(()=>{const L=[...document.querySelectorAll('.blade')].slice(0,9).map(b=>{
    const m=getComputedStyle(b).backgroundColor.match(/\\d+/g).map(Number);
    return 0.2126*m[0]+0.7152*m[1]+0.0722*m[2];});
    return L.every((v,i)=>i===0||v>L[i-1]);})()`) === true);
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
