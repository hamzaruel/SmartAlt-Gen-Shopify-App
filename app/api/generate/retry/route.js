import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { retryFailed, runJob } from '@/lib/generationJob';

export const dynamic = 'force-dynamic';

// POST /api/generate/retry?shop=...
// Re-queue every permanently-failed image for another pass and resume the job.
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await retryFailed(shop);
  runJob(shop); // fire-and-forget — keeps running in the PM2 process
  return NextResponse.json({ status: 'running' });
}
