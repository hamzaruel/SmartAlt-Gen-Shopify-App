import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { embedAlts } from '@/lib/shopifyAdmin';
import { dropAppliedRows } from '@/lib/generationJob';

export const dynamic = 'force-dynamic';

// POST /api/apply?shop=...
// body: { items: [{ key, source, id, url, alt }], allowEmpty?: bool }
// Writes the alt text back into Shopify (fileUpdate / articleUpdate / collectionUpdate).
// allowEmpty=true lets alt be "" so the merchant can CLEAR/remove alt text.
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const allowEmpty = body.allowEmpty === true;
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((i) => ({ ...i, alt: allowEmpty ? (i.alt ?? '') : i.alt }))
      .filter((i) => i?.id && i?.source && (allowEmpty || (i.alt ?? '').trim()));
    if (!items.length) return NextResponse.json({ applied: 0, total: 0, errors: [] });

    const { applied, errors } = await embedAlts(shop, token, items);

    // Applied alt is now live in Shopify — drop those rows from the generation
    // queue so it stays lean (keeps only still-pending / failed work).
    if (applied && !errors?.length) {
      await dropAppliedRows(shop, items.map((i) => i.key).filter(Boolean));
    }

    return NextResponse.json({ applied, total: items.length, errors });
  } catch (e) {
    console.error('apply route crashed:', e);
    return NextResponse.json({ error: e?.message || 'Apply crashed', stack: String(e?.stack || '').split('\n').slice(0, 4).join(' | ') }, { status: 500 });
  }
}
