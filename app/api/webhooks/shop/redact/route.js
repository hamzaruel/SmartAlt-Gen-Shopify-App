import crypto from "crypto";

export const dynamic = "force-dynamic";

// ---------------------- HMAC verification ----------------------
function verifyWebhookHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;

  const hash = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const hashBuffer = Buffer.from(hash, "base64");
  const hmacBuffer = Buffer.from(hmacHeader, "base64");

  if (hashBuffer.length !== hmacBuffer.length) return false;

  return crypto.timingSafeEqual(hashBuffer, hmacBuffer);
}

// ---------------------- Webhook handler ----------------------
export async function POST(req) {
  const rawBody = await req.text();

  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const shopDomain = req.headers.get("x-shopify-shop-domain");

  // Shopify automated probes may not include headers
  if (!hmac || !shopDomain) {
    console.warn("⚠️ GDPR shop/redact probe received");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const isValid = verifyWebhookHmac(
    rawBody,
    hmac,
    process.env.SHOPIFY_API_SECRET
  );

  if (!isValid) {
    // 🚨 Log but DO NOT reject
    console.error(
      "🚨 HMAC verification failed for shop/redact:",
      shopDomain
    );
  } else {
    console.log(
      "✅ shop/redact received from:",
      shopDomain
    );
  }

  // Free app → no shop PII stored → no-op
  return new Response(
    JSON.stringify({ status: "received" }),
    { status: 200 }
  );
}

