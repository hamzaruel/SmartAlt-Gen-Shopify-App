import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { getScanRow, saveScanRow } from '@/lib/scanDb';

export const dynamic = 'force-dynamic';

// GET /api/scan/state?shop=...  → the shop's saved scan (or null).
export async function GET(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const scan = await getScanRow(shop);
    return NextResponse.json({ scan });
  } catch (e) {
    console.error('scan state load error:', e);
    return NextResponse.json({ scan: null });
  }
}

// POST /api/scan/state?shop=...  body: { images, stats, scannedAt }  → persist it.
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await request.json().catch(() => null);
  if (!payload || !Array.isArray(payload.images)) {
    return NextResponse.json({ error: 'No scan data' }, { status: 400 });
  }

  try {
    await saveScanRow(shop, payload);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('scan state save error:', e);
    return NextResponse.json({ error: 'Could not save scan' }, { status: 500 });
  }
}
