import crypto from "crypto";

function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const rawBody = await req.text();

  const hmacHeader =
    req.headers.get("x-shopify-hmac-sha256") ||
    req.headers.get("X-Shopify-Hmac-Sha256");

  const isValid = verifyShopifyHmac(rawBody, hmacHeader, secret);

  if (!isValid) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}


export async function HEAD() {
  // Shopify / monitoring tools may send HEAD to validate endpoint existence
  return new Response(null, { status: 200 });
}

export async function OPTIONS() {
  // Helpful for preflight / tooling
  return new Response(null, {
    status: 204,
    headers: {
      "Allow": "GET,POST,HEAD,OPTIONS",
    },
  });
}
