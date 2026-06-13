import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { getJob, getResultsSince, runJob } from '@/lib/generationJob';

export const dynamic = 'force-dynamic';

const STALE_MS = 30000; // if a "running" job hasn't heartbeat in 30s, resume it

// GET /api/generate/status?shop=...&since=<seq>
// Returns job progress + any results the client hasn't seen (seq > since).
export async function GET(request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const since = Number(url.searchParams.get('since')) || 0;

  try {
    const job = await getJob(shop);
    if (!job) return NextResponse.json({ status: 'idle' });

    // Self-heal: a running job with a stale heartbeat (server restarted / crashed
    // mid-run) gets resumed — runJob is idempotent and skips finished images.
    if (job.status === 'running' && Date.now() - Number(job.updated_at) > STALE_MS) {
      runJob(shop);
    }

    const results = await getResultsSince(shop, since);
    return NextResponse.json({
      status: job.status,
      total: Number(job.total),
      done: Number(job.done),
      error: job.error || null,
      results,
    });
  } catch (e) {
    console.error('generation status error:', e);
    return NextResponse.json({ status: 'idle' });
  }
}
