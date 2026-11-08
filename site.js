/* Page behaviour: nav border on scroll, fade-ins, How it works stepper. */
(() => {
  "use strict";
  const nav = document.querySelector(".nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  const fades = document.querySelectorAll(".fade");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      const sib = [...e.target.parentElement.children].filter((x) => x.classList.contains("fade"));
      e.target.style.transitionDelay = Math.min(sib.indexOf(e.target), 8) * 60 + "ms";
      e.target.classList.add("in"); io.unobserve(e.target);
    }), { threshold: 0.1 });
    fades.forEach((el) => io.observe(el));
  } else fades.forEach((el) => el.classList.add("in"));

  // How it works: click a step, or let it advance on its own while in view
  const steps = [...document.querySelectorAll("#howSteps li")];
  const panels = [...document.querySelectorAll(".how-right .panel")];
  let cur = 0, timer = null, inView = false;
  const show = (k) => {
    cur = k;
    steps.forEach((s, i) => s.classList.toggle("on", i === k));
    panels.forEach((p, i) => { p.hidden = i !== k; });
  };
  const tick = () => { clearInterval(timer); timer = setInterval(() => inView && show((cur + 1) % steps.length), 4500); };
  steps.forEach((s, i) => s.querySelector("button").addEventListener("click", () => { show(i); tick(); }));
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    new IntersectionObserver((es) => { inView = es[0].isIntersecting; }, { threshold: 0.4 }).observe(document.getElementById("how"));
    tick();
  }
})();
