import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { runBulkEdit, isBulkActive } from '@/lib/bulkRun';

export const dynamic = 'force-dynamic';

// POST /api/bulk/start?shop=...
// Kicks off an IMMEDIATE bulk edit (scan → generate → auto-write-back) that runs
// server-side in the PM2 process, so it survives the tab closing. The page polls
// /api/bulk/status for progress.
// body: { sources:[], mode, template, scope:'missing'|'all', skipExisting, infoFields:[], instructions }
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  // Auth (also refreshes the cached token). bulkRun itself uses the offline token.
  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (isBulkActive(shop)) {
    return NextResponse.json({ status: 'running', alreadyRunning: true });
  }

  const body = await request.json().catch(() => ({}));
  const config = {
    sources: Array.isArray(body.sources) ? body.sources : [],
    mode: body.mode,
    template: body.template || '',
    scope: body.scope === 'all' ? 'all' : 'missing',
    skipExisting: !!body.skipExisting,
    infoFields: Array.isArray(body.infoFields) ? body.infoFields : [],
    instructions: (body.instructions || '').toString().slice(0, 400),
    triggeredBy: 'manual',
  };
  if (!config.mode) return NextResponse.json({ error: 'Missing edit mode' }, { status: 400 });

  // Fire-and-forget — keeps running in the long-lived process after we respond.
  runBulkEdit(shop, config).catch((e) => console.error('bulk start error:', e));

  return NextResponse.json({ status: 'running' });
}
