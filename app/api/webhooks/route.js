import crypto from "crypto";
import { deleteShop } from "@/lib/db";

export const dynamic = "force-dynamic";

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

  // Invalid HMAC → Shopify requires 401 Unauthorized for compliance webhooks.
  if (!isValid) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Handle the mandatory compliance topics. SmartAltGen stores ONLY the shop's
  // access token (no customer data), so:
  //  - customers/data_request: nothing to return (we hold no customer data)
  //  - customers/redact:       nothing to delete
  //  - shop/redact:            delete the shop's stored access token
  const topic = req.headers.get("x-shopify-topic") || "";
  let payload = {};
  try { payload = JSON.parse(rawBody || "{}"); } catch { /* ignore */ }

  if (topic === "shop/redact" && payload.shop_domain) {
    try {
      await deleteShop(payload.shop_domain);
    } catch (e) {
      console.error("shop/redact: failed to delete shop", e);
    }
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
