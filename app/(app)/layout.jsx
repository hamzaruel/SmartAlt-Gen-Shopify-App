'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { BASE_PATH } from '@/lib/basePath';

// Custom Tailwind/shadcn shell. Navigation uses App Bridge's <s-app-nav> + <s-link>
// (rendered into the Shopify admin left nav when embedded). shop/host are kept on
// every link so the pages — which read them from the query — keep working.
export default function AppLayout({ children }) {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');
  const host = searchParams.get('host');
  const qs = `?shop=${encodeURIComponent(shop || '')}&host=${encodeURIComponent(host || '')}`;

  // Verify the shop is authorized in the BACKGROUND so the page renders instantly
  // on every navigation — no blocking "Authorizing app…" screen. We only redirect
  // to OAuth on a genuine first-run (not installed yet), and cache the result for
  // the session so we don't re-check (or flash) on each page.
  useEffect(() => {
    if (!shop) return;
    if (sessionStorage.getItem(`smartaltgen:auth:${shop}`) === '1') return;
    fetch(`${BASE_PATH}/api/check-auth?shop=${shop}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.authorized) {
          window.open(`${BASE_PATH}/api/auth?shop=${shop}`, '_top');
          return;
        }
        sessionStorage.setItem(`smartaltgen:auth:${shop}`, '1');
      })
      .catch(() => {});
  }, [shop]);

  return (
    <>
      <s-app-nav>
        <s-link href={`${BASE_PATH}/dashboard${qs}`} rel="home">
          Overview
        </s-link>
        <s-link href={`${BASE_PATH}/images${qs}`}>Image audit</s-link>
        <s-link href={`${BASE_PATH}/generate${qs}`}>Alt text studio</s-link>
        <s-link href={`${BASE_PATH}/settings${qs}`}>Preferences</s-link>
        <s-link href={`${BASE_PATH}/billing${qs}`}>Pricing plans</s-link>
        <s-link href={`${BASE_PATH}/help${qs}`}>Help center</s-link>
      </s-app-nav>

      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">{children}</div>

        {/* Footer with legal links.
            TODO: replace the empty href values below with the external
            Privacy Policy and Terms of Service page URLs once they exist. */}
        <footer className="mx-auto max-w-5xl px-4 pb-8 text-center text-sm text-slate-500">
          <a href="" target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 underline-offset-2 transition hover:text-indigo-700 hover:underline">
            Privacy Policy
          </a>
          <span className="mx-2.5 text-slate-300">·</span>
          <a href="" target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 underline-offset-2 transition hover:text-indigo-700 hover:underline">
            Terms of Service
          </a>
          <span className="mx-2.5 text-slate-300">·</span>
          <span className="font-semibold text-slate-700">Alt Text Pro</span>
        </footer>
      </main>
    </>
  );
}
