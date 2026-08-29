/* ==========================================================================
   The Purple Crown Extensions
   One script across every page. Each module exits quietly when its markup is
   absent, so the same file is safe to include everywhere.
   ========================================================================== */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------------
     THE SQUARE STORE — the one line to edit.

     Paste the Square Online store URL between the quotes, with no trailing
     slash. Every link marked data-store across every page picks it up.

       var STORE_URL = "https://purplecrown.square.site";

     Leave it empty and those links keep whatever href they already carry, so
     nothing on the site breaks before the store is connected.
     ------------------------------------------------------------------------ */
  var STORE_URL = "";

  /* Where each kind of link should land inside the store. */
  var STORE_PATHS = {
    store: "",
    login: "/account",
    orders: "/account/orders"
  };

  function initStoreLinks() {
    var links = document.querySelectorAll("[data-store]");
    if (!links.length) return;

    var base = STORE_URL.replace(/\/+$/, "");

    Array.prototype.forEach.call(links, function (a) {
      // No store yet — leave the fallback href alone.
      if (!base) return;

      var kind = a.getAttribute("data-store");
      var path = STORE_PATHS[kind] !== undefined ? STORE_PATHS[kind] : "";
      a.setAttribute("href", base + path);
      a.setAttribute("rel", "noopener");
    });
  }

  /* ------------------------------------------------------------------------
     Navigation
     ------------------------------------------------------------------------ */
  function initNav() {
    var burger = document.querySelector(".burger");
    var nav = document.querySelector(".nav");
    if (!burger || !nav) return;

    function setOpen(open) {
      nav.setAttribute("data-open", String(open));
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }

    burger.addEventListener("click", function () {
      setOpen(nav.getAttribute("data-open") !== "true");
    });

    // A tap on any destination closes the drawer behind it.
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.getAttribute("data-open") === "true") {
        setOpen(false);
        burger.focus();
      }
    });
  }

  /* ------------------------------------------------------------------------
     Reveal on scroll
     ------------------------------------------------------------------------ */
  function initReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!items.length) return;

    if (reduceMotion || !("IntersectionObserver" in window)) return;

    // Only now does the hidden state exist in CSS, so nothing can be stranded
    // invisible if this script never runs.
    document.documentElement.classList.add("js-reveal");

    // Anything already on screen is shown on the next frame rather than
    // animated in from nothing.
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(items, function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) {
          el.setAttribute("data-shown", "true");
        }
      });
    });

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-shown", "true");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.06 }
    );

    Array.prototype.forEach.call(items, function (el) {
      observer.observe(el);
    });
  }

  /* ------------------------------------------------------------------------
     Contact form
     There is no backend yet. Rather than print a receipt for a message that
     was never transmitted, this hands the visitor a pre-filled email to the
     support address and says plainly that is what it is doing.
     ------------------------------------------------------------------------ */
  var SUPPORT = "support@purplecrownextensions.com";

  function initContact() {
    var form = document.getElementById("contact-form");
    if (!form) return;

    var done = document.getElementById("contact-done");
    var doneLink = document.getElementById("contact-done-link");

    function validate(input) {
      var field = input.closest(".field");
      var slot = field && field.querySelector(".field-error");
      var problem = "";

      if (!input.value.trim()) {
        problem = "This field is required.";
      } else if (
        input.type === "email" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value)
      ) {
        problem = "Enter a valid email address.";
      }

      if (field) field.setAttribute("data-invalid", String(Boolean(problem)));
      if (slot) slot.textContent = problem;
      input.setAttribute("aria-invalid", String(Boolean(problem)));
      return !problem;
    }

    function mailtoFor(data) {
      var lines = [
        "Name: " + (data.name || ""),
        "Salon: " + (data.salon || ""),
        "License: " + (data.license || ""),
        "Phone: " + (data.phone || ""),
        "",
        data.message || ""
      ];
      return (
        "mailto:" + SUPPORT +
        "?subject=" + encodeURIComponent("Enquiry — " + (data.name || "The Purple Crown")) +
        "&body=" + encodeURIComponent(lines.join("\n"))
      );
    }

    var required = form.querySelectorAll("[required]");

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var firstBad = null;
      Array.prototype.forEach.call(required, function (input) {
        if (!validate(input) && !firstBad) firstBad = input;
      });
      if (firstBad) {
        firstBad.focus();
        return;
      }

      var data = {};
      new FormData(form).forEach(function (value, key) {
        data[key] = value;
      });

      if (!done) return;
      if (doneLink) doneLink.setAttribute("href", mailtoFor(data));
      done.hidden = false;
      done.setAttribute("tabindex", "-1");
      done.focus();
    });

    form.addEventListener("input", function (e) {
      var field = e.target.closest(".field");
      if (field && field.getAttribute("data-invalid") === "true") validate(e.target);
    });
  }

  /* ------------------------------------------------------------------------
     The cuticle bench
     Shows what cuticle alignment means rather than asserting it. Strands are
     the same in both states — only the direction of their cuticle scales
     changes, and the friction that follows from that.
     ------------------------------------------------------------------------ */
  var BENCH_COPY = {
    aligned: {
      title: "Aligned from root to end.",
      body:
        "Cuticle alignment matters. When the cuticles run in the same direction, " +
        "the strands move together more naturally and experience less friction. " +
        "This supports smoother movement, easier maintenance, and the luminous " +
        "finish professionals expect from exceptional hair."
    },
    mixed: {
      title: "Mixed direction",
      body:
        "When cuticles run in opposing directions, the scales meet against one " +
        "another and the strands catch rather than sliding together. That is the " +
        "friction cuticle alignment is there to reduce."
    }
  };

  function initBench() {
    var bench = document.querySelector(".bench");
    if (!bench) return;

    var stage = bench.querySelector(".bench-stage");
    var out = bench.querySelector(".bench-readout");
    if (!stage || !out) return;

    var W = 1000;
    var H = 360;
    var ROWS = 26;
    var ns = "http://www.w3.org/2000/svg";

    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");

    // A soft band of light lying across the strands — present only while the
    // cuticle agrees. Gradient, not a block: a hard edge reads as a rectangle
    // drawn over hair rather than light falling on it.
    var defs = document.createElementNS(ns, "defs");
    defs.innerHTML =
      '<linearGradient id="sheenGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#e8d3a8" stop-opacity="0"/>' +
      '<stop offset="45%" stop-color="#f0e0bd" stop-opacity="0.85"/>' +
      '<stop offset="100%" stop-color="#e8d3a8" stop-opacity="0"/>' +
      "</linearGradient>";
    svg.appendChild(defs);

    var sheen = document.createElementNS(ns, "rect");
    sheen.setAttribute("class", "cut-sheen");
    sheen.setAttribute("x", "0");
    sheen.setAttribute("y", String(H * 0.16));
    sheen.setAttribute("width", String(W));
    sheen.setAttribute("height", String(H * 0.5));
    sheen.setAttribute("fill", "url(#sheenGrad)");
    svg.appendChild(sheen);

    for (var r = 0; r < ROWS; r++) {
      var baseY = (H / (ROWS + 1)) * (r + 1);
      var amp = 5 + (r % 3) * 2.5;
      var phase = r * 0.62;

      var g = document.createElementNS(ns, "g");
      g.setAttribute("class", "cut-strand");

      // Half the strands run the other way once the cuticle is mixed.
      var opposed = r % 2 === 1;
      if (opposed) g.setAttribute("data-opposed", "true");

      // Drift is what makes mixed hair read as tangled: opposing strands
      // wander into their neighbours instead of lying parallel.
      var drift = opposed ? (r % 4 === 1 ? 6 : -5.5) : 0;
      g.style.setProperty("--drift", drift + "px");
      g.style.setProperty("--flip", opposed ? "128deg" : "0deg");

      var d = "M 0 " + baseY.toFixed(1);
      for (var x = 40; x <= W; x += 40) {
        var y = baseY + Math.sin(x / 150 + phase) * amp;
        d += " L " + x + " " + y.toFixed(1);
      }
      var hair = document.createElementNS(ns, "path");
      hair.setAttribute("class", "cut-hair");
      hair.setAttribute("d", d);
      g.appendChild(hair);

      // The scales themselves — short ticks leaning along the strand.
      for (var sx = 20; sx < W - 8; sx += 22) {
        var sy = baseY + Math.sin(sx / 150 + phase) * amp;
        var tick = document.createElementNS(ns, "line");
        tick.setAttribute("class", "cut-scale");
        tick.setAttribute("x1", String(sx));
        tick.setAttribute("y1", (sy - 3.2).toFixed(1));
        tick.setAttribute("x2", (sx + 6.2).toFixed(1));
        tick.setAttribute("y2", (sy + 1.0).toFixed(1));
        g.appendChild(tick);
      }

      svg.appendChild(g);
    }

    stage.appendChild(svg);

    function show(state) {
      bench.setAttribute("data-state", state);
      var copy = BENCH_COPY[state];
      out.querySelector("h3").textContent = copy.title;
      out.querySelector("p").textContent = copy.body;
      Array.prototype.forEach.call(
        bench.querySelectorAll(".bench-btn"),
        function (b) {
          b.setAttribute("aria-pressed", String(b.dataset.bench === state));
        }
      );
    }

    Array.prototype.forEach.call(bench.querySelectorAll(".bench-btn"), function (b) {
      b.addEventListener("click", function () {
        show(b.dataset.bench);
      });
    });

    show("aligned");
  }

  function boot() {
    initNav();
    initStoreLinks();
    initBench();
    initReveal();
    initContact();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
