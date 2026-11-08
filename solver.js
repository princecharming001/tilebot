/* Tilebot solver - runs entirely in the browser.
   Pipeline (same as the Mac app): find the 4x4 grid of light tiles -> read each letter by
   template matching against a library of tile shapes -> walk the board for every word in an
   everyday-English list -> rank by the game's scoring (tile values x length multiplier). */
(() => {
  "use strict";

  const LEN_MULT = { 3: 40, 4: 50, 5: 65, 6: 75, 7: 85, 8: 95, 9: 105, 10: 115 };
  const LIGHT = 175;          // tile brightness threshold on the downscaled grey image
  const TPL_SIZE = 20;
  const TPL_ACCEPT = 17;      // beyond this the tile is unknown
  const TPL_TRUST = 10;       // within this it is a clean hit
  const TPL_MARGIN = 1.3;
  const ZIPF_RARE = 3.0;
  const ZIPF_MIN = 2.6;

  const $ = (s) => document.querySelector(s);
  const grid = $("#grid"), wordList = $("#wordList"), statusText = $("#statusText"), dot = $("#dot");
  const video = $("#video"), preview = $("#preview"), shotPreview = $("#shotPreview");

  let trie = null, templates = null, assetsReady = false;
  let state = { letters: null, how: null, values: null, words: [], selected: null, source: "none" };
  let stream = null, liveTimer = null, lastLetters = "";

  // ------------------------------------------------------------ assets
  async function loadAssets() {
    const [wt, tj] = await Promise.all([
      fetch("assets/words.txt").then(r => r.text()),
      fetch("assets/templates.json").then(r => r.json()),
    ]);
    const root = {};
    for (const line of wt.split("\n")) {
      if (!line) continue;
      const sp = line.indexOf(" ");
      const w = sp > 0 ? line.slice(0, sp) : line;
      const z = sp > 0 ? parseFloat(line.slice(sp + 1)) : 0;
      let node = root;
      for (const ch of w) node = node[ch] || (node[ch] = {});
      node.$ = z;
    }
    trie = root;
    templates = {};
    for (const [letter, vecs] of Object.entries(tj.letters)) templates[letter] = vecs.map(v => Float32Array.from(v));
    assetsReady = true;
    setStatus("Ready.", "");
  }

  function setStatus(text, cls) {
    statusText.textContent = text;
    dot.className = "dot" + (cls ? " " + cls : "");
  }

  // ------------------------------------------------------------ image -> grey
  function greyOf(img) {           // ImageData -> Uint8Array grey
    const { data, width, height } = img;
    const g = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) g[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    return { g, w: width, h: height };
  }

  function downscale(G, div) {     // box-average by integer factor
    if (div === 1) return G;
    const w = Math.floor(G.w / div), h = Math.floor(G.h / div), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < div; dy++) { const row = (y * div + dy) * G.w + x * div; for (let dx = 0; dx < div; dx++) s += G.g[row + dx]; }
      out[y * w + x] = s / (div * div);
    }
    return { g: out, w, h };
  }

  // ------------------------------------------------------------ find the board
  function blobs(S) {
    const { g, w, h } = S, seen = new Uint8Array(w * h), out = [], stack = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (g[i] < LIGHT || seen[i]) continue;
      let n = 0, minx = x, maxx = x, miny = y, maxy = y;
      stack.length = 0; stack.push(i); seen[i] = 1;
      while (stack.length) {
        const k = stack.pop(); n++;
        const kx = k % w, ky = (k - kx) / w;
        if (kx < minx) minx = kx; if (kx > maxx) maxx = kx; if (ky < miny) miny = ky; if (ky > maxy) maxy = ky;
        if (kx + 1 < w && !seen[k + 1] && g[k + 1] >= LIGHT) { seen[k + 1] = 1; stack.push(k + 1); }
        if (kx > 0 && !seen[k - 1] && g[k - 1] >= LIGHT) { seen[k - 1] = 1; stack.push(k - 1); }
        if (ky + 1 < h && !seen[k + w] && g[k + w] >= LIGHT) { seen[k + w] = 1; stack.push(k + w); }
        if (ky > 0 && !seen[k - w] && g[k - w] >= LIGHT) { seen[k - w] = 1; stack.push(k - w); }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      if (n > 40 && bw / bh > 0.6 && bw / bh < 1.7) out.push([minx, miny, maxx + 1, maxy + 1]);
    }
    return out;
  }

  function lattice(cand) {
    cand = cand.slice().sort((a, b) => (a[1] + a[3]) - (b[1] + b[3]));
    const rows = []; let cur = [cand[0]]; const th = (cand[0][3] - cand[0][1]) * 0.5;
    for (const b of cand.slice(1)) {
      const prev = cur[cur.length - 1];
      if ((b[1] + b[3]) / 2 - (prev[1] + prev[3]) / 2 > th) { rows.push(cur); cur = [b]; } else cur.push(b);
    }
    rows.push(cur);
    const good = rows.filter(r => r.length >= 4).map(r => r.slice().sort((a, b) => a[0] - b[0]));
    if (good.length < 4) return null;
    for (let i = 0; i + 3 < good.length; i++) {
      const pick = good.slice(i, i + 4).map(r => r.slice(0, 4));
      const xs = pick.map(r => r.map(b => (b[0] + b[2]) / 2));
      const w = pick[0][0][2] - pick[0][0][0];
      let ok = true;
      for (let j = 0; j < 4 && ok; j++) for (let k = 0; k < 4; k++) if (Math.abs(xs[j][k] - xs[0][k]) >= w * 0.5) { ok = false; break; }
      if (ok) return pick.flat();
    }
    return null;
  }

  function findBoard(G) {
    const div = Math.max(1, Math.round(G.w / 700));
    const S = downscale(G, div);
    const bs = blobs(S).sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]));
    for (const seed of bs) {
      const a = (seed[2] - seed[0]) * (seed[3] - seed[1]);
      const near = bs.filter(b => { const ab = (b[2] - b[0]) * (b[3] - b[1]); return ab >= 0.6 * a && ab <= 1.6 * a; });
      if (near.length < 16) continue;
      const lat = lattice(near);
      if (lat) {
        const pad = Math.max(1, Math.floor((lat[0][2] - lat[0][0]) / 12));
        return lat.map(b => [(b[0] - pad) * div, (b[1] - pad) * div, (b[2] + pad) * div, (b[3] + pad) * div]);
      }
    }
    return null;
  }

  // ------------------------------------------------------------ read letters
  function crop(G, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(G.w, Math.floor(x1)); y1 = Math.min(G.h, Math.floor(y1));
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) g.set(G.g.subarray((y0 + y) * G.w + x0, (y0 + y) * G.w + x0 + w), y * w);
    return { g, w, h };
  }

  function resizeBox(C, W, H) {       // area-average resize to WxH, returns Float32Array
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const sy0 = Math.floor(y * C.h / H), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * C.h / H));
      for (let x = 0; x < W; x++) {
        const sx0 = Math.floor(x * C.w / W), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * C.w / W));
        let s = 0, n = 0;
        for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { s += C.g[yy * C.w + xx]; n++; }
        out[y * W + x] = s / n;
      }
    }
    return out;
  }

  function glyphOf(G, box) {          // tight glyph crop + square canvas, like the Mac app
    const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0;
    const c = crop(G, x0 + w * .18, y0 + h * .14, x1 - w * .18, y0 + h * .66);
    let minx = c.w, maxx = -1, miny = c.h, maxy = -1, n = 0;
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (c.g[y * c.w + x] < 90) { n++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    if (n < 8) return { glyph: c, raw: c, ink: false };
    const bx0 = Math.max(0, minx - 1), bx1 = Math.min(c.w, maxx + 2), by0 = Math.max(0, miny - 1), by1 = Math.min(c.h, maxy + 2);
    const sw = bx1 - bx0, sh = by1 - by0, side = Math.max(sw, sh), sq = { g: new Uint8Array(side * side).fill(225), w: side, h: side };
    const ox = Math.floor((side - sw) / 2), oy = Math.floor((side - sh) / 2);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) sq.g[(oy + y) * side + ox + x] = c.g[(by0 + y) * c.w + bx0 + x];
    return { glyph: sq, raw: c, ink: true };
  }

  function vecOf(glyph) {
    const v = resizeBox(glyph, TPL_SIZE, TPL_SIZE);
    let m = 0; for (const x of v) m += x; m /= v.length;
    let s = 0; for (const x of v) s += (x - m) * (x - m); s = Math.sqrt(s / v.length) + 1e-6;
    for (let i = 0; i < v.length; i++) v[i] = (v[i] - m) / s;
    return v;
  }

  function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }

  function inkGrid(raw) {             // 10x10 ink-fraction grid of the glyph's own ink box
    let minx = raw.w, maxx = -1, miny = raw.h, maxy = -1, n = 0;
    for (let y = 0; y < raw.h; y++) for (let x = 0; x < raw.w; x++) if (raw.g[y * raw.w + x] < 90) { n++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    if (n < 8) return null;
    const w = maxx - minx + 1, h = maxy - miny + 1, out = [];
    for (let r = 0; r < 10; r++) { out.push([]); for (let c = 0; c < 10; c++) {
      const y0 = miny + Math.floor(r * h / 10), y1 = Math.max(y0 + 1, miny + Math.floor((r + 1) * h / 10));
      const x0 = minx + Math.floor(c * w / 10), x1 = Math.max(x0 + 1, minx + Math.floor((c + 1) * w / 10));
      let s = 0, k = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += raw.g[y * raw.w + x] < 90 ? 1 : 0; k++; }
      out[r].push(k ? s / k : 0);
    } }
    return out;
  }
  const mean = (gr, r0, r1, c0, c1) => { let s = 0, n = 0; for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) { s += gr[r][c]; n++; } return n ? s / n : 0; };

  function disambiguate(a, b, raw) {  // look-alike pairs settled by glyph geometry
    const gr = inkGrid(raw); if (!gr) return null;
    const pair = [a, b].sort().join("");
    if (pair === "cg") return mean(gr, 4, 7, 5, 9) > 0.25 ? "g" : "c";
    if (pair === "hw") return mean(gr, 0, 2, 4, 6) > 0.25 ? "w" : "h";
    if (pair === "de") return Math.min(mean(gr, 2, 4, 8, 10), mean(gr, 6, 8, 8, 10)) > 0.25 ? "d" : "e";
    if (pair === "co") return mean(gr, 3, 7, 8, 10) > 0.3 ? "o" : "c";
    if (pair === "go") return Math.max(mean(gr, 4, 5, 5, 8), mean(gr, 5, 6, 5, 8), mean(gr, 6, 7, 5, 8)) > 0.35 ? "g" : "o";
    if (pair === "pr") return mean(gr, 7, 10, 6, 10) > 0.2 ? "r" : "p";
    if (pair === "hn") return (mean(gr, 0, 3, 2, 4) + mean(gr, 7, 10, 6, 8)) / 2 > 0.2 ? "n" : "h";
    return null;
  }

  function tileValue(G, box) {        // dots under the letter -> 1..6
    const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0;
    const c = crop(G, x0 + w * .25, y0 + h * .70, x1 - w * .25, y0 + h * .88);
    let n = 0, on = false;
    for (let x = 0; x < c.w; x++) {
      let dark = false; for (let y = 0; y < c.h; y++) if (c.g[y * c.w + x] < 110) { dark = true; break; }
      if (dark && !on) n++; on = dark;
    }
    return n >= 1 && n <= 6 ? n : null;
  }

  function readBoard(G, boxes) {
    const letters = [], how = [], values = {};
    for (const box of boxes) {
      const { glyph, raw, ink } = glyphOf(G, box);
      if (!ink) { letters.push("?"); how.push("u"); continue; }
      const v = vecOf(glyph);
      let best = Infinity, bl = null, second = Infinity, sl = null;
      for (const [letter, vecs] of Object.entries(templates)) {
        let d = Infinity; for (const t of vecs) { const dd = dist(v, t); if (dd < d) d = dd; }
        if (d < best) { second = best; sl = bl; best = d; bl = letter; } else if (d < second) { second = d; sl = letter; }
      }
      let ch = "?", h = "u";
      if (bl && best < TPL_ACCEPT) {
        ch = bl; h = best <= TPL_TRUST && second >= best * TPL_MARGIN ? "t" : "u";
        if (sl && second < Math.max(best * 2.0, TPL_TRUST + 4)) { const dec = disambiguate(bl, sl, raw); if (dec) { ch = dec; h = "t"; } }
      }
      letters.push(ch); how.push(h);
      if (ch !== "?" && !(ch in values)) { const val = tileValue(G, box); if (val) values[ch] = val; }
    }
    return { letters, how, values };
  }

  // ------------------------------------------------------------ words
  function solve(letters) {
    if (!trie) return [];
    const grid16 = letters.map(c => (c && c !== "?" ? c : null));
    const nbr = [];
    for (let i = 0; i < 16; i++) { const r = Math.floor(i / 4), c = i % 4, a = []; for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) if (rr >= 0 && rr < 4 && cc >= 0 && cc < 4 && (rr !== r || cc !== c)) a.push(rr * 4 + cc); nbr.push(a); }
    const found = new Map();
    const walk = (i, node, word, path, used) => {
      for (const j of nbr[i]) {
        if (used & (1 << j) || grid16[j] === null) continue;
        const nxt = node[grid16[j]]; if (!nxt) continue;
        const w2 = word + grid16[j], p2 = path.concat(j);
        if ("$" in nxt && w2.length >= 3 && !found.has(w2)) found.set(w2, { path: p2, z: nxt.$ });
        walk(j, nxt, w2, p2, used | (1 << j));
      }
    };
    for (let i = 0; i < 16; i++) { if (grid16[i] === null) continue; const node = trie[grid16[i]]; if (node) walk(i, node, grid16[i], [i], 1 << i); }
    return [...found.entries()].map(([w, { path, z }]) => ({ w, path, z }));
  }
  const points = (w, values) => [...w].reduce((s, c) => s + (values[c] || 2), 0) * (LEN_MULT[w.length] || 115);

  // ------------------------------------------------------------ UI
  function renderGrid() {
    grid.innerHTML = "";
    const L = state.letters || Array(16).fill("");
    const path = state.selected ? state.selected.path : [];
    L.forEach((ch, i) => {
      const t = document.createElement("div");
      t.className = "tile" + (path.includes(i) ? " on" : "") + (state.how && state.how[i] === "u" && ch ? " unsure" : "");
      t.textContent = ch ? ch.toUpperCase() : "";
      const k = path.indexOf(i);
      if (k >= 0) { const n = document.createElement("span"); n.className = "n"; n.textContent = k + 1; t.appendChild(n); }
      if (ch && state.values && state.values[ch]) { const v = document.createElement("span"); v.className = "v"; v.textContent = state.values[ch]; t.appendChild(v); }
      t.title = "Tap to correct";
      t.addEventListener("click", () => editTile(i, t));
      grid.appendChild(t);
    });
  }

  function editTile(i, tileEl) {
    if (tileEl.querySelector("input")) return;
    const inp = document.createElement("input"); inp.maxLength = 1; inp.value = (state.letters && state.letters[i] !== "?") ? state.letters[i] : "";
    tileEl.appendChild(inp); inp.focus(); inp.select();
    const done = () => {
      const v = inp.value.trim().toLowerCase();
      if (!state.letters) state.letters = Array(16).fill("?");
      if (!state.how) state.how = Array(16).fill("u");
      if (/^[a-z]$/.test(v)) { state.letters[i] = v; state.how[i] = "m"; }
      state.selected = null; state.source = state.source === "none" ? "type" : state.source;
      recompute();
    };
    inp.addEventListener("blur", done, { once: true });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") inp.blur(); });
  }

  function renderWords() {
    const showRare = $("#rare").checked;
    const values = state.values || {};
    const list = state.words.map(x => ({ ...x, pts: points(x.w, values) }))
      .filter(x => showRare || x.z >= ZIPF_MIN)
      .sort((a, b) => b.pts - a.pts || b.z - a.z);
    wordList.innerHTML = "";
    $("#wordsTitle").textContent = list.length ? `Best words · ${list.length}` : "Best words";
    if (!list.length) { const li = document.createElement("li"); li.className = "empty"; li.style.cssText = "border:0;background:transparent;cursor:default"; li.textContent = state.letters ? "No words found - check the letters." : "No board yet."; wordList.appendChild(li); return; }
    for (const x of list.slice(0, 60)) {
      const li = document.createElement("li");
      li.className = (x.z < ZIPF_RARE ? "rare" : "") + (state.selected && state.selected.w === x.w ? " sel" : "");
      li.innerHTML = `<span>${x.w}</span><span class="pts">${x.pts}</span>`;
      li.addEventListener("click", () => { state.selected = x; renderGrid(); renderWords(); });
      wordList.appendChild(li);
    }
  }

  function recompute() {
    state.words = state.letters ? solve(state.letters) : [];
    if (state.selected && !state.words.some(w => w.w === state.selected.w)) state.selected = null;
    renderGrid(); renderWords();
  }

  function processImageData(img, label) {
    const G = greyOf(img);
    const boxes = findBoard(G);
    if (!boxes) return false;
    const { letters, how, values } = readBoard(G, boxes);
    const key = letters.join("");
    if (key !== lastLetters) {
      lastLetters = key;
      state.letters = letters; state.how = how; state.values = values; state.selected = null; state.source = label;
      recompute();
    }
    return true;
  }

  // ------------------------------------------------------------ modes
  document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-selected", x === b ? "true" : "false"));
    document.querySelectorAll(".mode").forEach(m => m.classList.toggle("active", m.dataset.mode === b.dataset.mode));
    if (b.dataset.mode !== "live") stopLive();
  }));

  // live
  $("#shareBtn").addEventListener("click", async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { setStatus("Screen sharing is not supported in this browser - use a screenshot instead.", "bad"); return; }
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: false });
    } catch (e) { setStatus("Sharing was cancelled.", "bad"); return; }
    video.srcObject = stream; await video.play();
    $("#shareBtn").hidden = true; $("#stopBtn").hidden = false; preview.classList.add("show");
    stream.getVideoTracks()[0].addEventListener("ended", stopLive);
    setStatus("Looking for a board…", "live");
    const off = document.createElement("canvas"), ctx = off.getContext("2d", { willReadFrequently: true });
    const pctx = preview.getContext("2d");
    liveTimer = setInterval(() => {
      if (!video.videoWidth) return;
      off.width = video.videoWidth; off.height = video.videoHeight; ctx.drawImage(video, 0, 0);
      preview.width = 320; preview.height = Math.round(320 * off.height / off.width); pctx.drawImage(off, 0, 0, preview.width, preview.height);
      const ok = processImageData(ctx.getImageData(0, 0, off.width, off.height), "live");
      setStatus(ok ? "Live - reading the board" : "Live - no 4×4 grid in view yet", ok ? "live" : "");
    }, 450);
  });
  function stopLive() {
    if (liveTimer) clearInterval(liveTimer); liveTimer = null;
    if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
    $("#shareBtn").hidden = false; $("#stopBtn").hidden = true; preview.classList.remove("show");
    if (state.source === "live") setStatus("Sharing stopped.", "");
  }
  $("#stopBtn").addEventListener("click", stopLive);

  // screenshot
  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) { setStatus("That is not an image.", "bad"); return; }
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(im, 0, 0);
      const pctx = shotPreview.getContext("2d"); shotPreview.width = 320; shotPreview.height = Math.round(320 * c.height / c.width); pctx.drawImage(c, 0, 0, shotPreview.width, shotPreview.height); shotPreview.classList.add("show");
      lastLetters = "";
      const ok = processImageData(ctx.getImageData(0, 0, c.width, c.height), "shot");
      setStatus(ok ? `Board read from ${file.name || "image"}` : "Couldn't find a 4×4 grid in that image. Try a screenshot of the game screen, or type the letters.", ok ? "" : "bad");
      URL.revokeObjectURL(url);
    };
    im.onerror = () => setStatus("Couldn't open that image.", "bad");
    im.src = url;
  }
  const drop = $("#drop"), fileIn = $("#file");
  fileIn.addEventListener("change", () => handleFile(fileIn.files[0]));
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));
  document.addEventListener("paste", e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { document.querySelector('[data-mode="shot"]').click(); handleFile(f); } });

  // typed
  $("#lettersInput").addEventListener("input", (e) => {
    const v = e.target.value.toLowerCase().replace(/[^a-z]/g, "");
    e.target.value = v.toUpperCase();
    if (v.length === 16) { lastLetters = ""; state.letters = [...v]; state.how = Array(16).fill("m"); state.values = {}; state.selected = null; state.source = "type"; recompute(); setStatus("Board from typed letters (tile values unknown, scored as 2 each).", ""); }
  });
  $("#rare").addEventListener("change", renderWords);

  // boot
  renderGrid();
  loadAssets().catch(err => setStatus("Couldn't load the word list: " + err.message, "bad"));
  window.tilebot = { processImageData, solve, state: () => state };   // for tests
})();
