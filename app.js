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
      closeDetailFull();
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

  /* ---------- magnetic buttons (desktop only) ---------- */
  if (matchMedia("(hover:hover) and (pointer:fine)").matches && !reduceMotion) {
    $$(".btn").forEach(btn => {
      btn.addEventListener("mousemove", e => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * .25}px, ${y * .25}px)`;
      });
      btn.addEventListener("mouseleave", () => { btn.style.transform = ""; });
    });
  }

  /* ---------- countdowns ---------- */
  function startCountdown(targetDate, els) {
    const prev = {};
    function setVal(el, key, val) {
      if (!el || prev[key] === val) return;
      prev[key] = val;
      el.textContent = val;
      if (!reduceMotion) {
        el.classList.remove("tick");
        void el.offsetWidth;
        el.classList.add("tick");
      }
    }
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
      setVal(els.days,  "days",  String(d));
      setVal(els.hours, "hours", String(h).padStart(2, "0"));
      setVal(els.mins,  "mins",  String(m).padStart(2, "0"));
      setVal(els.secs,  "secs",  String(s).padStart(2, "0"));
    }
    tick();
    return setInterval(tick, 1000);
  }

  startCountdown(new Date("2027-07-04T16:30:00+02:00"), {
    days: $("#cdDays"), hours: $("#cdHours"), mins: $("#cdMins"), secs: $("#cdSecs")
  });

  /* ---------- detail cards: full-page view ---------- */
  const detailFull = $("#detailFull");
  const detailFullIcon = $("#detailFullIcon");
  const detailFullTitle = $("#detailFullTitle");
  const detailFullText = $("#detailFullText");
  let activeDetailMore = null, activeDetailParent = null, activeDetailNext = null;

  function openDetailFull(card) {
    const svg = card.querySelector("svg");
    const h3 = card.querySelector("h3");
    const more = card.querySelector(".detail-more");
    detailFullIcon.innerHTML = "";
    if (svg) detailFullIcon.appendChild(svg.cloneNode(true));
    detailFullTitle.textContent = h3 ? h3.textContent : "";
    if (more) {
      activeDetailMore = more;
      activeDetailParent = more.parentNode;
      activeDetailNext = more.nextSibling;
      detailFullText.appendChild(more);
    }
    detailFull.classList.add("show");
    document.body.style.overflow = "hidden";
  }
  function closeDetailFull() {
    detailFull.classList.remove("show");
    document.body.style.overflow = "";
    if (activeDetailMore && activeDetailParent) {
      activeDetailParent.insertBefore(activeDetailMore, activeDetailNext);
    }
    activeDetailMore = activeDetailParent = activeDetailNext = null;
  }
  $$(".detail-card").forEach(card => {
    card.addEventListener("click", () => openDetailFull(card));
    card.addEventListener("keydown", e => {
      if (card.getAttribute("role") === "button" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openDetailFull(card);
      }
    });
  });
  $("#detailFullClose").addEventListener("click", closeDetailFull);
  detailFull.addEventListener("click", e => { if (e.target === detailFull) closeDetailFull(); });

  /* ---------- "da dove parti" trip planner ---------- */
  const DEST_ADDR = "Palazzo dei Principi Lanza, San Nicola Arcella (CS)";
  const originInput = $("#originInput");
  const originText = $("#originText");
  const originGeoBtn = $("#originGeoBtn");
  const originGoBtn = $("#originGoBtn");

  function openDirectionsFrom(origin) {
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(DEST_ADDR)}`;
    window.open(url, "_blank", "noopener");
  }

  if (originGoBtn) {
    originGoBtn.addEventListener("click", e => {
      e.stopPropagation();
      const val = originInput ? originInput.value.trim() : "";
      if (!val) {
        if (originText) originText.textContent = "Inserisci prima una città o un indirizzo di partenza.";
        if (originInput) originInput.focus();
        return;
      }
      if (originText) originText.textContent = `Percorso aperto in Google Maps da "${val}".`;
      openDirectionsFrom(val);
    });
  }

  if (originGeoBtn) {
    originGeoBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (!navigator.geolocation) {
        if (originText) originText.textContent = "La geolocalizzazione non è supportata su questo dispositivo.";
        return;
      }
      if (originText) originText.textContent = "Rilevamento della posizione in corso…";
      navigator.geolocation.getCurrentPosition(
        pos => {
          const coords = `${pos.coords.latitude},${pos.coords.longitude}`;
          if (originText) originText.textContent = "Percorso aperto in Google Maps dalla tua posizione attuale.";
          openDirectionsFrom(coords);
        },
        () => {
          if (originText) originText.textContent = "Non è stato possibile accedere alla tua posizione. Prova a scrivere la città manualmente.";
        },
        { timeout: 10000 }
      );
    });
  }

  if (originInput) {
    originInput.addEventListener("click", e => e.stopPropagation());
    originInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (originGoBtn) originGoBtn.click();
      }
    });
  }

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

  /* ---------- interactive petals on tap ---------- */
  if (!reduceMotion) {
    const PETAL_COLORS = ["var(--rose)", "var(--rose-soft)", "var(--rose-deep)"];
    document.addEventListener("click", e => {
      if (e.target.closest("input, textarea, select, #rsvpModal, #detailFull")) return;
      const count = 5 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const petal = document.createElement("i");
        petal.className = "petal";
        const angle = (Math.random() - .5) * 140;
        const dist = 60 + Math.random() * 90;
        const dx = Math.sin(angle * Math.PI / 180) * dist;
        const fall = 90 + Math.random() * 90;
        const rot = (Math.random() - .5) * 260;
        const dur = 900 + Math.random() * 700;
        const size = 7 + Math.random() * 7;
        petal.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;width:${size}px;height:${size}px;background:${PETAL_COLORS[i % PETAL_COLORS.length]};--dx:${dx}px;--fall:${fall}px;--rot:${rot}deg;animation-duration:${dur}ms`;
        document.body.appendChild(petal);
        petal.addEventListener("animationend", () => petal.remove());
      }
    });
  }
})();
