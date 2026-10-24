// Phone budget run in headless Chrome: GPU memory by category, JS heap, then frame cost per condition.
// node scripts/mobile-perf.mjs <url> <out.json> [shotDir]
// env: QUALITY=low VIEWPORT=390x844 DPR=3 THROTTLE=4 RATIOS=1,2 CONDS=night:rain,sunset RUNS=5 SECONDS=4 MEMORY=1
// With shotDir it also saves one unthrottled screenshot per condition and ratio.
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

const [url, outFile, shotDir] = process.argv.slice(2);
const env = process.env;
const quality = env.QUALITY ?? 'low';
const [vw, vh] = (env.VIEWPORT ?? '390x844').split('x').map(Number);
const dpr = Number(env.DPR ?? 3);
const throttle = Number(env.THROTTLE ?? 4);
const ratios = (env.RATIOS ?? '1').split(',').map(Number);
const conds = (env.CONDS ?? 'night:rain,sunset').split(',').map((c) => ({ time: c.split(':')[0], rain: c.includes(':rain') }));
const runs = Number(env.RUNS ?? 5);
const seconds = Number(env.SECONDS ?? 4);
const POSE = { x: Number(env.POSE_X ?? 0), y: Number(env.POSE_Y ?? 120), z: Number(env.POSE_Z ?? 1500), yaw: Number(env.POSE_YAW ?? 0) };

const instrument = `(() => {
  localStorage.setItem('macaw-sky-tlv:v1', JSON.stringify({ choice: { player: 'Amit', species: 'blueGold' }, settings: { muted: true, music: false, quality: ${JSON.stringify(quality)}, tilt: false, time: 'sunset', rain: false } }));
  const BPP = { 0x8058: 4, 0x8c43: 4, 0x8051: 4, 0x881a: 8, 0x881b: 8, 0x8814: 16, 0x8815: 16, 0x8229: 1, 0x822b: 2, 0x822d: 2, 0x822f: 4,
    0x822e: 4, 0x8230: 8, 0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8c3a: 4, 0x8059: 4, 0x8056: 2, 0x8d62: 2 };
  const UNSIZED = { 0x1908: 4, 0x1907: 3, 0x1903: 1, 0x8227: 2, 0x1902: 4 };
  const TYPE = { 0x1401: 1, 0x140b: 2, 0x8d61: 2, 0x1406: 4, 0x1405: 4, 0x1403: 2 };
  const bpp = (fmt, type) => BPP[fmt] ?? (UNSIZED[fmt] ?? 4) * (TYPE[type] ?? 1);
  const mem = { buffers: new Map(), textures: new Map(), renderbuffers: new Map() };
  window.__glmem = mem;
  const P = WebGL2RenderingContext.prototype;
  const boundBuf = new Map(), boundTex = new Map();
  let unit = 0x84c0, boundRb = null;
  const wrap = (name, after) => { const f = P[name]; P[name] = function (...a) { const r = f.apply(this, a); after.call(this, a, r); return r; }; };
  const texKey = (target) => (target >= 0x8515 && target <= 0x851a ? 0x8513 : target);
  wrap('bindBuffer', ([t, b]) => boundBuf.set(t, b));
  wrap('bufferData', ([t, d, , off, len]) => {
    const b = boundBuf.get(t); if (!b) return;
    const bytes = typeof d === 'number' ? d : len ? len * d.BYTES_PER_ELEMENT : d.byteLength - (off ?? 0) * (d.BYTES_PER_ELEMENT ?? 1);
    mem.buffers.set(b, bytes);
  });
  wrap('deleteBuffer', ([b]) => mem.buffers.delete(b));
  wrap('activeTexture', ([u]) => { unit = u; });
  wrap('bindTexture', ([t, tex]) => boundTex.set(unit + ':' + t, tex));
  const texOf = (target) => boundTex.get(unit + ':' + texKey(target));
  const record = (target, level, fmt, w, h, d, type) => {
    const tex = texOf(target); if (!tex) return;
    let e = mem.textures.get(tex);
    if (!e) mem.textures.set(tex, e = { cube: texKey(target) === 0x8513, w, h, fmt, levels: {} });
    if (level === 0) { e.w = w; e.h = h; e.fmt = fmt; }
    e.levels[level + ':' + target] = w * h * d * bpp(fmt, type);
  };
  wrap('texImage2D', (a) => {
    if (a.length >= 8) record(a[0], a[1], a[2], a[3], a[4], 1, a[7]);
    else record(a[0], a[1], a[2], a[5].width ?? a[5].videoWidth, a[5].height ?? a[5].videoHeight, 1, a[4]);
  });
  wrap('texStorage2D', ([t, levels, fmt, w, h]) => {
    const faces = t === 0x8513 ? [0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851a] : [t];
    for (const f of faces) for (let l = 0; l < levels; l++) record(f, l, fmt, Math.max(1, w >> l), Math.max(1, h >> l), 1, 0);
  });
  wrap('texImage3D', (a) => record(a[0], a[1], a[2], a[3], a[4], a[5], a[8]));
  wrap('texStorage3D', ([t, levels, fmt, w, h, d]) => { for (let l = 0; l < levels; l++) record(t, l, fmt, Math.max(1, w >> l), Math.max(1, h >> l), d, 0); });
  wrap('deleteTexture', ([tex]) => mem.textures.delete(tex));
  wrap('bindRenderbuffer', ([, rb]) => { boundRb = rb; });
  wrap('renderbufferStorage', ([, fmt, w, h]) => boundRb && mem.renderbuffers.set(boundRb, { w, h, fmt, bytes: w * h * bpp(fmt, 0) }));
  wrap('renderbufferStorageMultisample', ([, s, fmt, w, h]) => boundRb && mem.renderbuffers.set(boundRb, { w, h, fmt, bytes: w * h * bpp(fmt, 0) * Math.max(1, s) }));
  wrap('deleteRenderbuffer', ([rb]) => mem.renderbuffers.delete(rb));

  let gl = null, timer = null;
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const ctx = getContext.call(this, kind, ...rest);
    if (kind === 'webgl2' && ctx && !gl) { gl = ctx; timer = ctx.getExtension('EXT_disjoint_timer_query_webgl2'); }
    return ctx;
  };
  const pending = [];
  const poll = () => {
    while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const { q, rec, name } = pending.shift();
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        if (name) rec.segs[name] = (rec.segs[name] ?? 0) + ms; else rec.gpu = ms;
      }
      gl.deleteQuery(q);
    }
  };
  let rec = null, open = null;
  const begin = (name) => { if (open) gl.endQuery(timer.TIME_ELAPSED_EXT); const q = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, q); open = { q, rec, name }; pending.push(open); };
  const end = () => { if (open) gl.endQuery(timer.TIME_ELAPSED_EXT); open = null; };
  const segName = (r, scene) => {
    if (scene === window.game.scene) return "scene";
    const t = r.getRenderTarget()?.texture?.name ?? "";
    return t ? t.replace(/Mipmap\\d+/, "Mipmap*") : "to screen";
  };
  let wrapped = false;
  window.__ablate = "none";
  const wrapRenderer = (r) => {
    wrapped = true;
    const render = r.render, shadow = r.shadowMap.render;
    r.render = function (scene, camera) {
      if (window.__ablate === "bloom" && /Mipmap|Luminance/.test(this.getRenderTarget()?.texture?.name ?? "")) return;
      if (!rec || !window.__profile) return render.call(this, scene, camera);
      begin(segName(this, scene)); render.call(this, scene, camera); begin("other");
    };
    r.shadowMap.render = function (...a) {
      if (!rec || !window.__profile) return shadow.apply(this, a);
      begin("shadow"); shadow.apply(this, a); begin("scene");
    };
  };
  window.__frames = null;
  window.__profile = false;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (cb.name !== "frame" || !window.__frames) return cb(t);
    const info = window.game?.renderer.info;
    if (window.game && !wrapped) wrapRenderer(window.game.renderer);
    if (window.__ablate !== "none") window.__applyAblation?.();
    if (info) { info.autoReset = false; info.reset(); }
    rec = { t, cpu: 0, gpu: null, segs: {}, calls: 0, tris: 0 };
    if (timer) begin(window.__profile ? "other" : null);
    const px = new Uint8Array(4);
    const sync = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    if (window.__finish) sync();
    const start = performance.now();
    cb(t);
    rec.cpu = performance.now() - start;
    if (window.__finish) { sync(); rec.sync = performance.now() - start - rec.cpu; }
    if (timer) end();
    rec.calls = info?.render.calls ?? 0; rec.tris = info?.render.triangles ?? 0;
    window.__frames.push(rec);
    rec = null;
    if (timer) poll();
  });
})();`;

// Runs in the page once the game is up: maps every GL allocation to a category.
const memoryReport = `(() => {
  const { scene, renderer, city, landmarks, rain } = window.game;
  const gl = renderer.getContext(), props = renderer.properties, mem = window.__glmem;
  const within = (o, root) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  const layerOf = (o) => {
    const a = o.geometry?.attributes ?? {};
    if (within(o, city.group)) {
      if (a.aFacade) return 'city.buildings';
      if (a.aSurf) return 'city.flats';
      if (o.name === 'street lamps') return 'city.lamps';
      if (o.parent === city.group) return o.isInstancedMesh ? 'city.fringe' : 'city.ground';
      if (o.parent?.parent?.userData.clutter === o.parent) return 'city.clutter';
      return 'city.trees';
    }
    if (within(o, landmarks.group)) return 'landmarks';
    if (within(o, rain.object)) return 'rain';
    if (o.name === 'sky') return 'sky';
    return o.material?.uniforms?.uNormals ? 'sea' : 'other (macaw, flames)';
  };
  const bufLayer = new Map();
  const direct = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
    direct.call(this, camera, sc, geometry, material, object, group);
    const layer = layerOf(object);
    for (let i = 0; i < 16; i++) {
      if (!gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED)) continue;
      const b = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
      if (b && !bufLayer.has(b)) bufLayer.set(b, layer);
    }
    const e = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
    if (e && !bufLayer.has(e)) bufLayer.set(e, layer);
  };
  const changed = [];
  scene.traverse((o) => { changed.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
  const counts = [];
  scene.traverse((o) => { if (o.isInstancedMesh) { counts.push([o, o.count]); o.count = o.instanceMatrix.count; } });
  renderer.render(scene, window.game.camera);
  for (const [o, v, f] of changed) { o.visible = v; o.frustumCulled = f; }
  for (const [o, c] of counts) o.count = c;
  renderer.renderBufferDirect = direct;

  const cat = {};
  const add = (k, bytes) => { cat[k] = (cat[k] ?? 0) + bytes; };
  for (const [b, bytes] of mem.buffers) add('geometry: ' + (bufLayer.get(b) ?? 'unmapped'), bytes);
  const handle = (t) => t && props.get(t).__webglTexture;
  const env = handle(scene.environment);
  let sun = null; scene.traverse((o) => { if (o.isDirectionalLight) sun = o; });
  const shadowTex = new Set([handle(sun.shadow.map?.texture), handle(sun.shadow.map?.depthTexture)].filter(Boolean));
  const db = renderer.getDrawingBufferSize(window.game.camera.position.clone());
  const envEntry = mem.textures.get(env);
  const big = [];
  for (const [tex, e] of mem.textures) {
    const bytes = Object.values(e.levels).reduce((s, v) => s + v, 0);
    let k = 'textures: data';
    if (tex === env) k = 'env: pmrem';
    else if (shadowTex.has(tex)) k = 'shadow map';
    else if (e.cube) k = 'env: cube';
    else if (envEntry && e.w === envEntry.w && e.h === envEntry.h && e.fmt === envEntry.fmt) k = 'env: pmrem ping-pong';
    else if (e.w === db.x && e.h === db.y) k = 'post: full-res targets';
    else if (e.fmt === 0x881a || e.fmt === 0x822d || e.fmt === 0x822f) k = 'post: reduced targets';
    add(k, bytes);
    if (k === 'textures: data') big.push([e.w, e.h, e.fmt.toString(16), e.cube, +(bytes / 2 ** 20).toFixed(2)]);
  }
  for (const [, r] of mem.renderbuffers) add(r.w === db.x && r.h === db.y ? 'post: full-res depth' : 'renderbuffers: other', r.bytes);
  add('canvas (color + depth)', db.x * db.y * 8);
  const MB = (b) => +(b / 2 ** 20).toFixed(1);
  const total = Object.values(cat).reduce((s, v) => s + v, 0);
  const geometry = Object.entries(cat).filter(([k]) => k.startsWith('geometry')).reduce((s, [, v]) => s + v, 0);
  return { drawingBuffer: [db.x, db.y], totalMB: MB(total), geometryMB: MB(geometry), byCategoryMB: Object.fromEntries(Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, MB(v)])), dataTextures: big.sort((a, b) => b[4] - a[4]).slice(0, 12) };
})()`;

const stats = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2), n: s.length };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', ...(env.UNCAPPED === '1' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(instrument);
const cdp = await page.context().newCDPSession(page);
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.game, null, { timeout: 180000, polling: 500 });
await page.click('.mc-play', { force: true });
await page.waitForFunction(() => window.game.phase === 'playing', null, { timeout: 30000 });
await page.keyboard.down('Space');
await page.waitForTimeout(1500);
await page.keyboard.up('Space');

const result = { url, quality, viewport: [vw, vh], dpr, throttle, pose: POSE, programs: {}, runs: [] };
const pose = `(() => { const p = window.game.player; p.position.set(${POSE.x}, ${POSE.y}, ${POSE.z}); p.yaw = ${POSE.yaw}; p.pitch = 0; p.speed = 14; return p.flying; })()`;
const setRatio = (r) => page.evaluate((r) => {
  const { env, renderer } = window.game;
  if (env.setPixelRatio) env.setPixelRatio(r);
  else { renderer.setPixelRatio(r); env.setSize(innerWidth, innerHeight); }
  return renderer.getPixelRatio();
}, r);
const setCond = (c) => page.evaluate((c) => window.game.env.setConditions(c, { instant: true }), c);
const programs = () => page.evaluate(() => window.game.renderer.info.programs.length);

const ablations = (env.ABLATIONS ?? "none").split(",");
await page.evaluate(() => {
  const { city, camera, renderer } = window.game;
  const fringe = city.group.children.find((o) => o.isInstancedMesh);
  window.__applyAblation = () => {
    const a = window.__ablate;
    renderer.shadowMap.autoUpdate = a !== "shadow";
    fringe.visible = a !== "fringe";
    for (const o of city.group.children) {
      if (o.isInstancedMesh || !o.isMesh || o === city.group.children[0]) continue;
      const c = o.geometry.boundingSphere.center;
      o.visible = a !== "far" || Math.hypot(c.x - camera.position.x, c.z - camera.position.z) < 2500;
    }
    if (a === "trees") for (const o of city.group.children) if (o.isGroup) o.visible = false;
  };
});
const setAblation = (a) => page.evaluate((a) => { window.__ablate = a; if (a === "none") { window.__ablate = "restore"; window.__applyAblation(); window.__ablate = "none"; } }, a);
result.flying = await page.evaluate(pose);
for (const c of conds) { await setCond(c); await page.waitForTimeout(400); }
await page.waitForTimeout(1000);
result.programs.afterWarmUp = await page.evaluate(() => window.game.programsAfterWarmUp);
result.programs.afterConditions = await programs();

if (shotDir) {
  await page.addStyleTag({ content: '#app > :not(canvas) { visibility: hidden !important; }' });
  for (const r of ratios) for (const c of conds) {
    await setRatio(r);
    await setCond(c);
    await page.evaluate(pose);
    await page.waitForTimeout(2500);
    const name = `${shotDir}/${quality}-${c.time}${c.rain ? '-rain' : ''}-pr${r}.png`;
    await page.screenshot({ path: name });
    console.log('shot', name);
  }
}

if (runs > 0) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.evaluate(([p, f]) => { window.__profile = p; window.__finish = f; }, [env.PROFILE === '1', env.FINISH === '1']);
  for (let i = 0; i < runs; i++) {
    for (const a of ablations) for (const r of ratios) for (const c of conds) { // interleaved, so drift and machine noise land on every side
      await setAblation(a);
      await setRatio(r);
      await setCond(c);
      await page.evaluate(pose);
      await page.waitForTimeout(1200);
      const profiling = env.CPUPROFILE && i === 0;
      if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
      await page.evaluate(() => { window.__frames = []; });
      await page.waitForTimeout(seconds * 1000);
      if (profiling) await writeFile(`${env.CPUPROFILE}-pr${r}-${c.time}${c.rain ? '-rain' : ''}.cpuprofile`, JSON.stringify((await cdp.send('Profiler.stop')).profile));
      const frames = await page.evaluate(() => { const f = window.__frames; window.__frames = null; return f; });
      const segs = {};
      for (const f of frames) for (const [k, v] of Object.entries(f.segs)) (segs[k] ??= []).push(v);
      const intervals = frames.slice(1).map((f, k) => f.t - frames[k].t);
      const run = { run: i, ablation: a, ratio: r, ...c, frames: frames.length, cpu: stats(frames.map((f) => f.cpu)), gpu: stats(frames.map((f) => f.gpu)), gpuSync: stats(frames.map((f) => f.sync)), interval: stats(intervals), calls: stats(frames.map((f) => f.calls)), tris: stats(frames.map((f) => f.tris)), flying: await page.evaluate(() => window.game.player.flying), segs: Object.fromEntries(Object.entries(segs).map(([k, v]) => [k, stats(v)?.median])) };
      result.runs.push(run);
      console.log(`run ${i} ${a} pr${r} ${c.time}${c.rain ? '+rain' : ''}: cpu ${run.cpu?.median} ms, gpu ${run.gpu?.median} ms, sync ${run.gpuSync?.median} ms, interval ${run.interval?.median} ms, calls ${run.calls?.median}, frames ${run.frames}${env.PROFILE === '1' ? ' ' + JSON.stringify(run.segs) : ''}`);
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
}
result.programs.afterRuns = await programs();
if (env.SPOTS === "1") { // fly past every special place: shadow-depth variants depend on which casters share the shadow box
  result.programs.spots = {};
  const spots = await page.evaluate(() => window.game.landmarks.spots.map((s) => [s.id, s.position.x, s.position.y, s.position.z]));
  for (const [id, x, y, z] of spots) {
    await page.evaluate(([x, y, z]) => { const p = window.game.player; p.position.set(x - 30, y + 25, z + 30); p.yaw = 0.8; p.speed = 10; }, [x, y, z]);
    await page.waitForTimeout(1500);
    result.programs.spots[id] = await programs();
  }
}
if (env.MEMORY !== '0') {
  for (const r of ratios) {
    await setRatio(r);
    await page.waitForTimeout(500);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const report = await page.evaluate(memoryReport);
    result[`memory@${r}`] = { ...report, jsHeapMB: +(heap.usedSize / 2 ** 20).toFixed(1), arrayBuffersMB: heap.backingStorageSize != null ? +(heap.backingStorageSize / 2 ** 20).toFixed(1) : null };
    console.log(`memory @${r}`, JSON.stringify(result[`memory@${r}`]));
  }
}
if (env.CYCLE) { // setQuality round trip, the way main switches tiers
  result.cycle = [];
  for (const q of env.CYCLE.split(",")) {
    await page.evaluate((q) => { const g = window.game; g.env.setQuality(q); g.city.setQuality(q); g.rain.setQuality(q); g.env.setSize(innerWidth, innerHeight); }, q);
    await page.evaluate(pose);
    await page.waitForTimeout(2500);
    const state = await page.evaluate(() => ({ ratio: window.game.renderer.getPixelRatio(), maxPixelRatio: window.game.env.maxPixelRatio, textures: window.__glmem.textures.size, renderbuffers: window.__glmem.renderbuffers.size, programs: window.game.renderer.info.programs.length }));
    result.cycle.push({ quality: q, ...state });
    console.log("cycle", q, JSON.stringify(state));
    if (shotDir) await page.screenshot({ path: `${shotDir}/cycle-${result.cycle.length}-${q}.png` });
  }
}
if (env.CHURN) { // dynamic resolution churn: GL allocations must come back to the same totals
  const totals = () => page.evaluate(() => { const m = window.__glmem; const sum = (it) => [...it].reduce((s, v) => s + v, 0); return { textures: m.textures.size, renderbuffers: m.renderbuffers.size, textureMB: +(sum([...m.textures.values()].map((e) => Object.values(e.levels).reduce((a, b) => a + b, 0))) / 2 ** 20).toFixed(2), maxPixelRatio: window.game.env.maxPixelRatio, ratio: window.game.renderer.getPixelRatio() }; });
  await setRatio(ratios[0]); await page.waitForTimeout(300);
  const before = await totals();
  for (let i = 0; i < Number(env.CHURN); i++) { await setRatio(i % 2 ? ratios[0] : 0.75 + (i % 5) * 0.2); await page.waitForTimeout(100); }
  await setRatio(ratios[0]); await page.waitForTimeout(300);
  result.churn = { before, after: await totals(), steps: Number(env.CHURN) };
  console.log("churn", JSON.stringify(result.churn));
}
await writeFile(outFile, JSON.stringify(result, null, 2));
await browser.close();
console.log('wrote', outFile, 'programs', JSON.stringify(result.programs));
