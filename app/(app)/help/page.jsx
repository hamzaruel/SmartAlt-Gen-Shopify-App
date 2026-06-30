'use client';

import { useState } from 'react';
import { LifeBuoy, ChevronDown, Mail, Clock, ShieldCheck, HelpCircle } from 'lucide-react';

const SUPPORT_EMAIL = 'support@ecomback.com';

const FAQS = [
  {
    q: 'What does Alt Text Pro do?',
    a: 'It scans every image in your store and generates clear, SEO-friendly alt text, then saves it back to Shopify, so your images rank better in search and screen readers can describe them too.',
  },
  {
    q: 'What is alt text and why does it matter?',
    a: 'Alt text is a short written description of an image. Search engines use it to understand your visuals, so clear alt text is one of the strongest ways to improve your image SEO. It also makes your store more accessible, since screen readers read it aloud for shoppers who can’t see the image.',
  },
  {
    q: 'Which images does it scan?',
    a: 'Product gallery images, your Files library, blog post images, and collection cover images.',
  },
  {
    q: 'What’s the difference between Template and AI?',
    a: 'Template builds the alt text instantly from details you already have, like the product title, and is free to use. AI looks at the actual image and writes a natural description of what it sees.',
  },
  {
    q: 'Will this change my actual images?',
    a: 'No. Alt Text Pro only updates the alt text. Your images, files and products themselves are never modified.',
  },
  {
    q: 'Do you store my images?',
    a: 'No. Images are read live from Shopify each time you scan. We only store your store’s secure access token so the app can work, nothing else.',
  },
  {
    q: 'If I uninstall, will my alt text be removed?',
    a: 'No. Your alt text is saved directly into Shopify, so it stays on every image even after you uninstall. Uninstalling only clears the app’s own data, like your access token and usage counts. Nothing you need is removed.',
  },
  {
    q: 'How long is the generated alt text?',
    a: 'It’s kept clear and concise, with no quotes or stray symbols, the right length for search engines to use the whole description.',
  },
  {
    q: 'Can I edit the alt text before saving?',
    a: 'Yes. After generating, you can edit any alt text in the results, then click “Embed all” to save your version to Shopify.',
  },
  {
    q: 'How do I remove alt text?',
    a: 'On the Generate page, pick the image type and choose “Remove alt-text”, then confirm.',
  },
];

function FaqItem({ item, open, onToggle, delay }) {
  return (
    <div className="animate-fade-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ animationDelay: `${delay}ms` }}>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50"
      >
        <span className="text-sm font-semibold text-slate-800">{item.q}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-indigo-500 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div
        className="grid transition-all duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <p className="px-5 pb-4 text-sm leading-relaxed text-slate-600">{item.a}</p>
        </div>
      </div>
    </div>
  );
}

export default function HelpPage() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="space-y-6">
      {/* ===== Premium header ===== */}
      <header className="animate-card-in relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-violet-50 via-white to-indigo-50/60 p-6 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-52 w-52 rounded-full bg-fuchsia-200/25 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-600 shadow-sm ring-1 ring-violet-100">
            <LifeBuoy className="h-3.5 w-3.5" /> Help &amp; support
          </span>
          <div className="mt-3 flex items-center gap-3">
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-violet-500/30 ring-1 ring-inset ring-white/25">
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/20" />
              <LifeBuoy className="relative h-5 w-5" strokeWidth={1.75} />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              How can we{' '}
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">help?</span>
            </h1>
          </div>
          <p className="mt-2.5 max-w-xl text-base leading-relaxed text-slate-600">
            Find quick answers to common questions below, or reach our team anytime.
          </p>
        </div>
      </header>

      {/* ===== FAQ ===== */}
      <section className="space-y-3">
        <div className="mb-1 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
            <HelpCircle className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <h2 className="text-base font-bold tracking-tight text-slate-900">Frequently asked questions</h2>
        </div>
        {FAQS.map((item, i) => (
          <FaqItem
            key={item.q}
            item={item}
            open={openIndex === i}
            onToggle={() => setOpenIndex(openIndex === i ? -1 : i)}
            delay={i * 50}
          />
        ))}
      </section>

      {/* ===== Support ===== */}
      <section className="animate-fade-in overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-50 to-white shadow-sm">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-100">
              <Mail className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-800">Still need help?</h2>
              <p className="mt-0.5 text-sm text-slate-600">Our team is happy to help with anything about Alt Text Pro.</p>
            </div>
          </div>

          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Alt Text Pro support`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Email us at ${SUPPORT_EMAIL}`}
            className="group relative mt-5 inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40 active:translate-y-0 active:scale-[0.98]"
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
            <span className="relative flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email {SUPPORT_EMAIL}
            </span>
          </a>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200/70 pt-4 text-sm text-slate-600">
            <span className="inline-flex items-center gap-2">
              <Clock className="h-4 w-4 text-indigo-500" /> We usually reply within 24 hours
            </span>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-indigo-500" /> We never modify your products or images
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
