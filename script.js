// Mobile nav toggle
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");

navToggle.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});

navLinks.addEventListener("click", (e) => {
  if (e.target.tagName === "A") {
    navLinks.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  }
});

// Partner application form
const form = document.getElementById("partner-form");
const successPanel = document.getElementById("form-success");

form.addEventListener("submit", (e) => {
  e.preventDefault();

  let valid = true;
  form.querySelectorAll("[required]").forEach((field) => {
    const empty = !field.value.trim();
    const badEmail =
      field.type === "email" && field.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value);
    field.classList.toggle("invalid", empty || badEmail);
    if (empty || badEmail) valid = false;
  });

  if (!valid) return;

  // No backend is wired up yet — swap this for a POST to your form
  // endpoint (e.g. Formspree, Vercel serverless function, or CRM webhook).
  console.log("Partner application:", Object.fromEntries(new FormData(form)));

  successPanel.hidden = false;
  successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
});

form.addEventListener("input", (e) => {
  if (e.target.classList.contains("invalid") && e.target.value.trim()) {
    e.target.classList.remove("invalid");
  }
});
