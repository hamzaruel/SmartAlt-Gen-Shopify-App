// import crypto from 'crypto';
// import { NextResponse } from 'next/server';
// import { deleteShop } from '@/lib/db';

// export const dynamic = 'force-dynamic';

// function verifyWebhookHmac(rawBody, hmacHeader, secret) {
//   if (!hmacHeader || !secret) return false;

//   const hash = crypto
//     .createHmac('sha256', secret)
//     .update(rawBody, 'utf8')
//     .digest('base64');

//   const hashBuffer = Buffer.from(hash, 'utf8');
//   const hmacBuffer = Buffer.from(hmacHeader, 'utf8');

//   if (hashBuffer.length !== hmacBuffer.length) return false;

//   return crypto.timingSafeEqual(hashBuffer, hmacBuffer);
// }

// export async function POST(request) {
//   const rawBody = await request.text();

//   const hmac = request.headers.get('x-shopify-hmac-sha256');
//   const topic = request.headers.get('x-shopify-topic');
//   const shop = request.headers.get('x-shopify-shop-domain');

//   if (topic !== 'app/uninstalled') {
//     return new NextResponse(null, { status: 200 });
//   }

//   if (!hmac || !shop) {
//     return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
//   }

//   const secret = process.env.SHOPIFY_API_SECRET;

//   if (!verifyWebhookHmac(rawBody, hmac, secret)) {
//     console.error('❌ Invalid webhook HMAC');
//     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
//   }

//   await deleteShop(shop);

//   console.log(`🗑 App uninstalled — cleaned data for ${shop}`);

//   return new NextResponse(null, { status: 200 });
// }

// import crypto from 'crypto';
// import { NextResponse } from 'next/server';
// import { deleteShop } from '@/lib/db';

// export const dynamic = 'force-dynamic';

// function verifyWebhookHmac(rawBody, hmacHeader, secret) {
//   if (!hmacHeader || !secret) return false;

//   const hash = crypto
//     .createHmac('sha256', secret)
//     .update(rawBody, 'utf8')
//     .digest('base64');

//   const hashBuffer = Buffer.from(hash, 'utf8');
//   const hmacBuffer = Buffer.from(hmacHeader, 'utf8');

//   if (hashBuffer.length !== hmacBuffer.length) return false;

//   return crypto.timingSafeEqual(hashBuffer, hmacBuffer);
// }

// export async function POST(request) {
//   const rawBody = await request.text();

//   const hmac = request.headers.get('x-shopify-hmac-sha256');
//   const topic = request.headers.get('x-shopify-topic');
//   const shop = request.headers.get('x-shopify-shop-domain');

//   console.log('🔔 Webhook received - Topic:', topic, 'Shop:', shop);

//   if (topic !== 'app/uninstalled') {
//     return new NextResponse(null, { status: 200 });
//   }

//   if (!hmac || !shop) {
//     return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
//   }

//   const secret = process.env.SHOPIFY_API_SECRET;

//   if (!verifyWebhookHmac(rawBody, hmac, secret)) {
//     console.error('❌ Invalid webhook HMAC');
//     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
//   }

//   // 🔽 TEMPORARY: Skip deletion during development
//   if (process.env.NODE_ENV === 'development') {
//     console.log('⚠️ Development mode - NOT deleting shop data for:', shop);
//     return NextResponse.json({ message: 'Skipped in development' }, { status: 200 });
//   }
//   // 🔼 END TEMPORARY

//   await deleteShop(shop);

//   console.log(`🗑 App uninstalled — cleaned data for ${shop}`);

//   return new NextResponse(null, { status: 200 });
// }

// working one with sql lite
// import crypto from 'crypto';
// import { NextResponse } from 'next/server';
// import { deleteShop } from '@/lib/db';

// export const dynamic = 'force-dynamic';

// function verifyWebhookHmac(rawBody, hmacHeader, secret) {
//   if (!hmacHeader || !secret) return false;

//   const hash = crypto
//     .createHmac('sha256', secret)
//     .update(rawBody, 'utf8')
//     .digest('base64');

//   const hashBuffer = Buffer.from(hash, 'utf8');
//   const hmacBuffer = Buffer.from(hmacHeader, 'utf8');

//   if (hashBuffer.length !== hmacBuffer.length) return false;

//   return crypto.timingSafeEqual(hashBuffer, hmacBuffer);
// }

// export async function POST(request) {
//   const rawBody = await request.text();

//   const hmac = request.headers.get('x-shopify-hmac-sha256');
//   const topic = request.headers.get('x-shopify-topic');
//   const shop = request.headers.get('x-shopify-shop-domain');

//   if (topic !== 'app/uninstalled') {
//     return new NextResponse(null, { status: 200 });
//   }

//   if (!hmac || !shop) {
//     return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
//   }

//   const secret = process.env.SHOPIFY_API_SECRET;

//   if (!verifyWebhookHmac(rawBody, hmac, secret)) {
//     console.error('❌ Invalid webhook HMAC');
//     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
//   }

//   await deleteShop(shop);

//   console.log(`🗑 App uninstalled — cleaned data for ${shop}`);

//   return new NextResponse(null, { status: 200 });
// }


// new one for testing 
// app/api/webhooks/app-uninstalled/route.js

// working one with the turso 
// import { NextResponse } from 'next/server'; 
import { NextResponse } from 'next/server'; 
import { deleteShop } from '@/lib/db';
import crypto from 'crypto';

export async function POST(request) {
  try {
    const hmac = request.headers.get('x-shopify-hmac-sha256');
    const shop = request.headers.get('x-shopify-shop-domain');
    const body = await request.text();

    // ⚠️ Shopify review bot / probe
    if (!hmac || !shop) {
      console.warn('⚠️ Webhook without HMAC or shop (Shopify bot)');
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(body, 'utf8')
      .digest('base64');

    const hashBuffer = Buffer.from(hash, 'base64');
    const hmacBuffer = Buffer.from(hmac, 'base64');

    if (
      hashBuffer.length !== hmacBuffer.length ||
      !crypto.timingSafeEqual(hashBuffer, hmacBuffer)
    ) {
      console.warn('⚠️ Invalid HMAC for app/uninstalled');
      // ⚠️ DO NOT return 401
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // ✅ Real uninstall
    await deleteShop(shop);
    console.log('✅ Shop deleted:', shop);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    // ⚠️ Always ACK so Shopify doesn't retry
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

