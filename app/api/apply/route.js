import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { embedAlts } from '@/lib/shopifyAdmin';

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

  const body = await request.json().catch(() => ({}));
  const allowEmpty = body.allowEmpty === true;
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((i) => ({ ...i, alt: allowEmpty ? (i.alt ?? '') : i.alt }))
    .filter((i) => i?.id && i?.source && (allowEmpty || (i.alt ?? '').trim()));
  if (!items.length) return NextResponse.json({ applied: 0, total: 0, errors: [] });

  const { applied, errors } = await embedAlts(shop, token, items);

  return NextResponse.json({ applied, total: items.length, errors });
}
