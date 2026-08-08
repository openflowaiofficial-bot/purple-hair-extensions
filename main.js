/* ==========================================================================
   The Purple Crown Extensions
   One script across every page. Each module exits quietly when its markup is
   absent, so the same file is safe to include everywhere.
   ========================================================================== */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  function boot() {
    initNav();
    initReveal();
    initContact();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
