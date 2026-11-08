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

/* Animated mockup: Tilebot reading a board and swiping words. */
(() => {
  "use strict";
  const board = document.getElementById("mBoard");
  if (!board) return;
  const L = "YOTEURSANVTEOOUS";
  const rc = (r, c) => r * 4 + c;
  const WORDS = [   // real paths on this board, scored like the game (2 per tile here)
    ["ESTATES", [rc(0,3), rc(1,2), rc(0,2), rc(1,3), rc(2,2), rc(2,3), rc(3,3)], 1190],
    ["STATE",   [rc(1,2), rc(0,2), rc(1,3), rc(2,2), rc(2,3)], 650],
    ["VOTES",   [rc(2,1), rc(3,1), rc(2,2), rc(2,3), rc(3,3)], 650],
    ["ROTE",    [rc(1,1), rc(0,1), rc(0,2), rc(0,3)], 400],
    ["TOUR",    [rc(0,2), rc(0,1), rc(1,0), rc(1,1)], 400],
    ["SEAT",    [rc(3,3), rc(2,3), rc(1,3), rc(2,2)], 400],
  ];
  const tiles = [...L].map((ch) => { const t = document.createElement("span"); t.className = "t"; t.textContent = ch; board.appendChild(t); return t; });
  const $ = (id) => document.getElementById(id);
  const line = $("mLine"), finger = $("mFinger"), word = $("mWord"), list = $("mList");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const center = (i) => { const b = board.getBoundingClientRect(), r = tiles[i].getBoundingClientRect(); return [r.left + r.width / 2 - b.left, r.top + r.height / 2 - b.top]; };
  let visible = true;
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(board);
  const waitVisible = async () => { while (!visible) await sleep(300); };

  async function round() {
    let score = 0, time = 30;
    list.innerHTML = ""; $("mScore").textContent = "0"; $("mTotal").textContent = "0"; $("mTime").textContent = "0:30";
    $("mTime").parentElement.classList.remove("low"); word.textContent = " "; $("mRead").textContent = "";
    $("mLive").textContent = "Reading board"; $("mbState").textContent = "Watching";
    for (let i = 1; i <= 16; i++) { $("mRead").textContent = L.slice(0, i); await sleep(45); }
    $("mLive").textContent = "Playing"; $("mbState").textContent = "Playing round";
    const clock = setInterval(() => { if (!visible) return; time = Math.max(0, time - 1); $("mTime").textContent = "0:" + String(time).padStart(2, "0"); if (time <= 8) $("mTime").parentElement.classList.add("low"); }, 420);
    for (const [w, path, pts] of WORDS) {
      await waitVisible();
      const P = [];
      finger.classList.add("show");
      for (let j = 0; j < path.length; j++) {
        const [x, y] = center(path[j]);
        finger.style.left = x + "px"; finger.style.top = y + "px";
        tiles[path[j]].classList.add("on");
        P.push(x.toFixed(1) + "," + y.toFixed(1)); line.setAttribute("points", P.join(" "));
        word.textContent = w.slice(0, j + 1); word.classList.remove("ok");
        await sleep(170);
      }
      word.classList.add("ok");
      path.forEach((i) => { tiles[i].classList.remove("on"); tiles[i].classList.add("done"); });
      score += pts; $("mScore").textContent = score.toLocaleString(); $("mTotal").textContent = score.toLocaleString();
      const li = document.createElement("li"); li.innerHTML = `<b>${w}</b><span>+${pts.toLocaleString()}</span>`; list.appendChild(li);
      await sleep(380);
      line.setAttribute("points", ""); path.forEach((i) => tiles[i].classList.remove("done"));
      finger.classList.remove("show");
      await sleep(260);
    }
    clearInterval(clock);
    $("mLive").textContent = "Round done"; $("mbState").textContent = "Watching"; word.textContent = " ";
    await sleep(2600);
  }
  (async () => { await sleep(600); for (;;) { await waitVisible(); await round(); } })();
})();
