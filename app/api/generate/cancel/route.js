import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { cancelJob } from '@/lib/generationJob';

export const dynamic = 'force-dynamic';

// POST /api/generate/cancel?shop=...  → stop the background job (keeps results so far).
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await cancelJob(shop);
  return NextResponse.json({ ok: true });
}
