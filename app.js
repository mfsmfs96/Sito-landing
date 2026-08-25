(() => {
  const $  = (s, c=document) => c.querySelector(s);
  const $$ = (s, c=document) => [...c.querySelectorAll(s)];

  const scenes   = $$(".scene");
  const loader   = $("#loader");
  const logo     = $("#logo");
  const progress = $("#progress");
  const dotnav   = $("#dotnav");
  const dots     = $$("#dotnav button");
  const menu     = $("#menu");
  const menuToggle = $("#menuToggle");
  const scrollCue = $("#scrollCue");
  const glow     = $("#glow");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- loader ---------- */
  addEventListener("load", () => {
    setTimeout(() => {
      loader.classList.add("hide");
      setTimeout(() => loader.remove(), 900);
    }, 900);
  });

  /* ---------- smooth scroll for every data-target ---------- */
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-target]");
    if (!el) return;
    const target = document.getElementById(el.dataset.target);
    if (target) {
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      menu.classList.remove("open");
      menuToggle.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
    }
  });

  /* ---------- mobile / full menu ---------- */
  menuToggle.addEventListener("click", () => {
    const open = menu.classList.toggle("open");
    menuToggle.classList.toggle("open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  addEventListener("keydown", e => {
    if (e.key === "Escape") {
      menu.classList.remove("open");
      menuToggle.classList.remove("open");
      closeModal(rsvpModal);
    }
  });

  /* ---------- reveal-on-scroll ---------- */
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add("is-inview");
    });
  }, { threshold: .18 });
  scenes.forEach(s => revealObserver.observe(s));
  // timeline lives inside its own section but may need separate trigger point
  const tl = $("#timeline2");
  if (tl) revealObserver.observe(tl.closest(".scene"));

  /* ---------- active section: dotnav + logo + progress ---------- */
  const sectionObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        dots.forEach(d => d.classList.toggle("active", d.dataset.target === id));
      }
    });
  }, { threshold: .5 });
  scenes.forEach(s => sectionObserver.observe(s));

  function onScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    const pct = max > 0 ? (scrollY / max) * 100 : 0;
    progress.style.width = pct + "%";

    logo.classList.toggle("show", scrollY > innerHeight * .5);
    scrollCue.classList.toggle("hide", scrollY > 120);

    if (!reduceMotion) {
      scenes.forEach(scene => {
        const bg = scene.querySelector(".bg");
        if (!bg) return;
        const rect = scene.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const delta = (center - innerHeight / 2) / innerHeight;
        const amount = Math.max(-1, Math.min(1, delta));
        const isBand = scene.classList.contains("band");
        const range = isBand ? 14 : 26;
        const scale = isBand ? 1.16 : 1.12;
        bg.style.transform = `scale(${scale}) translate3d(0, ${amount * -range}px, 0)`;
      });
    }
  }
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();

  /* ---------- cursor glow (desktop only) ---------- */
  if (matchMedia("(hover:hover) and (pointer:fine)").matches && !reduceMotion) {
    let raf = null, tx = 0, ty = 0;
    addEventListener("mousemove", e => {
      tx = e.clientX; ty = e.clientY;
      glow.classList.add("active");
      if (!raf) raf = requestAnimationFrame(() => {
        glow.style.transform = `translate(${tx - 170}px, ${ty - 170}px)`;
        raf = null;
      });
    });
    addEventListener("mouseleave", () => glow.classList.remove("active"));
  }

  /* ---------- countdowns ---------- */
  function startCountdown(targetDate, els) {
    function tick() {
      const diff = targetDate - Date.now();
      if (diff <= 0) {
        Object.values(els).forEach(el => el && (el.textContent = "0"));
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (els.days)  els.days.textContent  = String(d);
      if (els.hours) els.hours.textContent = String(h).padStart(2, "0");
      if (els.mins)  els.mins.textContent  = String(m).padStart(2, "0");
      if (els.secs)  els.secs.textContent  = String(s).padStart(2, "0");
    }
    tick();
    return setInterval(tick, 1000);
  }

  startCountdown(new Date("2027-07-04T17:00:00+02:00"), {
    days: $("#cdDays"), hours: $("#cdHours"), mins: $("#cdMins"), secs: $("#cdSecs")
  });

  /* ---------- detail cards accordion ---------- */
  $$(".detail-card").forEach(card => {
    card.addEventListener("click", () => {
      const willOpen = !card.classList.contains("open");
      $$(".detail-card").forEach(c => c.classList.remove("open"));
      if (willOpen) card.classList.add("open");
    });
  });

  /* ---------- modals ---------- */
  function openModal(overlay) { overlay.classList.add("show"); document.body.style.overflow = "hidden"; }
  function closeModal(overlay) { overlay.classList.remove("show"); document.body.style.overflow = ""; }

  const rsvpModal = $("#rsvpModal");

  $("#openRsvp").addEventListener("click", () => {
    rsvpFormView.style.display = "";
    rsvpSuccess.classList.remove("show");
    rsvpForm.reset();
    openModal(rsvpModal);
  });

  rsvpModal.addEventListener("click", e => { if (e.target === rsvpModal) closeModal(rsvpModal); });
  $$("[data-close]", rsvpModal).forEach(btn => btn.addEventListener("click", () => closeModal(rsvpModal)));

  /* ---------- rsvp form ---------- */
  const rsvpForm = $("#rsvpForm");
  const rsvpFormView = $("#rsvpFormView");
  const rsvpSuccess = $("#rsvpSuccess");
  const submitBtn = rsvpForm.querySelector("button[type=submit]");

  rsvpForm.addEventListener("submit", e => {
    e.preventDefault();
    if (submitBtn.classList.contains("loading")) return;
    submitBtn.classList.add("loading");
    setTimeout(() => {
      submitBtn.classList.remove("loading");
      rsvpFormView.style.display = "none";
      rsvpSuccess.classList.add("show");
    }, 900);
  });

  /* ---------- back to top ---------- */
  const toTop = $("#toTop");
  if (toTop) toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));
})();
