import { NextResponse } from 'next/server';
import { deleteShop } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Verify the webhook is genuinely from Shopify (constant-time HMAC compare).
function verifyHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(digest, 'base64');
  const b = Buffer.from(hmacHeader, 'base64');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  const rawBody = await request.text();
  const hmac = request.headers.get('x-shopify-hmac-sha256');
  const shop = request.headers.get('x-shopify-shop-domain');

  // Reject anything we can't verify — Shopify's HMAC check requires 401 here.
  if (!verifyHmac(rawBody, hmac, process.env.SHOPIFY_API_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verified uninstall → remove the shop's stored token.
  try {
    if (shop) await deleteShop(shop);
    console.log('✅ app/uninstalled — cleaned up', shop);
  } catch (e) {
    console.error('app/uninstalled cleanup error:', e);
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
