import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { getAllImages } from '@/lib/shopifyAdmin';
import { classify } from '@/lib/classify';

export const dynamic = 'force-dynamic';

// POST /api/scan?shop=...
// Live-fetch every image (products, files, blog articles), classify, and
// return them. Nothing is persisted server-side — the client caches the result.
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const items = await getAllImages(shop, token);

    const stats = { total: 0, missing: 0, needsImprovement: 0, optimized: 0 };
    const images = items.map((item) => {
      const { status, reason } = classify(item.alt);
      stats.total += 1;
      if (status === 'MISSING') stats.missing += 1;
      else if (status === 'NEEDS_IMPROVEMENT') stats.needsImprovement += 1;
      else stats.optimized += 1;
      return {
        key: `${item.source}:${item.id}`,
        source: item.source,
        id: item.id,
        url: item.url,
        title: item.title,
        type: item.type,
        vendor: item.vendor ?? null,
        position: item.position,
        width: item.width ?? null,
        height: item.height ?? null,
        adminUrl: item.adminUrl ?? null,
        onlineUrl: item.onlineUrl ?? null,
        currentAlt: item.alt,
        suggestedAlt: null,
        status,
        reason,
      };
    });

    return NextResponse.json({ success: true, images, stats });
  } catch (e) {
    console.error('❌ Scan failed:', e);
    return NextResponse.json({ error: e.message || 'Scan failed' }, { status: 500 });
  }
}
