# Purple Hair Extensions

Marketing and partner-signup website for **Purple Hair Extensions** — a luxury, fully
customizable hair extension solution (mesh integration and wefts) offered exclusively
to salons and independent stylists.

## Stack

Plain static HTML / CSS / JavaScript — no build step required.

- `index.html` — single-page site: hero, methods, benefits, process, partner application form
- `styles.css` — styling (Cormorant Garamond + Inter, purple/gold luxury palette)
- `script.js` — mobile nav + client-side form validation and success state

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy

Deployed on [Vercel](https://vercel.com) as a static site — no build configuration needed.

## Form submissions

The partner application form currently validates client-side and shows a success
state only. To capture real submissions, point the submit handler in `script.js`
at a form backend (Formspree, a Vercel serverless function, or a CRM webhook).
