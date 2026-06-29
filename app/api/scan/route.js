import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { scanPacket } from '@/lib/shopifyAdmin';
import { classify } from '@/lib/classify';

export const dynamic = 'force-dynamic';

// POST /api/scan?shop=...
// Packet-based scan: each call fetches ONE bounded packet of images and returns
// a `next` pointer for the following call (or null when the whole store is done).
// The client loops until done, so no single request times out — this keeps the
// scan safe for large/enterprise stores. Nothing is persisted server-side; the
// client accumulates the packets and caches the result.
// body: { state?: { source, cursor } | null }  ← pass back the previous `next`.
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const state = body?.state || null;
  // optional: limit which sources are scanned (from the merchant's Settings)
  const allowedSources = Array.isArray(body?.allowedSources) && body.allowedSources.length
    ? body.allowedSources
    : undefined;

  try {
    const { items, next } = await scanPacket(shop, token, state, allowedSources);

    const images = items.map((item) => {
      const { status, reason } = classify(item.alt);
      return {
        key: `${item.source}:${item.id}`,
        source: item.source,
        id: item.id,
        url: item.url,
        title: item.title,
        type: item.type,
        vendor: item.vendor ?? null,
        collections: item.collections ?? [],
        position: item.position,
        width: item.width ?? null,
        height: item.height ?? null,
        updatedAt: item.updatedAt ?? null,
        adminUrl: item.adminUrl ?? null,
        onlineUrl: item.onlineUrl ?? null,
        currentAlt: item.alt,
        suggestedAlt: null,
        status,
        reason,
      };
    });

    return NextResponse.json({ success: true, images, next, done: !next });
  } catch (e) {
    console.error('❌ Scan failed:', e);
    return NextResponse.json({ error: e.message || 'Scan failed' }, { status: 500 });
  }
}
