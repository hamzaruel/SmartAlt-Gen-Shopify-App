import crypto from 'crypto';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ---------------------- HMAC verification ----------------------
function verifyWebhookHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;

  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  const hashBuffer = Buffer.from(hash, 'base64');
  const hmacBuffer = Buffer.from(hmacHeader, 'base64');

  if (hashBuffer.length !== hmacBuffer.length) return false;

  return crypto.timingSafeEqual(hashBuffer, hmacBuffer);
}

// ---------------------- Webhook handler ----------------------
export async function POST(request) {
  const rawBody = await request.text();

  const hmac = request.headers.get('x-shopify-hmac-sha256');
  const topic = request.headers.get('x-shopify-topic');
  const shopDomain = request.headers.get('x-shopify-shop-domain');

  // Shopify probe / non-matching topic → ACK
  if (topic !== 'shop/update') {
    return new NextResponse(null, { status: 200 });
  }

  // Missing headers = probe
  if (!hmac || !shopDomain) {
    console.warn('⚠️ shop/update probe received');
    return new NextResponse(null, { status: 200 });
  }

  const isValid = verifyWebhookHmac(
    rawBody,
    hmac,
    process.env.SHOPIFY_API_SECRET
  );

  if (!isValid) {
    // 🚨 Log but DO NOT reject
    console.error('🚨 Invalid HMAC for shop/update:', shopDomain);
    return new NextResponse(null, { status: 200 });
  }

  // Safe parse
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('Failed to parse shop/update payload:', shopDomain, err);
    return new NextResponse(null, { status: 200 });
  }

  // TOKEN-ONLY: we intentionally do NOT persist shop profile data.
  // Just acknowledge the webhook so Shopify stops retrying.
  console.log(`🔄 shop/update received for ${shopDomain} (no-op, token-only)`);

  return new NextResponse(null, { status: 200 });
}

