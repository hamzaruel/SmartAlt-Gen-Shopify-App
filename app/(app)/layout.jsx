'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Custom Tailwind/shadcn shell. Navigation uses App Bridge's <s-app-nav> + <s-link>
// (rendered into the Shopify admin left nav when embedded). shop/host are kept on
// every link so the pages — which read them from the query — keep working.
export default function AppLayout({ children }) {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');
  const host = searchParams.get('host');
  const qs = `?shop=${encodeURIComponent(shop || '')}&host=${encodeURIComponent(host || '')}`;

  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    if (!shop) {
      setIsCheckingAuth(false);
      return;
    }
    fetch(`/api/check-auth?shop=${shop}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.authorized) {
          console.log('🔐 Not authorized → redirecting to OAuth');
          window.open(`/api/auth?shop=${shop}`, '_top');
          return;
        }
        console.log('✅ Authorized');
        setIsCheckingAuth(false);
      })
      .catch(() => setIsCheckingAuth(false));
  }, [shop]);

  if (isCheckingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Authorizing app…
      </div>
    );
  }

  return (
    <>
      <s-app-nav>
        <s-link href={`/dashboard${qs}`} rel="home">
          Overview
        </s-link>
        <s-link href={`/images${qs}`}>Image audit</s-link>
        <s-link href={`/generate${qs}`}>Alt text studio</s-link>
        <s-link href={`/settings${qs}`}>Preferences</s-link>
        <s-link href={`/help${qs}`}>Help center</s-link>
      </s-app-nav>

      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">{children}</div>
      </main>
    </>
  );
}
