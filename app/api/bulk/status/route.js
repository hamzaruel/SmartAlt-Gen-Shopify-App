import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { getBulkRun } from '@/lib/bulkRun';

export const dynamic = 'force-dynamic';

// GET /api/bulk/status?shop=...  → current immediate-bulk-run progress.
export async function GET(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const run = await getBulkRun(shop);
    if (!run) return NextResponse.json({ status: 'idle' });
    return NextResponse.json(run);
  } catch (e) {
    console.error('bulk status error:', e);
    return NextResponse.json({ status: 'idle' });
  }
}
