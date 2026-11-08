/* The With / Without Tilebot switch: swaps the page between calm and chaos. */
(() => {
  "use strict";
  const sw = document.getElementById("switch");
  const label = document.getElementById("switchText");
  const swapText = (mode) => document.querySelectorAll("[data-calm]").forEach((el) => { el.textContent = el.dataset[mode]; });
  function set(on) {
    document.body.classList.toggle("calm", on);
    document.body.classList.toggle("chaos", !on);
    sw.setAttribute("aria-checked", String(on));
    label.textContent = on ? "With Tilebot" : "Without Tilebot";
    swapText(on ? "calm" : "chaos");
  }
  sw.addEventListener("click", () => set(sw.getAttribute("aria-checked") !== "true"));
  // preload the second image so the first flip is instant
  addEventListener("load", () => { const i = new Image(); i.src = "img/chaos.png"; });
})();

/* Mockup: Tilebot drives the mouse on iPhone Mirroring and swipes words. */
(() => {
  "use strict";
  const board = document.getElementById("mBoard");
  if (!board) return;
  const L = "YOTEURSANVTEOOUS";
  const VAL = { Y: 4, O: 1, T: 1, E: 1, U: 2, R: 1, S: 1, A: 1, N: 1, V: 4 };
  const MULT = { 3: 40, 4: 50, 5: 65, 6: 75, 7: 85 };
  const rc = (r, c) => r * 4 + c;
  const WORDS = [
    ["ESTATES", [rc(0,3), rc(1,2), rc(0,2), rc(1,3), rc(2,2), rc(2,3), rc(3,3)]],
    ["VOTES",   [rc(2,1), rc(3,1), rc(2,2), rc(2,3), rc(3,3)]],
    ["STATE",   [rc(1,2), rc(0,2), rc(1,3), rc(2,2), rc(2,3)]],
    ["TOUR",    [rc(0,2), rc(0,1), rc(1,0), rc(1,1)]],
    ["ROTE",    [rc(1,1), rc(0,1), rc(0,2), rc(0,3)]],
    ["SEAT",    [rc(3,3), rc(2,3), rc(1,3), rc(2,2)]],
    ["TOYS",    [rc(0,2), rc(0,1), rc(0,0), rc(1,2)]].filter(Boolean),
  ].filter(([w, p]) => p.every((i, k) => k === 0 || adj(p[k - 1], i)));
  function adj(a, b) { const dr = Math.abs((a >> 2) - (b >> 2)), dc = Math.abs((a & 3) - (b & 3)); return a !== b && dr <= 1 && dc <= 1; }
  const pts = (w) => [...w].reduce((s, c) => s + (VAL[c] || 1), 0) * (MULT[w.length] || 85);
  const tiles = [...L].map((ch) => { const t = document.createElement("span"); t.className = "t"; t.innerHTML = ch + '<sub data-d="' + "•".repeat(VAL[ch] || 1) + '"></sub>'; board.appendChild(t); return t; });
  const $ = (id) => document.getElementById(id);
  const desk = document.querySelector(".desk"), cursor = $("mFinger"), line = $("mLine"), word = $("mWord"), list = $("mList"), pop = $("mPop");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms) => ms * (0.75 + Math.random() * 0.5);
  const inBoard = (i) => { const b = board.getBoundingClientRect(), r = tiles[i].getBoundingClientRect(); return [r.left + r.width / 2 - b.left, r.top + r.height / 2 - b.top]; };
  const inDesk = (i) => { const d = desk.getBoundingClientRect(), r = tiles[i].getBoundingClientRect(); return [r.left + r.width / 2 - d.left + (Math.random() * 6 - 3), r.top + r.height / 2 - d.top + (Math.random() * 6 - 3)]; };
  const moveCursor = ([x, y]) => { cursor.style.left = x - 3 + "px"; cursor.style.top = y - 2 + "px"; };
  let visible = true;
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(board);
  const waitVisible = async () => { while (!visible) await sleep(300); };
  const setWord = (txt, ok) => { word.innerHTML = txt ? "<span>" + txt + "</span>" : "&nbsp;"; word.classList.toggle("ok", !!ok); };

  async function round() {
    let score = 0, found = 0, time = 30;
    list.innerHTML = ""; $("mScore").textContent = "0"; $("mTotal").textContent = "0"; $("mFound").textContent = "0";
    $("mTime").textContent = "0:30"; $("mBar").style.width = "100%"; $("mTimeWrap").classList.remove("low");
    setWord(""); $("mRead").textContent = ""; $("mLive").textContent = "Waiting for a board";
    cursor.style.left = "72%"; cursor.style.top = "62%";
    await sleep(900);
    $("mLive").textContent = "Reading board";
    for (let i = 1; i <= 16; i++) { $("mRead").textContent = L.slice(0, i); await sleep(40); }
    $("mLive").textContent = "Playing";
    const clock = setInterval(() => { if (!visible) return; time = Math.max(0, time - 1); $("mTime").textContent = "0:" + String(time).padStart(2, "0"); $("mBar").style.width = (time / 30 * 100) + "%"; if (time <= 8) $("mTimeWrap").classList.add("low"); }, 380);
    for (const [w, path] of WORDS) {
      await waitVisible();
      moveCursor(inDesk(path[0])); await sleep(jitter(260));
      cursor.classList.add("down");
      const P = [];
      for (let j = 0; j < path.length; j++) {
        moveCursor(inDesk(path[j]));
        await sleep(j ? jitter(150) : 60);
        tiles[path[j]].classList.add("on");
        const [x, y] = inBoard(path[j]); P.push(x.toFixed(1) + "," + y.toFixed(1)); line.setAttribute("points", P.join(" "));
        setWord(w.slice(0, j + 1));
      }
      cursor.classList.remove("down");
      const p = pts(w);
      setWord(w, true);
      path.forEach((i) => { tiles[i].classList.remove("on"); tiles[i].classList.add("done"); });
      pop.textContent = "+" + p.toLocaleString(); pop.classList.remove("go"); void pop.offsetWidth; pop.classList.add("go");
      score += p; found += 1;
      $("mScore").textContent = score.toLocaleString(); $("mTotal").textContent = score.toLocaleString(); $("mFound").textContent = found;
      const li = document.createElement("li"); li.innerHTML = `<b>${w}</b><span>+${p.toLocaleString()}</span>`; list.appendChild(li);
      await sleep(jitter(320));
      line.setAttribute("points", ""); path.forEach((i) => tiles[i].classList.remove("done"));
      await sleep(jitter(180));
    }
    clearInterval(clock);
    setWord(""); $("mLive").textContent = "Round done · waiting";
    cursor.style.left = "72%"; cursor.style.top = "62%";
    await sleep(2800);
  }
  (async () => { await sleep(500); for (;;) { await waitVisible(); await round(); } })();
})();
