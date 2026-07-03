'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, CheckCircle2, Loader2, Sparkles, Zap, TrendingUp, Building2 } from 'lucide-react';
import { PLANS } from '@/lib/billing/plans';
import { authHeaders } from '@/lib/sessionToken';
import { BASE_PATH } from '@/lib/basePath';

const ORDER = ['free', 'starter', 'growth', 'compliance'];

function priceLabel(p) {
  return p.price === 0 ? '$0' : `$${p.price.toFixed(2)}`;
}

// Short tagline under each plan name.
const TAGLINE = {
  free: 'Get started for free',
  starter: 'For small stores',
  growth: 'For growing catalogs',
  compliance: 'For high-volume stores',
};

// Headline (AI quota) + the bullet features shown on each card.
const HEADLINE = {
  free: '5 AI image descriptions to try',
  starter: '500 AI images / month',
  growth: '10,000 AI images / month',
  compliance: '50,000 AI images / month',
};

// A distinct headline icon per tier (small -> enterprise).
const PLAN_ICON = {
  free: Sparkles,
  starter: Zap,
  growth: TrendingUp,
  compliance: Building2,
};

const FEATURES = {
  free: ['Unlimited title-based alt text', 'Bulk edit using product titles', 'Scan every image type'],
  starter: ['Unlimited title-based alt text', 'Bulk AI generation & scheduling', 'Email support'],
  growth: ['Everything in Starter', 'Priority AI generation', 'For growing catalogs'],
  compliance: ['Then $9.99 per extra 10,000', 'Everything in Growth', 'Highest volume & throughput'],
};

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
      {/* ===== Header ===== */}
      <header className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-violet-600 shadow-sm ring-1 ring-violet-100">
          <Sparkles className="h-3.5 w-3.5" /> Plans &amp; pricing
        </span>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Simple, transparent{' '}
          <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">pricing</span>
        </h1>
        <p className="mt-2.5 text-base leading-relaxed text-slate-600">
          Choose the plan that fits your catalog. Switch or cancel anytime.
        </p>
      </header>

      {/* ===== Current usage ===== */}
      {status?.ai ? (
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              <span className="font-semibold text-indigo-700">{status.planName}</span> · {used.toLocaleString()} of {quota.toLocaleString()} AI images used this cycle
            </span>
            <span className="font-semibold text-slate-500 tabular-nums">{pct}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${pct}%` }} />
          </div>
          {status.overflow && used > quota ? (
            <p className="mt-2 text-xs text-slate-500">
              {status.overflowBlocks} overflow block{status.overflowBlocks === 1 ? '' : 's'} billed (${(status.overflowBlocks * status.overflow.blockPrice).toFixed(2)}).
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mx-auto max-w-3xl rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* ===== Plan cards ===== */}
      <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4">
        {ORDER.map((id) => {
          const p = PLANS[id];
          const isCurrent = id === currentPlan;
          const featured = id === 'growth';
          return (
            <div
              key={id}
              className={`relative flex flex-col rounded-2xl bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${
                featured ? 'border-2 border-indigo-300 ring-1 ring-indigo-100' : 'border border-slate-200'
              }`}
            >
              {featured ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm">
                  Most popular
                </span>
              ) : null}

              {/* name + tagline */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{p.name}</h3>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">{TAGLINE[id]}</p>
                </div>
                {isCurrent ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 ring-1 ring-emerald-100">Current</span>
                ) : null}
              </div>

              {/* price */}
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight text-slate-900">{priceLabel(p)}</span>
                <span className="text-sm font-medium text-slate-500">/mo</span>
              </div>

              {/* headline feature */}
              {(() => { const HeadIcon = PLAN_ICON[id]; return (
              <div className="mt-5 flex items-center gap-2.5 border-t border-slate-100 pt-5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
                  <HeadIcon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-slate-900">{HEADLINE[id]}</span>
              </div>
              ); })()}

              {/* features */}
              <ul className="mt-4 flex-1 space-y-2.5">
                {FEATURES[id].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <div className="mt-6">
                {isCurrent ? (
                  <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-100">
                    <Check className="h-4 w-4" /> Current plan
                  </div>
                ) : id === 'free' ? (
                  <div className="inline-flex w-full items-center justify-center rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-500 ring-1 ring-inset ring-slate-100">
                    Included free
                  </div>
                ) : (
                  <button
                    onClick={() => subscribe(id)}
                    disabled={busy !== null || !shop}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-60 ${
                      featured
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 hover:shadow-lg'
                        : 'border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'
                    }`}
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

      <p className="mx-auto max-w-2xl text-center text-sm font-medium text-slate-600">
        Payments are handled securely by Shopify. Title-based alt text stays free on every plan and never uses your AI quota.
      </p>
    </div>
  );
}
