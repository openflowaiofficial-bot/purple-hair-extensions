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
    var scene = document.querySelector(".strand-scene");
    if (!scene) return;

    var planes = {
      back: scene.querySelector('[data-depth="back"]'),
      mid: scene.querySelector('[data-depth="mid"]'),
      near: scene.querySelector('[data-depth="near"]')
    };
    if (!planes.mid) return;

    /* Measuring the hero means the measurement has to be repeated when the
       hero changes size, or the box is stale and `slice` crops after all.
       It changes on rotation, and it used to change when the webfonts landed
       and reflowed the headline. That second one was destroying the reveal:
       build(true) drew and animated, document.fonts.ready then fired a rebuild
       ~300ms in, the height churn cleared the 2% tolerance, and all 54 paths
       were removed and recreated with no animation. The one entrance animation
       on the homepage never finished on a cold load — it snapped.

       Two changes. The animated build is now GATED on the fonts rather than
       racing them (with a 400ms escape hatch, so a slow or blocked font never
       costs the field). And the churn test is WIDTH ONLY: `slice` crops
       horizontally, so width is the thing that must stay honest, and height
       churn was the trigger that was throwing the redraw away. */
    var built = { w: 0 };

    function build(animate) {
      var box = scene.getBoundingClientRect();
      var w = box.width > 200 ? Math.round(box.width) : 1200;
      var h = box.height > 200 ? Math.round(box.height) : 700;
      if (Math.abs(w - built.w) < w * 0.02) return;
      built = { w: w };
      drawStrandField(planes, w, h, animate);
    }

    var ready =
      document.fonts && document.fonts.ready
        ? Promise.race([
            document.fonts.ready,
            new Promise(function (r) {
              setTimeout(r, 400);
            })
          ])
        : Promise.resolve();

    ready.then(function () {
      build(true);
    });

    var t;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        build(false);
      }, 180);
    });
  }

  var SVG_NS = "http://www.w3.org/2000/svg";

  /* Two stroke gradients per plane, solid at the root and transparent at the
     tip, so no filament stops dead mid-hero. The ids are suffixed per plane
     because three sibling SVGs sharing one id is a duplicate-id document. */
  function strandDefs(svg, suffix) {
    var defs = document.createElementNS(SVG_NS, "defs");
    [
      ["strand-fade-" + suffix, "#a578be"],
      ["strand-fade-accent-" + suffix, "#e3cfa6"]
    ].forEach(function (pair) {
      var g = document.createElementNS(SVG_NS, "linearGradient");
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
        var stop = document.createElementNS(SVG_NS, "stop");
        stop.setAttribute("offset", s[0]);
        stop.setAttribute("stop-color", s[1]);
        stop.setAttribute("stop-opacity", s[2]);
        g.appendChild(stop);
      });
      defs.appendChild(g);
    });
    svg.appendChild(defs);
  }

  /* The viewBox is the hero's own pixel box rather than a hard-coded 1200x700.
     Under `slice`, that fixed box scaled a 390-wide, ~1900-tall mobile hero by
     2.1x and cropped to the middle fifth of its width, so the fanning
     filaments became about ten near-vertical pinstripes running straight
     through the lede and both CTA buttons. Matching the box to the element
     leaves `slice` nothing to slice at any width.

     THE SPLIT: the total filament budget does NOT grow. The same 54 strands
     the flat curtain drew are dealt across three planes — 22 back, 24 mid, 8
     near — so the headline sits inside a volume instead of on top of a
     texture, at exactly the same drawing cost. The accents go to `near`
     (a brighter strand is a nearer strand), and the rest are dealt by
     edgeBias, so the fan's outer strands sit forward and the centre recedes
     into the blurred back plane, which is where the headline is.

     THE PHONE. The lateral drift is a fraction of WIDTH, so at 390px the whole
     fan was ±78px across a hero over 1100px tall: the filaments were parallel
     vertical lines running at full contrast straight through the lede, the
     gold APPLY button and the outline CTA. The viewBox fix stopped the CROP,
     not the geometry. Under 861px the field is now a CROWN BAND — short
     filaments in the top fifth, fanning at nearly twice the relative angle
     because they have a fifth of the fall to do it in — and the stylesheet
     fades it out with a mask before it can reach a word of copy. */
  function drawStrandField(planes, W, H, animate) {
    var mobile = W < 860;
    var COUNT = mobile ? 26 : 54;

    // Root spread across the crown, lateral drift over the fall, and the two
    // ends of the length range — all four change gear on a phone.
    var ROOT = mobile ? 0.3 : 0.29;
    var DRIFT = mobile ? 0.34 : 0.2;
    var LEN0 = mobile ? 0.06 : 0.45;
    var LEN1 = mobile ? 0.16 : 0.55;
    var SWAY = mobile ? 9 : 26;

    // Under 861px: one plane, the original code path verbatim, no 3D at all.
    var LAYERS = mobile
      ? [{ key: "mid", sw: 1, quota: COUNT }]
      : [
          { key: "back", sw: 0.7, quota: 22 },
          { key: "mid", sw: 1, quota: 24 },
          { key: "near", sw: 1.25, quota: 8 }
        ];

    Object.keys(planes).forEach(function (k) {
      if (!planes[k]) return;
      planes[k].textContent = "";
      planes[k].setAttribute("viewBox", "0 0 " + W + " " + H);
      planes[k].setAttribute("preserveAspectRatio", "xMidYMin slice");
    });

    // Describe every filament first, then deal them out.
    var strands = [];
    for (var i = 0; i < COUNT; i++) {
      var t = i / (COUNT - 1);
      var spread = (t - 0.5) * 2; // -1 .. 1

      // The parting: roots sit across the crown, not at a single point — pull
      // them any tighter and the filaments stop falling and start radiating.
      var rootX = W * 0.5 + spread * W * ROOT + (rand(i) - 0.5) * 26;
      // The fall: a gentle outward drift, so the field fans without splaying.
      var endX = rootX + spread * W * DRIFT + (rand(i + 90) - 0.5) * (mobile ? 22 : 46);

      // Each filament terminates at its own depth, so the field has a hem.
      var length = H * (LEN0 + rand(i + 31) * LEN1);
      var sway = (Math.sin(i * 1.37) + Math.cos(i * 0.61)) * SWAY;

      strands.push({
        i: i,
        d:
          "M " + rootX.toFixed(1) + " -8 " +
          "C " + (rootX + sway * 0.5).toFixed(1) + " " + (length * 0.38).toFixed(1) +
          ", " + (endX - sway * 0.7).toFixed(1) + " " + (length * 0.72).toFixed(1) +
          ", " + endX.toFixed(1) + " " + length.toFixed(1),
        length: length,
        // A few brighter filaments read as the highlighted strands in a blend.
        accent: i % 7 === 3,
        // The centre is lightened by lowering opacity, not by emptying it out.
        edge: Math.pow(Math.abs(spread), 0.8)
      });
    }

    var pool;
    if (mobile) {
      pool = { mid: strands };
    } else {
      // The eight accents are exactly the near plane's quota.
      var accents = strands.filter(function (s) { return s.accent; });
      var rest = strands
        .filter(function (s) { return !s.accent; })
        .sort(function (a, b) { return a.edge - b.edge; });
      pool = {
        back: rest.slice(0, 22),
        mid: rest.slice(22),
        near: accents
      };
    }

    LAYERS.forEach(function (layer) {
      var svg = planes[layer.key];
      var list = pool[layer.key];
      if (!svg || !list) return;

      strandDefs(svg, layer.key);
      var frag = document.createDocumentFragment();

      list.forEach(function (s) {
        var path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", s.d);
        path.setAttribute(
          "stroke",
          "url(#" + (s.accent ? "strand-fade-accent-" : "strand-fade-") + layer.key + ")"
        );
        /* User units are CSS pixels (the viewBox matches the box 1:1). The
           per-plane multiplier is the weight half of the depth ramp: thinner
           far, heavier near. */
        path.setAttribute(
          "stroke-width",
          ((s.accent ? 1.45 : 1.05) * layer.sw).toFixed(2)
        );
        /* A NARROWER ramp than the flat curtain used. That one ran 0.22..0.68
           because one plane had to carry the whole depth read by itself; now
           the plane's own opacity carries it, and leaving the old ramp in
           multiplied the two together — centre strands landed at 0.075 and
           the middle of the hero emptied out. This ramp is in-plane variety
           only, and the depth is authored per layer. */
        path.setAttribute("opacity", (0.42 + s.edge * 0.3).toFixed(2));

        if (animate && !reduceMotion) {
          path.style.strokeDasharray = s.length + 60;
          path.style.strokeDashoffset = s.length + 60;
          path.style.animation =
            "strand-draw 1.6s " + EASE + " " +
            (0.05 + rand(s.i + 7) * 0.6).toFixed(2) + "s forwards";
        }

        frag.appendChild(path);
      });

      svg.appendChild(frag);
    });
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
    /* TWO ADJACENT BLADES USED TO BE ONE SHADE DRAWN TWICE. 60 Ivory was
       #ddc9a8 (221,201,168) and 613 Vanilla #e0cfa2 (224,207,162) — under
       deltaE 3, in the brightest and most-looked-at part of the arc, on a
       control whose only job is letting a colorist tell shades apart.
       Both moved, and both moved toward the note already written for them:
       60 is "palest COOL blonde", so it loses its yellow and gains a grey
       body; 613 is "bright BUTTERY", so it goes properly buttery. They now
       sit about 22 deltaE apart and read as two rungs of the ladder. */
    { code: "60", name: "Ivory", family: "Blonde", hex: "#d7cab6",
      note: "Palest cool blonde we tone to. Toned in-house, never bleached on arrival." },
    { code: "613", name: "Vanilla", family: "Blonde", hex: "#ece0b0",
      note: "Bright buttery blonde. Takes a toner beautifully if you want to cool it down." },
    { code: "4/18", name: "Shadowed Champagne", family: "Rooted", hex: "#432c22",
      tip: "#c2a075", note: "Level 4 root melting into champagne. Grows out for months without a line." },
    { code: "2/60", name: "Midnight Ivory", family: "Rooted", hex: "#2a1d19",
      /* Tip tracks 60 Ivory. A rooted shade is named for the two stock shades
         it melts, so its tip must BE that shade — when 60 moved, this moved. */
      tip: "#d7cab6", note: "High-contrast rooted blonde. Built for clients who want the grow-out visible." },
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

  /* Perceived lightness of a pigment, 0..1. The lighting gradient's SHADOW
     terms are scaled by this, because a level-1 black cannot carry the same
     shading a level-18 blonde can: at the arc extremes the old constant
     rgba(0,0,0,0.32) crushed 1B Raven, 2 Espresso and 4 Chestnut into one
     undifferentiated black mass separated only by their hairline. A swatch
     ring whose darkest four shades cannot be told apart has failed at the one
     job it has. */
  function shadeDepth(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return 0.25 + 0.75 * l;
  }

  function initShadeRing() {
    var ring = document.querySelector(".ring");
    if (!ring) return;

    var chipRow = document.querySelector(".ring-chips");
    var outName = document.querySelector(".ring-readout-name");
    var outFamily = document.querySelector(".ring-readout-family");
    var outNote = document.querySelector(".ring-readout-note");
    /* DISPLAY IS NOT ANNOUNCEMENT. .ring-readout used to be the live region,
       and paint() writes it — so one pointer sweep across fourteen blades
       queued fourteen announcements at a screen-reader user driving a
       magnifier with a mouse, ending on a shade that was not the selected one.
       The visible readout is now silent and only select(), the commit path,
       writes this. */
    var announce = document.querySelector(".ring-live");

    /* 116° total: the extreme blades sit at 58° from vertical, so the fan
       still reads as a ring, every tip clears the hub, and the arc stays
       inside the stage at every width.

       This number is the ONLY place the span is set. It used to say "CSS
       scales this down again on small screens", which was a reference to
       --span-scale — a multiplier declared as 1 in both of the two places it
       existed, applied to four .blade transforms and to --lit, while --face0,
       --sx and --sy were computed here from the UNSCALED angle. Pull that
       lever and the geometry rotated while the light stayed put. It is gone,
       and so is the claim: if the fan ever does need to narrow, it narrows
       HERE, where one number drives geometry and light together. */
    var SPAN = 116;
    var GAP = 0.9; // extra steps of air before the specials
    var units = SHADES.length - 1 + GAP;
    var step = SPAN / units;
    var blades = [];
    var chips = [];
    var current = 6; // opens on Champagne — the shade that moves most

    function angleFor(i) {
      return -SPAN / 2 + (i + (i >= TAIL_AT ? GAP : 0)) * step;
    }

    function paint(i) {
      var shade = SHADES[i];
      if (outName) outName.textContent = shade.name;
      if (outFamily) outFamily.textContent = shade.family + " — no. " + shade.code;
      if (outNote) outNote.textContent = shade.note;
    }

    /* One selection, not fourteen independent toggles — so this is a radio
       group with a roving tabindex: one tab stop, arrows move the choice. */
    function select(i, moveFocus) {
      current = i;
      /* One commit path drives BOTH representations. The fan and the touch
         chips are two views of one selection, never two states — so there is no
         way for the picture and the control to disagree, and no second
         roving-tabindex implementation to keep correct. */
      blades.forEach(function (b, n) {
        var on = n === i;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      chips.forEach(function (c, n) {
        var on = n === i;
        c.setAttribute("aria-checked", String(on));
        c.tabIndex = on ? 0 : -1;
      });
      paint(i);
      if (announce) {
        announce.textContent =
          SHADES[i].name + ", " + SHADES[i].family + ", no. " + SHADES[i].code +
          ". " + SHADES[i].note;
      }
      /* moveFocus names WHICH view keeps focus, because both are real controls
         and the answer differs: arrow keys inside the fan must leave focus in
         the fan, arrow keys inside the chip row must leave it in the chip row.
         Falsy means the user committed by pointer and focus should not move at
         all. */
      if (moveFocus === "chip" && chips[i]) chips[i].focus();
      else if (moveFocus) blades[i].focus();
    }

    SHADES.forEach(function (shade, i) {
      var blade = document.createElement("button");
      blade.type = "button";
      blade.className = "blade";
      blade.setAttribute("role", "radio");
      blade.setAttribute("aria-checked", "false");
      blade.tabIndex = -1;
      blade.style.setProperty("--a", angleFor(i).toFixed(2) + "deg");
      // Stack index: the blade's position on the rivet, in true Z.
      blade.style.setProperty("--i", i);

      /* --pigment must ALWAYS be an <image>. A background-color is only legal
         in the FINAL layer of the background shorthand, and CSS lays the
         lighting gradient on top of this — so a bare hex here would kill the
         whole declaration and leave fourteen transparent blades. One code path
         emits a gradient for both shade types. */
      var pig = shade.tip
        ? "linear-gradient(to top, " + shade.hex + " 38%, " + shade.tip + ")"
        : "linear-gradient(" + shade.hex + ", " + shade.hex + ")";
      blade.style.setProperty("--pigment", pig);

      /* ONE SCREEN-FIXED LAMP, FOURTEEN ROTATED FRAMES.
         --face0 is the facing term: blades near the top of the arc face the
         light square-on and carry a narrow specular; blades at the extremes
         go matte. The floor of 0.35 stops the outermost blades going dead.

         JS writes --face0, never --face. An inline custom property beats any
         stylesheet rule, so writing --face here would make the hover and
         selected brightness states unreachable on all fourteen blades. CSS
         reads .blade { --face: var(--face0, 1) } and overrides --face.

         --sx/--sy are the screen-space shadow vector (6.4, 6.4) rotated into
         each blade's own local frame, so all fourteen shadows fall the same
         way ON SCREEN and the fan draws the stepped ridge a real ring has. */
      var A = angleFor(i) * Math.PI / 180;
      blade.style.setProperty(
        "--face0",
        Math.max(0.35, Math.pow(Math.cos(A * 1.15), 2.2)).toFixed(3)
      );
      /* --shade-d floors the shading a dark pigment can carry. The highlight
         terms always scaled with --face; the shadow terms were hard constants,
         so at the arc extremes blade 0 met a 9.8% white against a 32% black.
         Both ends of the lamp now scale, and the black end scales twice. */
      blade.style.setProperty("--shade-d", shadeDepth(shade.hex).toFixed(3));
      blade.style.setProperty("--sx", (Math.cos(A) * 6.4 + Math.sin(A) * 6.4).toFixed(2) + "px");
      blade.style.setProperty("--sy", (-Math.sin(A) * 6.4 + Math.cos(A) * 6.4).toFixed(2) + "px");

      /* --ex/--ey are the SAME screen-space lamp vector at unit length, rotated
         into this blade's local frame. CSS spends them on a 1px lit top edge
         and a 1px dark under-edge, which is what 1.2mm of laminate looks like
         from the side — and 1.2mm is the thickness this whole object exists to
         encode. It replaces a flat gold hairline plus a flat dark border, both
         of which were drawn on all four sides regardless of where the lamp was,
         on an object whose entire claim is that one lamp governs every surface.
         Blades near the top of the arc now catch the light on their upper edge;
         blades at the extremes catch it on their flank. */
      var ux = Math.SQRT1_2;
      blade.style.setProperty("--ex", (Math.cos(A) * ux + Math.sin(A) * ux).toFixed(3) + "px");
      blade.style.setProperty("--ey", (-Math.sin(A) * ux + Math.cos(A) * ux).toFixed(3) + "px");

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
         paint() touches the readout only. */
      blade.addEventListener("mouseenter", function () {
        paint(i);
      });

      blades.push(blade);
      ring.appendChild(blade);

      /* THE TOUCH CONTROL, built from the same shade in the same pass.
         A fanned ring overlaps by definition, so on a phone the blades are not
         merely small — an occluded blade's widest reachable run is about 18px
         and it cannot contain a 24x24 target at all. Rather than un-fanning the
         object (the overlap IS the object), the same fourteen shades also
         render as >= 44px chips below the stage. CSS shows them only below
         860px, so this costs a desktop reader nothing but the build loop.
         Same --pigment, same select(), so there is one definition of a shade
         and one definition of "selected" in the whole build. */
      if (chipRow) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "ring-chip";
        chip.setAttribute("role", "radio");
        chip.setAttribute("aria-checked", "false");
        chip.tabIndex = -1;
        chip.style.setProperty("--pigment", pig);
        chip.textContent = shade.code;
        chip.setAttribute(
          "aria-label",
          "Shade " + shade.code + ", " + shade.name + ", " + shade.family
        );
        chip.addEventListener("click", function () {
          select(i, false);
        });
        chips.push(chip);
        chipRow.appendChild(chip);
      }
    });

    /* The stack depth, so the rivet head and the front-Z lift both clear the
       top lamina without either of them hard-coding "14". */
    ring.style.setProperty("--n", SHADES.length);

    // Leaving the fan restores the shade that was actually chosen.
    ring.addEventListener("mouseleave", function () {
      paint(current);
    });

    /* One key map, both views. A radiogroup that cannot be arrowed is not a
       radiogroup, and the chip row is a real one — so the same four keys drive
       it, and `where` only decides which view keeps focus afterwards. */
    function keys(where) {
      return function (e) {
        var next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % blades.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + blades.length) % blades.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = blades.length - 1;
        if (next === null) return;
        e.preventDefault();
        select(next, where);
      };
    }

    ring.addEventListener("keydown", keys(true));
    if (chipRow) chipRow.addEventListener("keydown", keys("chip"));

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
     Plates — draw the material, once, and never move it
     ------------------------------------------------------------------------
     The eight plates were the identical 155deg gradient with different
     captions: "Hand-tied seam, 1.2mm return" sat on the same lilac rectangle
     as "Color lab, matching a client cutting". That sameness is what announced
     that nothing had been drawn, only reserved. The fix is to draw.

     THE DISCIPLINE, and it is the thing that keeps the ring the signature:
     a plate stands in for a PHOTOGRAPH, and a photograph is still. There is no
     sheen pseudo, no mix-blend-mode, no scroll-driven anything, no travelling
     highlight, no requestAnimationFrame and no will-change in this module.
     The resting sheen is baked into the alpha at draw time, positioned by the
     same declared lamp every raised surface on the site obeys. The only moving
     light on this site is the one the ring implies, and it does not move
     either.

     No markup is required, so the no-JS state is literally today's CSS: the
     canvas is never inserted and the existing .plate gradient renders exactly
     as it does now, bone variant included. Reduced motion is unaffected — a
     still image is not motion, so it still draws.
     ------------------------------------------------------------------------ */
  var PLATE_LAYERS = [
    { t: 0, alpha: 0.5, width: 0.5, blur: "blur(2.6px)" },
    { t: 0.55, alpha: 0.62, width: 0.8, blur: "blur(1.1px)" },
    { t: 1, alpha: 0.78, width: 1.15, blur: "none" }
  ];

  /* THE FILAMENTS ARE HAIR. THE GROUND STAYS HOUSE.
     Every one of the eight plates used to be drawn in violet ink: dark ran
     [36,21,46] to [143,110,166] and bone ran [203,189,214] to [132,110,152],
     sampling out at srgb(57,39,67) and srgb(172,156,183). These plates stand in
     for the entire photographic set of a house whose whole credibility is
     colour accuracy, on the same site as a shade ring carrying fourteen correct
     hair pigments — and index.html's plate captioned "COLOR LAB, MATCHING A
     CLIENT CUTTING AGAINST STOCK" was a lilac panel saying the stock is lilac.
     On a dark section you could read it as brunette under a violet lamp. On the
     bone sections there is no violet lamp to blame.

     The ink is now keyed to the SHADES ladder itself, so the drawn hair and the
     swatched hair are the same catalogue:
       dark  back  = 2 Espresso  #2a1d19   front = 8 Amber-ish   (the mass lifts
                                                                  out of shadow)
       bone  front = 4 Chestnut into 6 Cognac
     Only bone's BACK layer stays violet-tinted: it is atmospheric haze on a
     pale violet ground, and haze takes the colour of the air, not of the hair.

     The .plate CSS ground gradient (styles.css) is untouched and still violet,
     which is the whole trade: the panel still belongs to the page, and the
     thing drawn on it is finally hair. */
  var PLATE_INK = {
    dark: {
      back: [42, 29, 25],
      front: [122, 92, 58],
      accent: [227, 207, 166],
      accentA: 0.62,
      /* Contrast trim. The dark plates were already right; the bone ones ran
         at roughly three times their value range, which is what made them
         read as a scratchy pencil test rather than as material. */
      alpha: 1,
      seamLit: "rgba(226, 205, 160, 0.72)",
      seamDark: "rgba(26, 16, 8, 0.72)",
      seamShadow: "rgba(0, 0, 0, 0.42)",
      tick: "rgba(227, 207, 166, 0.44)",
      /* A lace base is a fine polymer net dyed to the hair it carries, so it
         is beige — never lilac. It used to be [176,150,198]. */
      mesh: [186, 163, 132],
      meshShadow: "rgba(0, 0, 0, 0.46)",
      knot: [240, 228, 206]
    },
    /* Bone plates get --gold-deep for the accent, not --gold-soft: pale gold
       on a pale ground is not an accent, it is a smudge.

       `front` was [90, 63, 110] at up to 0.78 alpha on a #ece7f0 ground — a
       near-black on a near-white. Lighter ink at 0.55x the alpha puts the bone
       plate in the same exposure as the dark ones instead of three stops hot. */
    bone: {
      /* Haze, not hair — this one stays keyed to the air on a violet page. */
      back: [196, 182, 205],
      front: [92, 68, 46],
      accent: [122, 95, 47],
      accentA: 0.5,
      alpha: 0.55,
      seamLit: "rgba(186, 150, 92, 0.86)",
      seamDark: "rgba(58, 42, 18, 0.6)",
      seamShadow: "rgba(70, 52, 90, 0.3)",
      tick: "rgba(122, 95, 47, 0.4)",
      mesh: [124, 100, 72],
      meshShadow: "rgba(70, 52, 90, 0.34)",
      knot: [58, 42, 30]
    }
  };

  function lerpInk(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  /* A per-plate seed off the caption text. Without it all eight plates would
     draw the same field from the same deterministic rand() and we would have
     rebuilt the exact problem we are fixing. Derived from content, so it is
     stable across loads and across machines. */
  function plateSeed(plate) {
    var cap = plate.querySelector(".plate-caption");
    var s = cap ? cap.textContent.trim() : plate.className;
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 9973;
  }

  /* THE TIP, and it is the single thing that was keeping these plates at
     "drawn texture" rather than "material". Every filament used to be stroked
     at a constant lineWidth with lineCap "round" and to stop at a random blunt
     end, so at 2x — which is what a stylist on a retina laptop actually sees —
     you could count dozens of strands simply terminating in mid air, and the
     field read as wheat, reeds, or a lawn of upright sticks.

     Each filament is now stroked THROUGH a gradient along its own axis whose
     alpha falls to zero across its last third, and lineCap is "butt". There is
     no terminus left to see. One gradient object per stroke, no extra passes:
     the same 1100 strokes, tapered. */
  function taper(sctx, s, r, g, b) {
    var grad = sctx.createLinearGradient(s.x0, s.y0, s.x1, s.y1);
    var head = "rgba(" + r + "," + g + "," + b + ",";
    grad.addColorStop(0, head + "1)");
    grad.addColorStop(0.62, head + "1)");
    grad.addColorStop(0.86, head + "0.4)");
    grad.addColorStop(1, head + "0)");
    return grad;
  }

  /* A falling mass. Filaments run the height of the plate from a parting off
     the top edge, fanning outward and terminating at their own depths. */
  function hankStrand(seed, k, n, W, H) {
    var t = n > 1 ? k / (n - 1) : 0.5;
    var spread = (t - 0.5) * 2;
    var x0 = W * 0.5 + spread * W * 0.62 + (rand(seed + k) - 0.5) * W * 0.07;
    var len = H * (0.5 + rand(seed + k + 31) * 0.66);
    var x1 = x0 + spread * W * 0.26 + (rand(seed + k + 901) - 0.5) * W * 0.16;
    var sway = (Math.sin((seed + k) * 1.37) + Math.cos(k * 0.61)) * W * 0.035;
    return {
      x0: x0, y0: -H * 0.06,
      c1x: x0 + sway * 0.5, c1y: len * 0.34,
      c2x: x1 - sway * 0.7, c2y: len * 0.74,
      x1: x1, y1: len,
      mx: (x0 + x1) * 0.5, my: len * 0.55,
      // Same per-strand weight the weft curtain gets. A falling mass of
      // identical-gauge filaments is the reed-bed read, wherever it happens.
      w: 0.7 + rand(seed + k + 617) * 0.6
    };
  }

  /* A curtain hanging off a stitched return — the seam this house is known for,
     seen close. Every filament leaves a STRAIGHT HORIZONTAL LINE rather than a
     parting point, and falls in a dense near-parallel comb with a slow lateral
     drift. That is the whole difference from a hank, and it is what the three
     weft captions are describing.

     The drift used to be Math.sin(t * 4.1 + 0.8), a fixed spatial frequency
     across the plate width — which printed a visible periodic comb, about four
     repeats wide, straight across the product shot. Drift is now per-strand
     random with one non-repeating outward lean, so no interval of the curtain
     looks like any other. */
  function weftStrand(seed, k, n, W, H, yR, floor) {
    var t = n > 1 ? k / (n - 1) : 0.5;
    /* HAIR FALLS IN CLUMPS. It used to be near-parallel filaments of equal
       weight at uniform density from seam to hem, which is the drawing of a
       reed bed, on the one plate whose entire subject is material.
       Runs of 3-5 consecutive strands now share an x0 NEIGHBOURHOOD: the
       cluster index advances every few k, each cluster gets its own offset,
       and the strands inside it sit tight around it. The pitch is still even
       on average — a weft IS evenly sewn — but the FALL is clumped, which is
       what separates hair from a comb. */
    var cl = Math.floor(k / (3 + Math.floor(rand(seed + Math.floor(k / 4) * 29) * 3)));
    var clump = (rand(seed + cl * 137 + 11) - 0.5) * W * 0.035;
    var x0 = W * (-0.06 + 1.12 * t) + clump;
    /* The clump has to travel together, not merely start together. Most of the
       lateral drift is the CLUMP's — one value shared by its 3-5 strands — with
       only a small per-strand wobble on top. Sharing the origin but drifting
       independently is what produced a criss-cross of long shallow X's, which
       reads as straw; sharing the fall is what makes a lock of hair. */
    var drift = (rand(seed + cl * 311 + 7) - 0.5) * W * 0.085
      + (rand(seed + k + 305) - 0.5) * W * 0.02
      + (t - 0.5) * W * 0.05;
    /* `floor` is the layer's own length floor. The back layer used to floor at
       0.55 like the others, so the mass ended on a flat horizon at the exact
       depth it should have been dissolving. It now floors at 0.35 and the
       curtain thins downward with depth, the way a real one does. */
    var len = (H - yR) * ((floor || 0.55) + rand(seed + k + 17) * 0.62);
    var x1 = x0 + drift;
    return {
      x0: x0, y0: yR + (rand(seed + k + 71) - 0.5) * H * 0.01,
      c1x: x0 + drift * 0.16, c1y: yR + len * 0.34,
      c2x: x1 - drift * 0.1, c2y: yR + len * 0.72,
      x1: x1, y1: yR + len,
      mx: (x0 + x1) * 0.5, my: yR + len * 0.52,
      /* Per-strand weight, so a layer stops being one nib width. Hair in a
         curtain is not uniform gauge and the eye reads that before it reads
         anything else. Multiplies the layer's own width, so the three depth
         bands still separate. */
      w: 0.7 + rand(seed + k + 617) * 0.6
    };
  }

  /* THE SECOND CONSTRUCTION, AND IT IS A DIFFERENT OBJECT.
     wefts.html's heading is "Hand-tied hides. Machine-tied holds." and the two
     plates beneath it are the whole visual argument. Both used to carry
     data-plate="weft", so both ran this generator with the identical knot
     fringe and the identical seam — the ONLY difference between the two
     drawings was the seed. Side by side at 1440 they were indistinguishable,
     while their captions promised "1.2 MM RETURN, LIES FLUSH" against "CUT AND
     SEALED MID-ROW, NO SHED".

     A machine weft is genuinely a different thing to draw:
       - no knot returns, so no fringe above the seam (drawPlate sets fringe = 0
         for every mode but "weft")
       - the hair is sewn through a folded, SEALED edge: origins are uniform,
         not clumped, because a machine lays them at a fixed pitch
       - the seam is a thick solid sealed band with a second stitch line, not a
         hairline with the house's hand-tied descending ticks
       - the curtain is denser and hangs straighter — that is "holds"
     Two plates, two constructions, one generator. */
  function machineStrand(seed, k, n, W, H, yR) {
    var t = n > 1 ? k / (n - 1) : 0.5;
    // Machine pitch: even, with only a hair of jitter so it is not a ruler.
    var x0 = W * (-0.04 + 1.08 * t) + (rand(seed + k + 53) - 0.5) * W * 0.008;
    // Straighter hang. A sealed row has no knot to lean off.
    var drift = (rand(seed + k + 305) - 0.5) * W * 0.06 + (t - 0.5) * W * 0.03;
    var len = (H - yR) * (0.72 + rand(seed + k + 17) * 0.34);
    var x1 = x0 + drift;
    return {
      x0: x0, y0: yR,
      c1x: x0 + drift * 0.2, c1y: yR + len * 0.38,
      c2x: x1 - drift * 0.08, c2y: yR + len * 0.76,
      x1: x1, y1: yR + len,
      mx: (x0 + x1) * 0.5, my: yR + len * 0.52,
      w: 0.8 + rand(seed + k + 617) * 0.4
    };
  }

  /* The return itself: a short dense fringe folded back over the seam, so the
     band above the stitch line is material rather than empty ground.

     It used to run `up = yR * (0.18 + rand * 0.9)` — heights from 0.18 to 1.08
     of the band, at the same weight as the curtain below, which is a ragged
     hedge rather than a 1.2 mm hand-tied return. A real return is tight and
     near-uniform: 0.62..0.90 of the band, at half the weight of the curtain. */
  function returnStrand(seed, k, n, W, H, yR) {
    var t = n > 1 ? k / (n - 1) : 0.5;
    var x0 = W * (-0.06 + 1.12 * t);
    var up = yR * (0.72 + rand(seed + k + 41) * 0.24);
    var lean = (rand(seed + k + 13) - 0.5) * W * 0.055;
    return {
      x0: x0, y0: yR,
      c1x: x0 + lean * 0.4, c1y: yR - up * 0.5,
      c2x: x0 + lean, c2y: yR - up * 0.85,
      x1: x0 + lean * 1.15, y1: yR - up,
      mx: x0, my: yR - up * 0.5
    };
  }

  /* The ends comparison. wefts.html carries a plate captioned "Ends comparison
     — double-drawn, left; single-drawn, right" and it used to draw a stitched
     weft seam straight through the middle of it: a horizon line on a plate that
     is about hems, with no left/right split and no difference to find.

     Double-drawn means every strand runs full length root to tip: the bundle
     does not thin, and the hem is a flat cut. Single-drawn tapers: its mass
     thins from halfway down and its hem is ragged. That contrast IS the
     drawing, and it is what a stylist reads this caption looking for.

     `blunt` is the load-bearing flag. The taper that every other filament on
     this site gets is exactly the thing double-drawn hair does NOT do, so the
     left bundle is stroked flat to a hard end and the right one is tapered
     harder than usual. Drawing both the same way is what left the old plate
     with nothing to find. */
  /* TWO STRIPS OF CORDUROY was the right diagnosis and the wrong culprit. The
     filaments were not constant-WIDTH — every non-blunt strand on this site is
     stroked through an alpha gradient that falls to zero across its last third,
     and at these layer widths (0.5 / 0.8 / 1.15px) a canvas renders stroke
     width as coverage, so alpha taper and width taper are the same operation.
     What actually read as corduroy was the PITCH: x0 was a perfectly even
     t * W * 0.44 with no jitter, and the only lateral movement was a straight
     lean, so the bundle was a set of evenly spaced parallel rules.
     Fixed at the source: per-strand pitch jitter, a low-frequency sine bow
     keyed to the strand's own seed so no two neighbours bow together, and
     per-strand weight so a bundle is not one nib width. Density is unchanged —
     this is drift and weight, not more strands. */
  function endsStrand(seed, k, n, W, H, right) {
    var t = n > 1 ? k / (n - 1) : 0.5;
    var pitch = (rand(seed + k + 419) - 0.5) * W * 0.022;
    var x0 = W * (right ? 0.53 : 0.03) + t * W * 0.44 + pitch;
    var lean = (rand(seed + k + 3) - 0.5) * W * 0.05;
    // One slow wave per strand, phase-shifted by its own seed: ±3-5px of bow
    // at plate scale, never in step with its neighbour.
    var bow = Math.sin(rand(seed + k + 907) * 6.28) * W * 0.014;
    var bend = (rand(seed + k + 77) - 0.5) * W * 0.03;
    var len = right
      ? H * (0.36 + rand(seed + k + 61) * 0.58)
      : H * (0.9 + rand(seed + k + 61) * 0.035);
    return {
      x0: x0, y0: -H * 0.04,
      c1x: x0 + bend + bow, c1y: len * 0.36,
      c2x: x0 + lean * 1.2 + bend * 0.4 - bow, c2y: len * 0.74,
      x1: x0 + lean * 1.9, y1: len,
      mx: x0 + lean, my: len * 0.55,
      w: 0.7 + rand(seed + k + 617) * 0.6,
      blunt: !right
    };
  }

  /* THE MESH BASE.
     Half of what this house sells had no drawing of itself anywhere on seven
     pages. The single plate on mesh-integration.html is captioned "Mesh base,
     pre-fit — graduated tie density at the perimeter" and it drew a falling
     hair curtain: no mesh, no perimeter, no graduation, on the page dedicated
     to the product.

     One parametric surface, sampled twice. P(u, v) is a shallow dome — the
     base is FITTED to a curved scalp, not laid flat — and both axes of the
     lattice and every knot come off the same function, so the ties land
     exactly on the crossings rather than a pixel beside them. Knot density
     falls off radially from the centre, which is what "graduated tie density
     at the perimeter" means: dense where the hair has to be built, thinning
     out so the edge of the base blends instead of announcing itself.

     It rides the same three-layer blur/alpha ramp as every other plate, so it
     sits in the same family: layer 0 is the net's own cast shadow under the
     declared lamp, layer 1 is the net, layer 2 carries the knots. */
  function drawMeshLayer(sctx, W, H, seed, layer, li, ink) {
    /* Roughly square cells at any aspect ratio, and fine enough to read as
       fabric rather than as graph paper. */
    var NU = Math.max(18, Math.min(40, Math.round(W / 14)));
    var NV = Math.max(18, Math.min(46, Math.round(H / 14)));
    var bowX = W * 0.06;
    var bowY = H * 0.05;
    var SEG = 12;
    var i, j;

    /* THE LATTICE IS NOT A GRID.
       This plate is the only image on the mesh page and it was reading as
       graph paper: a perfectly regular barrel-warped lattice with isolated
       pencil-dash knots scattered over it, which is a technical diagram or a UI
       texture — not a lace base. The old jitter was ±0.7px of position, far
       under the ~14px cell, so every cell still measured the same.

       Three things break it now, and all three are properties a real hand-cut
       base has:
         - PITCH jitter of ±18%, so no two cells are the same size
         - ALPHA jitter of ±40% per line, so no two threads carry the same
           weight (a net is knotted, not printed)
         - one line in four to five DROPPED entirely, which is what an
           open-weave base actually is: the net is not solid, it is a mesh with
           an irregular open count.
       All three are deterministic off the plate seed, so the drawing is stable
       across loads and machines. */
    function jitU(u) {
      // ±18% of one cell, applied to the line's own pitch.
      return u + (rand(seed + Math.round(u * NU) * 7 + 3) - 0.5) * 0.36 / NU;
    }
    function jitV(v) {
      return v + (rand(seed + Math.round(v * NV) * 13 + 401) - 0.5) * 0.36 / NV;
    }
    // Drop roughly one line in 4.5. `keepLine` is asked with the line's own
    // index so the same lines vanish on the net, its shadow and the ties.
    function keepLine(axis, idx) {
      return rand(seed + axis * 5171 + idx * 97 + 29) > 0.22;
    }
    function lineAlpha(axis, idx) {
      return 0.6 + rand(seed + axis * 3301 + idx * 53 + 7) * 0.8;
    }

    /* One parametric surface. Both axes of the lattice AND every knot come off
       P(), so the ties land exactly on the crossings — that has to survive the
       jitter, which is why the jitter lives in the PARAMETER and not in the
       output: jitU/jitV are applied by the callers before P() sees them, so a
       tie asked for cell (i, j) lands on exactly the crossing that was drawn. */
    function P(u, v) {
      return [
        W * (0.05 + 0.9 * u) + bowX * Math.sin(Math.PI * (u - 0.5)) * Math.sin(Math.PI * v),
        H * (0.04 + 0.88 * v) + bowY * Math.cos(Math.PI * v) * Math.sin(Math.PI * u)
      ];
    }

    /* The net dissolves toward the plate edge rather than being cut off by the
       frame — a base has a perimeter, a texture has a crop. */
    function fade(u, v) {
      return Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * v), 0.42);
    }

    if (li < 2) {
      var shadow = li === 0;
      var dx = shadow ? 4 : 0;
      var dy = shadow ? 5 : 0;
      var c = ink.mesh;
      sctx.lineCap = "round";
      sctx.lineWidth = shadow ? 1.15 : 0.9;
      sctx.strokeStyle = shadow
        ? ink.meshShadow
        : "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";

      for (i = 0; i <= NU; i++) {
        if (!keepLine(0, i)) continue;
        var u = jitU(i / NU);
        sctx.globalAlpha =
          Math.min(1, layer.alpha * fade(u, 0.5) * lineAlpha(0, i)) * (shadow ? 0.75 : 1);
        sctx.beginPath();
        for (j = 0; j <= SEG; j++) {
          var pv = P(u, j / SEG);
          if (j === 0) sctx.moveTo(pv[0] + dx, pv[1] + dy);
          else sctx.lineTo(pv[0] + dx, pv[1] + dy);
        }
        sctx.stroke();
      }

      for (j = 0; j <= NV; j++) {
        if (!keepLine(1, j)) continue;
        var v = jitV(j / NV);
        sctx.globalAlpha =
          Math.min(1, layer.alpha * fade(0.5, v) * lineAlpha(1, j)) * (shadow ? 0.75 : 1);
        sctx.beginPath();
        for (i = 0; i <= SEG; i++) {
          var pu = P(i / SEG, v);
          if (i === 0) sctx.moveTo(pu[0] + dx, pu[1] + dy);
          else sctx.lineTo(pu[0] + dx, pu[1] + dy);
        }
        sctx.stroke();
      }
      return;
    }

    /* LAYER 2: HAIR PULLED THROUGH A BASE, NOT MARKS ON A GRID.
       The ties used to be isolated 3-6px dashes at a random angle sitting ON
       the crossings — pencil ticks scattered over a lattice, which is the other
       half of why this plate read as a diagram. A tie is a knot with hair
       coming out of it, and the hair is the point: each tie now knots at its
       crossing and CONTINUES 20-40px below the mesh as a short falling loop,
       tapered to nothing at its end like every other filament on the site.
       The plate then shows what the caption claims — hair pulled through a
       base, with the tie density graduating out to the perimeter. */
    var kk = ink.knot;
    var kc = "rgba(" + kk[0] + "," + kk[1] + "," + kk[2] + ",";
    sctx.lineCap = "round";
    for (i = 0; i <= NU; i++) {
      if (!keepLine(0, i)) continue;
      for (j = 0; j <= NV; j++) {
        if (!keepLine(1, j)) continue;
        var tu = jitU(i / NU);
        var tv = jitV(j / NV);
        var rx = (tu - 0.5) * 2;
        var ry = (tv - 0.48) * 2.05;
        var keep = 1 - Math.min(1, Math.sqrt(rx * rx + ry * ry) * 0.9);
        var n = seed + i * 61 + j * 7;
        if (rand(n) > keep) continue;
        var p = P(tu, tv);
        var a = layer.alpha * (0.45 + 0.55 * keep) * (0.6 + rand(n + 83) * 0.4);

        // The knot: a short thick mark across the crossing.
        sctx.lineWidth = 1.4;
        sctx.globalAlpha = Math.min(1, a);
        sctx.strokeStyle = kc + "1)";
        var ang = rand(n + 17) * Math.PI;
        var r = 1.3 + rand(n + 41) * 1.2;
        sctx.beginPath();
        sctx.moveTo(p[0] - Math.cos(ang) * r, p[1] - Math.sin(ang) * r);
        sctx.lineTo(p[0] + Math.cos(ang) * r, p[1] + Math.sin(ang) * r);
        sctx.stroke();

        /* The hair off it. Falls below the base, DRAPES, and fades out.
           A ±7px swing over a 20-40px drop rendered as near-vertical dashes in
           columns — the same "dead vertical, evenly pitched" read the ends
           plate was pulled up for. Hair leaving a knot swings much further than
           that and no two lengths match, so both ranges widen and the drape is
           carried by the control point rather than only by the end. */
        var drop = 24 + rand(n + 131) * 42;
        var swing = (rand(n + 199) - 0.5) * 34;
        var g = sctx.createLinearGradient(p[0], p[1], p[0] + swing, p[1] + drop);
        g.addColorStop(0, kc + "0.85)");
        g.addColorStop(0.55, kc + "0.5)");
        g.addColorStop(1, kc + "0)");
        sctx.lineWidth = 0.85;
        sctx.globalAlpha = Math.min(1, a * 0.9);
        sctx.strokeStyle = g;
        sctx.beginPath();
        sctx.moveTo(p[0], p[1]);
        sctx.quadraticCurveTo(
          p[0] + swing * 0.85, p[1] + drop * 0.45,
          p[0] + swing, p[1] + drop
        );
        sctx.stroke();
      }
    }
  }

  function drawPlate(plate, canvas) {
    var box = plate.getBoundingClientRect();
    var W = Math.round(box.width);
    var H = Math.round(box.height);
    if (W < 24 || H < 24) return;

    var ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) return;

    // Capped, per constraint: never above 2, and 1.5 on small screens.
    var small = window.innerWidth < 860;
    var dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));

    var bone = !!plate.closest(".on-light, .on-bone2");
    var ink = PLATE_INK[bone ? "bone" : "dark"];
    var mode = plate.getAttribute("data-plate") || "hank";
    var seed = plateSeed(plate);

    /* THE BUDGET IS PER SQUARE PIXEL, not per plate. A fixed TOTAL of 1100 ran
       a 3/2 wide plate (~201k px) 33% denser than a 4/5 tall one (~267k px),
       so the homepage plates sat close to a stop hotter than the about page's.
       Eight plates standing in for one photographic set have to read as one
       lamp and one exposure. The mobile divisor keeps the phone cap roughly
       where it was. */
    var TOTAL = Math.max(
      480,
      Math.min(1400, Math.round((W * H) / (small ? 460 : 185)))
    );
    var per = Math.round(TOTAL / PLATE_LAYERS.length);
    /* THE RETURN GETS ITS OWN BUDGET, keyed to WIDTH rather than to a share of
       the plate's total — a fold is a matter of strands per millimetre of
       seam, not a percentage of a picture. At a 34% share the front layer put
       about 125 sticks across 550px, 4.4px apart, and this sheet's own rule is
       that a texture dense enough to see individually stops reading as strand:
       it read as a lawn of upright sticks above a horizon.

       The seam also moved UP, from 30% of the plate to 17%. A 1.2mm hand-tied
       return is a narrow tight fold, not a third of the picture, and a short
       band at 2.6px pitch overlaps into solid material instead of a picket
       fence. The strands are short, so the extra count costs a fraction of
       what the same number of full-height filaments would. */
    var yR = H * 0.17;
    /* Only the HAND-TIED weft has a knot return to draw. A machine row is sewn
       through a folded sealed edge — there is nothing folded back over the
       stitch — so its fringe is zero, and that is the first of the four things
       that make the two plates on wefts.html different drawings rather than
       one drawing with two seeds. */
    var fringe = mode === "weft" ? Math.round(W / 2.6) : 0;
    // A machine row carries more hair per inch. "Highest density per row" is
    // in the copy beside it; the plate should show it.
    if (mode === "weft-machine") per = Math.round(per * 1.25);
    var half = Math.round(per / 2);

    /* Each layer is drawn sharp onto a scratch canvas and composited through
       ONE blur, rather than setting ctx.filter and paying for a separate
       filtered stroke ~370 times. Same atmospheric result, three blur
       operations instead of eleven hundred. */
    var scratch = document.createElement("canvas");
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    var sctx = scratch.getContext("2d");
    if (!sctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    PLATE_LAYERS.forEach(function (layer, li) {
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.globalAlpha = 1;
      /* "butt", not "round". A round cap is a hard full-opacity dot at the end
         of every filament, and it is what the tapered gradient exists to get
         rid of. The return fringe restores it locally — a folded return has a
         real end, a tip does not. */
      sctx.lineCap = "butt";
      sctx.lineWidth = layer.width;

      if (mode === "mesh") {
        drawMeshLayer(sctx, W, H, seed, layer, li, ink);
      } else {
        var count = per + fringe;
        for (var k = 0; k < count; k++) {
          var n = seed + li * 3607 + k;
          var s;
          var fold = false;
          if (mode === "weft") {
            if (k < fringe) {
              s = returnStrand(n, k, fringe, W, H, yR);
              fold = true;
            } else {
              /* The BACK layer's length floor drops to 0.35. It used to floor
                 at 0.55 like the front, so the deepest band ended on a flat
                 horizon at exactly the depth it should have been dissolving —
                 mass that does not fall off with depth is a wall, not a
                 curtain. */
              s = weftStrand(n, k - fringe, per, W, H, yR, li === 0 ? 0.35 : 0.55);
            }
          } else if (mode === "weft-machine") {
            s = machineStrand(n, k, per, W, H, yR);
          } else if (mode === "ends") {
            s = k < half
              ? endsStrand(n, k, half, W, H, false)
              : endsStrand(n, k - half, per - half, W, H, true);
          } else {
            s = hankStrand(n, k, per, W, H);
          }

          // Colour varies around the layer's own value, so a layer reads as a
          // depth band rather than as a single flat pass.
          var jitter = (rand(n + 211) - 0.5) * 0.34;
          var c = lerpInk(ink.back, ink.front, Math.min(1, Math.max(0, layer.t + jitter)));

          /* The resting sheen, baked in: a soft band where the declared lamp
             (upper-left) falls, at ~38% of the width and ~42% of the height.
             This is the whole reason a plate reads as curved material. */
          var sheen = Math.exp(
            -Math.pow((s.my - H * 0.42) / (H * 0.3), 2) -
              Math.pow((s.mx - W * 0.38) / (W * 0.62), 2)
          );
          var a =
            layer.alpha * ink.alpha * (0.55 + 0.45 * sheen) *
            (0.55 + rand(n + 733) * 0.55);

          var accent = k % 9 === 4;

          /* A folded return has a real end and keeps its cap; a double-drawn
             end is a cut and keeps its full weight to the last pixel; a tip
             tapers to nothing and has no cap to see. */
          var flat = fold || s.blunt;
          sctx.lineCap = fold ? "round" : "butt";
          /* s.w is the strand's OWN weight, 0.7..1.3 of its layer's. A layer
             stroked at one nib width is the single loudest tell that a field
             was drawn rather than photographed, and it is what made the weft
             curtain read as reeds of equal gauge. The layer width still sets
             the depth band; this varies inside it. */
          sctx.lineWidth = (fold ? layer.width * 0.5 : layer.width) * (s.w || 1);

          sctx.beginPath();
          sctx.moveTo(s.x0, s.y0);
          sctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x1, s.y1);

          /* Front-layer strands stroke twice: a 1px-offset contact shadow
             first, then the strand. That shadow is what makes a near filament
             sit ON the mass rather than IN it — the atmospheric-perspective
             read the whole plate depends on. It tapers with the strand, or the
             taper would leave a hard black dot where the hair has gone. */
          if (li === PLATE_LAYERS.length - 1) {
            sctx.save();
            sctx.translate(1, 0);
            sctx.strokeStyle = flat ? "rgba(0,0,0,0.35)" : taper(sctx, s, 0, 0, 0);
            sctx.globalAlpha = a * 0.35;
            sctx.stroke();
            sctx.restore();
          }

          sctx.globalAlpha = Math.min(1, accent ? a * 1.15 : a);
          if (accent) {
            var ac = ink.accent;
            sctx.strokeStyle = flat
              ? "rgba(" + ac[0] + "," + ac[1] + "," + ac[2] + "," + ink.accentA + ")"
              : taper(sctx, s, ac[0], ac[1], ac[2]);
            if (!flat) sctx.globalAlpha = Math.min(1, a * 1.15 * ink.accentA + 0.06);
          } else {
            sctx.strokeStyle = flat
              ? "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"
              : taper(sctx, s, c[0], c[1], c[2]);
          }
          sctx.stroke();
        }
      }

      /* THE SEAM. The brief names "the thickness of a weft seam" as the thing
         this site's dimension should encode, and the seam was the one element
         in the build with no thickness at all: a 1px horizontal line with 4px
         ticks, which the curtain swallowed whole. It is now a real band — a
         vertical gradient dark/lit/dark, so the stitch has a top edge, a lit
         crown and an under-edge — with its own cast shadow strip immediately
         below it and the house's descending ticks laid over the top. */
      if (mode === "weft-machine" && li === PLATE_LAYERS.length - 1) {
        /* THE SEALED ROW. A machine weft's edge is a folded band pressed and
           sewn shut — you can cut it anywhere and it will not shed, which is
           the entire claim in the caption beside this plate. So it is drawn as
           a THICK SOLID band (about 2.6x the hand-tied stitch), with a second
           parallel stitch line below it and no descending ticks at all.
           The ticks are the house's HAND-TIED mark; putting them here was half
           of why the two plates were the same picture. */
        var mb = Math.max(7, Math.round(H * 0.029));
        var mtop = yR - mb * 0.55;
        var mg = sctx.createLinearGradient(0, mtop, 0, mtop + mb);
        mg.addColorStop(0, ink.seamDark);
        mg.addColorStop(0.22, ink.seamLit);
        mg.addColorStop(0.78, ink.seamLit);
        mg.addColorStop(1, ink.seamDark);
        sctx.globalAlpha = 1;
        sctx.fillStyle = mg;
        sctx.fillRect(0, mtop, W, mb);

        // The two stitch runs through the fold: even, machine-pitched, dashed.
        sctx.lineCap = "butt";
        sctx.lineWidth = 1.2;
        sctx.strokeStyle = ink.seamDark;
        [mtop + mb * 0.3, mtop + mb * 0.72].forEach(function (sy) {
          sctx.globalAlpha = 0.8;
          for (var mx = 1; mx < W; mx += 9) {
            sctx.beginPath();
            sctx.moveTo(mx, sy);
            sctx.lineTo(mx + 5, sy);
            sctx.stroke();
          }
        });

        sctx.globalAlpha = 1;
        sctx.fillStyle = ink.seamShadow;
        sctx.fillRect(0, mtop + mb, W, 4);
      }

      if (mode === "weft" && li === PLATE_LAYERS.length - 1) {
        var band = Math.max(3, Math.round(H * 0.011));
        var top = yR - band * 0.5;
        var bg = sctx.createLinearGradient(0, top, 0, top + band);
        bg.addColorStop(0, ink.seamDark);
        bg.addColorStop(0.38, ink.seamLit);
        bg.addColorStop(0.62, ink.seamLit);
        bg.addColorStop(1, ink.seamDark);
        sctx.fillStyle = bg;
        /* Laid in short slices with their own brightness rather than as one
           fill. A stitch row catches the light unevenly along its length;
           a uniform bar across the full width reads as a ruler drawn on the
           picture, which is what a flat 1px line and a flat fill both did. */
        for (var sx = 0; sx < W; sx += 5) {
          sctx.globalAlpha = 0.6 + rand(seed + sx * 3.1) * 0.4;
          sctx.fillRect(sx, top, 5.4, band);
        }

        sctx.globalAlpha = 1;
        sctx.fillStyle = ink.seamShadow;
        sctx.fillRect(0, top + band, W, 3);

        /* The house seam: a hairline with descending ticks, the same mark the
           .seam divider draws in CSS, at material scale. Spacing and rake are
           jittered — evenly pitched identical ticks read as machine serration,
           and this seam is the hand-tied one. */
        sctx.lineCap = "butt";
        sctx.lineWidth = 1.1;
        sctx.strokeStyle = ink.tick;
        var x = 2;
        var ti = 0;
        while (x < W) {
          var tj = rand(seed + ti * 7 + 13);
          sctx.globalAlpha = 0.55 + tj * 0.45;
          sctx.beginPath();
          sctx.moveTo(x, top + band + 2);
          sctx.lineTo(x + 1.6 + tj * 1.6, top + band + 6 + tj * 5);
          sctx.stroke();
          x += 7.5 + rand(seed + ti * 11 + 5) * 4;
          ti++;
        }
        sctx.globalAlpha = 1;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      // Where ctx.filter is unsupported this is a no-op and the layer lands
      // sharp — a flatter plate, still a drawn one.
      ctx.filter = layer.blur;
      ctx.drawImage(scratch, 0, 0);
      ctx.filter = "none";
    });

    /* The stylesheet keys off this to drop the CSS pinstripe once a canvas has
       actually drawn. Until then the stripe is the no-JS state and stays. */
    plate.setAttribute("data-plate-w", String(W));
  }

  function initPlates() {
    var plates = document.querySelectorAll(".plate");
    if (!plates.length) return;
    // No IntersectionObserver means no canvas, which means today's gradient.
    if (!("IntersectionObserver" in window)) return;

    var drawn = [];

    /* ONE PLATE PER TASK. The draw used to run synchronously inside the
       observer callback, and index.html and wefts.html each place two plates
       side by side — so a single scroll delivered ~2900 bezier strokes plus
       four full-canvas ctx.filter blur composites in one uninterruptible block,
       at the exact moment the reader was scrolling. canvas 2D blur is
       frequently not GPU-accelerated; on a mid-range Android that is a visible
       stutter. Queueing costs nothing and caps any single task at one plate.

       Still zero requestAnimationFrame in this module. */
    var queue = [];
    var draining = false;
    var idle =
      typeof window.requestIdleCallback === "function"
        ? function (fn) {
            window.requestIdleCallback(fn, { timeout: 250 });
          }
        : function (fn) {
            setTimeout(fn, 0);
          };

    function drain() {
      var rec = queue.shift();
      if (!rec) {
        draining = false;
        return;
      }
      drawPlate(rec.plate, rec.canvas);
      drawn.push(rec);
      idle(drain);
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var plate = entry.target;
          io.unobserve(plate);

          var canvas = document.createElement("canvas");
          canvas.className = "plate-render";
          canvas.setAttribute("aria-hidden", "true");
          // First child: .plate-caption carries z-index:2 and stays above it.
          plate.insertBefore(canvas, plate.firstChild);
          queue.push({ plate: plate, canvas: canvas });
        });
        if (!draining && queue.length) {
          draining = true;
          idle(drain);
        }
      },
      { rootMargin: "200px 0px" }
    );

    Array.prototype.forEach.call(plates, function (plate) {
      // If real photography ever lands in a plate, leave it alone.
      if (plate.querySelector(".plate-img")) return;
      io.observe(plate);
    });

    /* Redraw on resize only, debounced, and only when the width has actually
       moved by more than 40px — so a mobile URL bar collapsing, or a scrollbar
       appearing, never costs eight canvas redraws. */
    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        drawn.forEach(function (rec) {
          var was = parseFloat(rec.plate.getAttribute("data-plate-w")) || 0;
          if (Math.abs(rec.plate.getBoundingClientRect().width - was) > 40) {
            drawPlate(rec.plate, rec.canvas);
          }
        });
      }, 200);
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
    initPlates();
    initReveal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
