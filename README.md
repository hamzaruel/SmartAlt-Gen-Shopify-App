# 🖼️ SmartAltGen — Shopify Alt Text Generator

A Shopify embedded app that scans every image in a store and generates **WCAG-compliant alt text** (max 120 characters), then writes it back to the store with one click. Merchants choose between fast template-based alt text or AI vision that actually "sees" each image.

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![React](https://img.shields.io/badge/React-18-blue)
![TailwindCSS](https://img.shields.io/badge/Tailwind-3-38bdf8)
![Shopify](https://img.shields.io/badge/Shopify-Embedded%20App-95BF47)

---

## 📖 Overview

**SmartAltGen** helps Shopify merchants make their store accessible by giving every image a meaningful, screen-reader-friendly description. It scans images across the whole store, flags the ones missing or with weak alt text, generates fresh alt text, and embeds it back into Shopify — all from inside the Shopify admin.

### Why it matters
- ♿ **Accessibility (WCAG)** — every image needs descriptive alt text for screen readers
- 🔎 **SEO** — search engines use alt text to understand images
- ⚖️ **Compliance** — accessibility is increasingly a legal requirement for online stores

---

## ✨ Features

- **Whole-store scan** across 4 image sources:
  - Product gallery images
  - Files library images
  - Blog article featured images
  - Collection cover images
- **Two generation modes:**
  - **Template** — instant, free. Builds alt text from product title / type / vendor (e.g. `[product_title]-[product_type]`)
  - **AI Vision** — describes the actual image content
- **AI with custom context** — feed product title/type/vendor + special instructions to the AI
- **Clear alt text** — bulk-remove alt text where needed
- **Smart status detection** — flags images as Missing, Needs Improvement, or Optimized
- **One-click embed** — writes alt text straight back into Shopify
- **Preview before applying** — paginated view of every matching image with thumbnail, owner, current alt, and quick links to Shopify Admin / storefront
- **WCAG-clean output** — alt text is sanitized (no quotes/symbols, ≤120 chars on word boundaries)

---

## 🛠️ Tech Stack

- **[Next.js 14](https://nextjs.org/)** (App Router) + **React 18**
- **[Tailwind CSS](https://tailwindcss.com/)** + **[shadcn/ui](https://ui.shadcn.com/)** + **[Lucide](https://lucide.dev/)** icons
- **[Shopify App Bridge](https://shopify.dev/docs/api/app-bridge)** (embedded admin app)
- **Shopify Admin GraphQL API** (2025-01)
- **[Turso](https://turso.tech/)** (libSQL) — stores only shop access tokens
- **AI Vision** for image descriptions

---

## 🔐 How auth works

SmartAltGen uses Shopify **OAuth token exchange** (managed install). On each API call the client sends an App Bridge session token; the server exchanges it for a short-lived **online access token** and caches it in Turso. Turso stores **only** the shop + token — no image data is persisted; images are fetched live from Shopify on every scan.

---

## 📁 Project Structure

```
a11y-gen-copy/
├── app/
│   ├── (app)/
│   │   ├── dashboard/page.jsx   # hero + scan + store coverage overview
│   │   ├── images/page.jsx      # image list with status badges
│   │   ├── generate/page.jsx    # type selector → preview → edit → generate → embed
│   │   └── layout.jsx           # embedded app nav
│   ├── api/
│   │   ├── scan/route.js        # live-scans all 4 image sources
│   │   ├── generate/route.js    # AI generation (template runs client-side)
│   │   ├── apply/route.js       # embeds / clears alt text in Shopify
│   │   └── auth/, webhooks/      # OAuth + GDPR/uninstall webhooks
│   └── layout.js
├── lib/
│   ├── shopifyAdmin.js          # GraphQL: getAllImages() + embedAlts()
│   ├── tokenExchange.js         # OAuth token exchange
│   ├── serverAuth.js            # per-request token resolution
│   ├── altText.js               # AI alt-text generation
│   ├── sanitizeAlt.js           # WCAG-clean sanitizer (shared)
│   ├── classify.js              # missing / needs-improvement / optimized
│   └── db.js                    # Turso (token-only)
└── components/ui/               # shadcn/ui components
```

---

## 📦 Setup

### Prerequisites
- Node.js 18+
- A Shopify Partner account + development store
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)

### 1. Install dependencies
```bash
npm install
```

### 2. Environment variables
Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | App credentials from your Partner dashboard |
| `NEXT_PUBLIC_SHOPIFY_API_KEY` | Same as `SHOPIFY_API_KEY` (client-side App Bridge) |
| `SHOPIFY_SCOPES` | `read_products,write_products,read_files,write_files,read_content,write_content` |
| `SHOPIFY_HOST` / `APP_BASE_URL` / `NEXT_PUBLIC_APP_URL` | App URLs |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Turso libSQL credentials (token storage) |
| `GEMINI_API_KEY` | Optional — AI mode key. Template mode works without it |

> ⚠️ Never commit `.env`. The repo only ships `.env.example`.

### 3. Run locally
```bash
shopify app config link    # link to your Partner app (first time)
shopify app dev --use-localhost
```
Then open the app from your development store's admin.

### 4. Production build
```bash
npm run build && npm start
```

---

## 🎯 How merchants use it

1. **Scan** — open the dashboard and scan the store
2. **Choose** — pick an image type (products / collections / blog / files)
3. **Generate** — pick template or AI, then generate alt text
4. **Embed** — click "Embed all" to write the alt text back into Shopify

---

## 🐛 Troubleshooting

**Dev cache corruption** — after many hot-reloads Next.js can throw `Cannot find module './NNN.js'`:
```bash
rm -rf .next
shopify app dev --use-localhost
```

**Scope errors on files/articles/collections** — after changing `SHOPIFY_SCOPES`, restart `shopify app dev` and re-open the app so the merchant re-grants permissions.

---

## 🔮 Roadmap

- [ ] Shopify Billing (paid plan)
- [ ] Per-image manual editing
- [ ] Background auto-detection via webhooks (products create/update)
- [ ] Feed product description / variant data to the AI

---

## 📄 License

Private project. All rights reserved.
