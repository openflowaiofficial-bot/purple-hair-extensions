/* ==========================================================================
   The Purple Crown Extensions — site behaviour
   Every module exits quietly if its markup is not on the page, so this one
   file can be shared across all seven pages.
   ========================================================================== */

(function () {
  "use strict";

  /* Stamp the document before anything else can throw. Until this lands, the
     stylesheet keeps every .reveal element visible — a blocked or broken
     script costs the animation, not the content. */
  document.documentElement.setAttribute("data-js", "");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

  /* Deterministic pseudo-random in [0,1) — same field on every load. */
  function rand(n) {
    var v = Math.sin(n * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  }

  /* ------------------------------------------------------------------------
     Masthead navigation
     ------------------------------------------------------------------------ */
  function initNav() {
    var burger = document.querySelector(".burger");
    var nav = document.querySelector(".nav");
    if (!burger || !nav) return;

    burger.addEventListener("click", function () {
      var open = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", String(!open));
      burger.setAttribute("aria-expanded", String(!open));
      // The label has to track the state too, or an expanded menu announces
      // itself as "Open menu, expanded".
      burger.setAttribute("aria-label", !open ? "Close menu" : "Open menu");
    });

    // Submenu: hover on pointer devices, click everywhere (and on mobile).
    var subToggle = document.querySelector(".nav-toggle-sub");
    var submenu = document.querySelector(".submenu");
    if (!subToggle || !submenu) return;

    var item = subToggle.closest(".nav-item");
    // Coupled to the burger breakpoint in styles.css — the two must move
    // together or hover opens a submenu that is laid out as a drawer.
    var hoverable = window.matchMedia("(hover: hover) and (min-width: 941px)");

    function setSub(open) {
      submenu.setAttribute("data-open", String(open));
      subToggle.setAttribute("aria-expanded", String(open));
    }

    subToggle.addEventListener("click", function () {
      setSub(submenu.getAttribute("data-open") !== "true");
    });

    if (item) {
      item.addEventListener("mouseenter", function () {
        if (hoverable.matches) setSub(true);
      });
      item.addEventListener("mouseleave", function () {
        if (hoverable.matches) setSub(false);
      });
    }

    // Close the submenu on Escape, and return focus to its trigger.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (submenu.getAttribute("data-open") === "true") {
        setSub(false);
        subToggle.focus();
      }
    });

    // Close the submenu when focus leaves it entirely.
    if (item) {
      item.addEventListener("focusout", function (e) {
        if (!item.contains(e.relatedTarget) && hoverable.matches) setSub(false);
      });
    }
  }

  /* ------------------------------------------------------------------------
     Hero strand field
     Fine filaments falling from a parting — the thing this house sells, drawn
     rather than photographed. Every strand starts in a narrow band at the top
     centre and fans outward, terminates at its own depth so the field has a
     hem rather than a flat cut, and tapers to nothing at the tip.
     ------------------------------------------------------------------------ */
  function initStrandField() {
    var svg = document.querySelector(".strand-field");
    if (!svg) return;

    /* Measuring the hero means the measurement has to be repeated when the
       hero changes size, or the box is stale and `slice` crops after all.
       It changes twice in practice: when the webfonts land and reflow the
       headline, and on rotation. Both rebuild; only the first draw animates,
       so a rotation does not replay the reveal. */
    var built = { w: 0, h: 0 };

    function build(animate) {
      var box = svg.getBoundingClientRect();
      var w = box.width > 200 ? Math.round(box.width) : 1200;
      var h = box.height > 200 ? Math.round(box.height) : 700;
      // Ignore sub-2% churn, so this is not redrawing on every scrollbar.
      if (Math.abs(w - built.w) < w * 0.02 && Math.abs(h - built.h) < h * 0.02) return;
      built = { w: w, h: h };
      svg.textContent = "";
      drawStrandField(svg, w, h, animate);
    }

    build(true);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        build(false);
      });
    }

    var t;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        build(false);
      }, 180);
    });
  }

  /* The viewBox is the hero's own pixel box rather than a hard-coded 1200x700.
     Under `slice`, that fixed box scaled a 390-wide, ~1900-tall mobile hero by
     2.1x and cropped to the middle fifth of its width, so the 54 fanning
     filaments became about ten near-vertical pinstripes running straight
     through the lede and both CTA buttons — the signature move reading as a
     stray repeating-gradient on the device most stylists will open this on.
     Matching the box to the element leaves `slice` nothing to slice at any
     width, and since every coordinate below is a fraction of W and H, the fan
     re-fits the phone instead of being cropped out of it. */
  function drawStrandField(svg, W, H, animate) {
    var COUNT = W < 700 ? 26 : 54;
    var ns = "http://www.w3.org/2000/svg";

    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "xMidYMin slice");

    // Two stroke gradients, solid at the root and transparent at the tip, so
    // no filament stops dead mid-hero.
    var defs = document.createElementNS(ns, "defs");
    [
      ["strand-fade", "#a578be"],
      ["strand-fade-accent", "#e3cfa6"]
    ].forEach(function (pair) {
      var g = document.createElementNS(ns, "linearGradient");
      g.setAttribute("id", pair[0]);
      g.setAttribute("x1", "0");
      g.setAttribute("y1", "0");
      g.setAttribute("x2", "0");
      g.setAttribute("y2", "1");
      [
        ["0%", pair[1], "0.15"],
        ["18%", pair[1], "1"],
        ["78%", pair[1], "0.7"],
        ["100%", pair[1], "0"]
      ].forEach(function (s) {
        var stop = document.createElementNS(ns, "stop");
        stop.setAttribute("offset", s[0]);
        stop.setAttribute("stop-color", s[1]);
        stop.setAttribute("stop-opacity", s[2]);
        g.appendChild(stop);
      });
      defs.appendChild(g);
    });
    svg.appendChild(defs);

    var frag = document.createDocumentFragment();

    for (var i = 0; i < COUNT; i++) {
      var t = i / (COUNT - 1);
      var spread = (t - 0.5) * 2; // -1 .. 1

      // The parting: roots sit across the crown, not at a single point — pull
      // them any tighter and the filaments stop falling and start radiating.
      var rootX = W * 0.5 + spread * W * 0.29 + (rand(i) - 0.5) * 26;
      // The fall: a gentle outward drift, so the field fans without splaying.
      var endX = rootX + spread * W * 0.2 + (rand(i + 90) - 0.5) * 46;

      // Each filament terminates at its own depth, so the field has a hem.
      var length = H * (0.45 + rand(i + 31) * 0.55);
      var sway = (Math.sin(i * 1.37) + Math.cos(i * 0.61)) * 26;

      var path = document.createElementNS(ns, "path");
      path.setAttribute(
        "d",
        "M " + rootX.toFixed(1) + " -8 " +
          "C " + (rootX + sway * 0.5).toFixed(1) + " " + (length * 0.38).toFixed(1) +
          ", " + (endX - sway * 0.7).toFixed(1) + " " + (length * 0.72).toFixed(1) +
          ", " + endX.toFixed(1) + " " + length.toFixed(1)
      );

      // A few brighter filaments read as the highlighted strands in a blend.
      var accent = i % 7 === 3;
      path.setAttribute("stroke", accent ? "url(#strand-fade-accent)" : "url(#strand-fade)");
      /* User units are now CSS pixels (the viewBox matches the box 1:1), where
         they used to be scaled up ~1.45x by `slice`. Restated at the weight
         they actually rendered at, or the filaments antialias away at 1x. */
      path.setAttribute("stroke-width", accent ? "1.45" : "1.05");

      // The centre is lightened by lowering opacity, not by emptying it out —
      // the field falls behind the headline rather than framing it.
      var edgeBias = Math.pow(Math.abs(spread), 0.8);
      path.setAttribute("opacity", (0.22 + edgeBias * 0.46).toFixed(2));

      if (animate && !reduceMotion) {
        path.style.strokeDasharray = length + 60;
        path.style.strokeDashoffset = length + 60;
        path.style.animation =
          "strand-draw 1.6s " + EASE + " " + (0.05 + rand(i + 7) * 0.6).toFixed(2) + "s forwards";
      }

      frag.appendChild(path);
    }

    svg.appendChild(frag);
  }

  /* ------------------------------------------------------------------------
     The shade ring
     A stylist matches color with a fanned swatch ring in hand. This is that
     ring: pick a blade, read the spec.

     The ladder runs monotonically dark to light across the arc — a colorist
     reads level left to right and will clock a shuffled ring in two seconds.
     The five specials sit as a deliberate tail past a visible gap.
     Families are the five the copy claims, no more.
     ------------------------------------------------------------------------ */
  var SHADES = [
    { code: "1B", name: "Raven", family: "Natural", hex: "#191317",
      note: "A soft black with no blue cast. Reads true under salon light and in daylight." },
    { code: "2", name: "Espresso", family: "Natural", hex: "#2a1d19",
      note: "The most requested base in our catalogue. Warm enough to blend into level 3 roots." },
    { code: "4", name: "Chestnut", family: "Natural", hex: "#432c22",
      note: "Neutral medium brown. The workhorse for rooted blends and shadow work." },
    { code: "6", name: "Cognac", family: "Natural", hex: "#5c3c28",
      note: "Light brown with a warm core. Holds gloss without pulling orange." },
    { code: "8", name: "Amber", family: "Natural", hex: "#7a5233",
      note: "Dark blonde with visible warmth. Bridges brunette clients into blonde." },
    { code: "10", name: "Wheat", family: "Blonde", hex: "#a17c4c",
      note: "Medium blonde, neutral. The safest hand-off shade between two color families." },
    { code: "18", name: "Champagne", family: "Blonde", hex: "#c2a075",
      note: "Beige blonde with the yellow pulled out. Our highest-volume blonde." },
    { code: "60", name: "Ivory", family: "Blonde", hex: "#ddc9a8",
      note: "Palest cool blonde we tone to. Toned in-house, never bleached on arrival." },
    { code: "613", name: "Vanilla", family: "Blonde", hex: "#e0cfa2",
      note: "Bright buttery blonde. Takes a toner beautifully if you want to cool it down." },
    { code: "4/18", name: "Shadowed Champagne", family: "Rooted", hex: "#432c22",
      tip: "#c2a075", note: "Level 4 root melting into champagne. Grows out for months without a line." },
    { code: "2/60", name: "Midnight Ivory", family: "Rooted", hex: "#2a1d19",
      tip: "#ddc9a8", note: "High-contrast rooted blonde. Built for clients who want the grow-out visible." },
    { code: "6/10", name: "Soft Cognac", family: "Rooted", hex: "#5c3c28",
      tip: "#a17c4c", note: "A low-contrast melt for brunettes who want dimension, not lift." },
    { code: "PC-1", name: "Crown Violet", family: "Signature", hex: "#3f2a4c",
      tip: "#8a5fa6", note: "Our house shade. Dark violet base into orchid ends, tuned in the color lab." },
    /* Not #24152e. That is exactly --aubergine, the ground of the section the
       ring sits in, so the lower 38% of this blade dissolved into the panel
       and only its 1px outline held the shape — on the one blade the copy
       singles out. #3a2246 is still the house violet, with a body. */
    { code: "CUSTOM", name: "Matched to swatch", family: "Bespoke", hex: "#3a2246",
      tip: "#c6a268", note: "Send a cutting or a lit photo. We formulate, dye, and return a sample before the full order runs." }
  ];

  // Index of the first special. Everything from here is the tail.
  var TAIL_AT = 9;

  function initShadeRing() {
    var ring = document.querySelector(".ring");
    if (!ring) return;

    var hubCode = document.querySelector(".ring-hub-code");
    var outName = document.querySelector(".ring-readout-name");
    var outFamily = document.querySelector(".ring-readout-family");
    var outNote = document.querySelector(".ring-readout-note");

    // 116° total: the extreme blades sit at 58° from vertical, so the fan
    // still reads as a ring, every tip clears the hub, and the arc stays
    // inside the stage. CSS scales this down again on small screens.
    var SPAN = 116;
    var GAP = 0.9; // extra steps of air before the specials
    var units = SHADES.length - 1 + GAP;
    var step = SPAN / units;
    var blades = [];
    var current = 6; // opens on Champagne — the shade that moves most

    function angleFor(i) {
      return -SPAN / 2 + (i + (i >= TAIL_AT ? GAP : 0)) * step;
    }

    function paint(i) {
      var shade = SHADES[i];
      if (hubCode) hubCode.textContent = shade.code;
      if (outName) outName.textContent = shade.name;
      if (outFamily) outFamily.textContent = shade.family + " — no. " + shade.code;
      if (outNote) outNote.textContent = shade.note;
    }

    /* One selection, not fourteen independent toggles — so this is a radio
       group with a roving tabindex: one tab stop, arrows move the choice. */
    function select(i, moveFocus) {
      current = i;
      blades.forEach(function (b, n) {
        var on = n === i;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      paint(i);
      if (moveFocus) blades[i].focus();
    }

    SHADES.forEach(function (shade, i) {
      var blade = document.createElement("button");
      blade.type = "button";
      blade.className = "blade";
      blade.setAttribute("role", "radio");
      blade.setAttribute("aria-checked", "false");
      blade.tabIndex = -1;
      blade.style.setProperty("--a", angleFor(i).toFixed(2) + "deg");
      blade.style.background = shade.tip
        ? "linear-gradient(to top, " + shade.hex + " 38%, " + shade.tip + ")"
        : shade.hex;
      blade.setAttribute(
        "aria-label",
        "Shade " + shade.code + ", " + shade.name + ", " + shade.family
      );

      blade.addEventListener("click", function () {
        select(i, false);
      });
      /* Preview, not commit. mouseenter used to call select(), the full path:
         it rewrote aria-checked on all fourteen blades, moved the roving
         tabindex and fired the live region — once per blade on a single
         pointer sweep — with no restore. So clicking "1B Raven" and then
         moving the pointer off across the fan left the ring committed to
         whatever it passed last, and aria-checked lied about the choice.
         paint() touches the readout and the hub only. */
      blade.addEventListener("mouseenter", function () {
        paint(i);
      });

      blades.push(blade);
      ring.appendChild(blade);
    });

    // Leaving the fan restores the shade that was actually chosen.
    ring.addEventListener("mouseleave", function () {
      paint(current);
    });

    ring.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % blades.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + blades.length) % blades.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = blades.length - 1;
      if (next === null) return;
      e.preventDefault();
      select(next, true);
    });

    select(current, false);
  }

  /* ------------------------------------------------------------------------
     Accordions
     ------------------------------------------------------------------------ */
  function initFolds() {
    var triggers = document.querySelectorAll(".fold-trigger");
    if (!triggers.length) return;

    Array.prototype.forEach.call(triggers, function (trigger) {
      var panel = document.getElementById(trigger.getAttribute("aria-controls"));
      if (!panel) return;

      trigger.addEventListener("click", function () {
        var open = trigger.getAttribute("aria-expanded") === "true";
        trigger.setAttribute("aria-expanded", String(!open));
        panel.setAttribute("data-open", String(!open));
      });
    });
  }

  /* ------------------------------------------------------------------------
     Partner application
     The one conversion goal on the site. It POSTs for real, and it only ever
     confirms what was actually transmitted — a failed send shows the failure
     and hands over a pre-filled mailto, it does not print a receipt.
     ------------------------------------------------------------------------ */
  var MAILBOX = "partners@thepurplecrown.com";

  function initApplication() {
    var form = document.getElementById("partner-form");
    if (!form) return;

    var done = document.getElementById("form-done");
    var fail = document.getElementById("form-fail");
    var failLink = document.getElementById("form-fail-link");
    var submit = form.querySelector('button[type="submit"]');
    var docket = document.getElementById("docket-suffix");
    var license = form.querySelector("#license");

    /* The docket number fills in from the licence as the applicant types it,
       so the form is visibly a numbered work order rather than a contact box. */
    if (docket && license) {
      license.addEventListener("input", function () {
        var v = license.value.trim();
        if (!v) {
          docket.textContent = "————";
          return;
        }
        var h = 0;
        for (var i = 0; i < v.length; i++) {
          h = (h * 31 + v.charCodeAt(i)) >>> 0;
        }
        docket.textContent = String(h % 10000).padStart(4, "0");
      });
    }

    function messageFor(input) {
      if (input.type === "checkbox") return "Please confirm to continue.";
      if (!input.value.trim()) return "This field is required.";
      if (input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value)) {
        return "Enter a valid email address.";
      }
      return "";
    }

    function validate(input) {
      var field = input.closest(".field") || input.closest(".form-consent");
      var slot = field && field.querySelector(".field-error");
      var problem =
        input.type === "checkbox" && !input.checked
          ? messageFor(input)
          : input.type === "checkbox"
          ? ""
          : messageFor(input);

      if (field) field.setAttribute("data-invalid", String(Boolean(problem)));
      if (slot) slot.textContent = problem;
      input.setAttribute("aria-invalid", String(Boolean(problem)));
      return !problem;
    }

    function mailtoFor(application) {
      var lines = Object.keys(application).map(function (k) {
        return k.toUpperCase() + ": " + application[k];
      });
      return (
        "mailto:" + MAILBOX +
        "?subject=" + encodeURIComponent("Partner application — " + (application.name || "")) +
        "&body=" + encodeURIComponent(lines.join("\n"))
      );
    }

    function busy(state) {
      if (!submit) return;
      submit.disabled = state;
      submit.setAttribute("aria-busy", String(state));
      submit.textContent = state ? "Sending…" : "Send application";
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

      var application = {};
      new FormData(form).forEach(function (value, key) {
        application[key] = value;
      });

      if (fail) fail.hidden = true;
      busy(true);

      fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(application)
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          busy(false);
          if (!done) return;
          done.hidden = false;
          var head = done.querySelector(".display-m");
          if (head) {
            head.setAttribute("tabindex", "-1");
            head.focus();
          }
          done.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "center"
          });
        })
        .catch(function () {
          // Nothing was transmitted, so nothing is confirmed.
          busy(false);
          if (!fail) return;
          if (failLink) failLink.setAttribute("href", mailtoFor(application));
          fail.hidden = false;
          fail.setAttribute("tabindex", "-1");
          fail.focus();
        });
    });

    // Clear an error as soon as the stylist fixes it.
    form.addEventListener("input", function (e) {
      var field = e.target.closest(".field") || e.target.closest(".form-consent");
      if (field && field.getAttribute("data-invalid") === "true") validate(e.target);
    });

    form.addEventListener("change", function (e) {
      if (e.target.type === "checkbox" || e.target.tagName === "SELECT") {
        var field = e.target.closest(".field") || e.target.closest(".form-consent");
        if (field && field.getAttribute("data-invalid") === "true") validate(e.target);
      }
    });
  }

  /* ------------------------------------------------------------------------
     Scroll reveal
     ------------------------------------------------------------------------ */
  function initReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!items.length) return;

    if (reduceMotion || !("IntersectionObserver" in window)) {
      Array.prototype.forEach.call(items, function (el) {
        el.setAttribute("data-shown", "true");
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-shown", "true");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );

    Array.prototype.forEach.call(items, function (el) {
      observer.observe(el);
    });
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  function boot() {
    initNav();
    initStrandField();
    initShadeRing();
    initFolds();
    initApplication();
    initReveal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
