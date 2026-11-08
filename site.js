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
