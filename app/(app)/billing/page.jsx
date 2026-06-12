'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, Loader2, Sparkles, Zap } from 'lucide-react';
import { PLANS } from '@/lib/billing/plans';
import { authHeaders } from '@/lib/sessionToken';
import { BASE_PATH } from '@/lib/basePath';

const ORDER = ['free', 'starter', 'growth', 'compliance'];

function priceLabel(p) {
  return p.price === 0 ? 'Free' : `$${p.price.toFixed(2)}`;
}

function quotaLabel(p) {
  if (p.id === 'free') return '5 AI images to try + title-based';
  if (!p.ai) return 'Title-based alt text';
  const base = `${p.quota.toLocaleString()} AI images / mo`;
  if (p.overflow) return `${base}, then $${p.overflow.blockPrice}/${(p.overflow.blockSize / 1000)}k`;
  return base;
}

export default function BillingPage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');

  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!shop) return;
    fetch(`${BASE_PATH}/api/billing/status?shop=${encodeURIComponent(shop)}`)
      .then((r) => r.json())
      .then((d) => !d.error && setStatus(d))
      .catch(() => {});
  }, [shop]);

  async function subscribe(planId) {
    setBusy(planId);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/billing/subscribe?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();
      if (data.confirmationUrl) {
        // Shopify's approval screen must open in the TOP window, not the iframe.
        if (window.top) window.top.location.href = data.confirmationUrl;
        else window.location.href = data.confirmationUrl;
        return;
      }
      setError(data.error || 'Could not start checkout.');
    } catch {
      setError('Could not start checkout.');
    } finally {
      setBusy(null);
    }
  }

  const currentPlan = status?.plan || 'free';
  const used = status?.used || 0;
  const quota = status?.quota || 0;
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Plans &amp; billing</h1>
        <p className="mt-1 text-sm text-slate-600">
          Free gives you title-based alt text for product images. Upgrade for AI-written, WCAG-compliant alt text.
        </p>
      </header>

      {status?.ai ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              {status.planName} · {used.toLocaleString()} of {quota.toLocaleString()} AI images used this cycle
            </span>
            <span className="text-slate-500">{pct}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600" style={{ width: `${pct}%` }} />
          </div>
          {status.overflow && used > quota ? (
            <p className="mt-2 text-xs text-slate-500">
              {status.overflowBlocks} overflow block{status.overflowBlocks === 1 ? '' : 's'} billed (${(status.overflowBlocks * status.overflow.blockPrice).toFixed(2)}).
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ORDER.map((id) => {
          const p = PLANS[id];
          const isCurrent = id === currentPlan;
          const featured = id === 'growth';
          return (
            <div
              key={id}
              className={`relative flex flex-col rounded-2xl border bg-white p-5 ${
                isCurrent ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'
              }`}
            >
              {featured && !isCurrent ? (
                <span className="absolute -top-2.5 left-5 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                  Popular
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                {p.ai ? <Sparkles className="h-4 w-4 text-indigo-500" /> : <Zap className="h-4 w-4 text-slate-400" />}
                <h3 className="text-base font-semibold text-slate-900">{p.name}</h3>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-slate-900">{priceLabel(p)}</span>
                {p.price > 0 ? <span className="text-sm text-slate-500"> /mo</span> : null}
              </div>
              <p className="mt-1 text-sm text-slate-600">{quotaLabel(p)}</p>
              <p className="mt-2 flex-1 text-sm text-slate-500">{p.blurb}</p>

              <div className="mt-4">
                {isCurrent ? (
                  <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700">
                    <Check className="h-4 w-4" /> Current plan
                  </div>
                ) : id === 'free' ? (
                  <div className="inline-flex w-full items-center justify-center rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-500">
                    Included
                  </div>
                ) : (
                  <button
                    onClick={() => subscribe(id)}
                    disabled={busy !== null || !shop}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
                  >
                    {busy === id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {currentPlan === 'free' ? 'Choose plan' : 'Switch plan'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-400">
        Charges are billed through Shopify. Title-based alt text is always free and never counts toward your AI quota.
      </p>
    </div>
  );
}
