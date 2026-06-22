// Expiring offline access tokens.
//
// Shopify is retiring non-expiring (permanent) offline tokens; every public app
// must use EXPIRING offline tokens by 2027-01-01. An expiring offline token is a
// pair: a ~1h access token + a 90-day refresh token that rotates without the
// merchant present — exactly what our background bulk/scheduler jobs need.
//
// This module owns the three transitions and ONE hard invariant:
//   migrate  — one-time, irreversible exchange of a legacy permanent token for an
//              expiring pair (Shopify revokes the old token on success).
//   refresh  — swap an expired access token for a fresh pair via the refresh token.
//   resolve  — getValidOfflineToken(): hand a job a usable access token, doing the
//              migrate/refresh lazily as needed.
//
// INVARIANT: never drop the only working token before its replacement is durably
// stored. Exchange → PERSIST (durable, retried) → only then use/overwrite. A
// failed exchange degrades to the still-valid prior token (no lockout); a failed
// PERSIST keeps the freshly-exchanged pair in an in-process bridge so the next
// background tick re-persists it — recovery never depends on a foreground load.
// The single irreducible gap is a process crash in the sub-ms window between
// Shopify's revoke and our durable write; that is reconnect-only for any app.

import {
  getOfflineRecord,
  storeOfflinePair,
  storeOfflineToken,
  claimOfflineMigration,
  releaseOfflineMigration,
} from './db';

const OFFLINE_TT = 'urn:shopify:params:oauth:token-type:offline-access-token';
const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const SKEW_MS = 5 * 60 * 1000; // treat a token as expired this early (clock skew + run length)

// Freshly-exchanged pairs we could not durably persist, keyed by shop. Lets a
// background-only shop self-heal across ticks within a process lifetime.
const pendingPersist = new Map();

function realDeps() {
  return {
    getOfflineRecord,
    storeOfflinePair,
    storeLegacyOffline: storeOfflineToken,
    claimOfflineMigration,
    releaseOfflineMigration,
    pending: pendingPersist,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    // POST to Shopify's token endpoint. Returns parsed JSON on 2xx; on failure
    // throws a tagged error so callers can tell "subject already consumed/revoked"
    // (don't retry, migration already happened) from a transient fault (retry).
    postToken: async (shop, body) => {
      const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: process.env.SHOPIFY_API_KEY,
          client_secret: process.env.SHOPIFY_API_SECRET,
          ...body,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`token endpoint ${res.status}: ${text.slice(0, 200)}`);
        err.status = res.status;
        err.invalidSubject =
          res.status === 400 && /invalid_(grant|subject|request|token)|revoked|expired/i.test(text);
        throw err;
      }
      return JSON.parse(text);
    },
  };
}

function pairFromResponse(json, now) {
  return {
    accessToken: json.access_token,
    accessExpiresAt: now + (Number(json.expires_in) || 3600) * 1000,
    refreshToken: json.refresh_token,
    refreshExpiresAt: now + (Number(json.refresh_token_expires_in) || 7776000) * 1000,
  };
}

function exchangeBody(legacyToken) {
  return {
    grant_type: TOKEN_EXCHANGE,
    subject_token: legacyToken,
    subject_token_type: OFFLINE_TT,
    requested_token_type: OFFLINE_TT,
    expiring: 1,
  };
}

// Durably store a freshly-exchanged pair, then return its access token. On a
// persist failure the pair is cached in-process (never discarded) so the next
// tick can re-persist it; on success the cache entry is cleared.
async function commitPair(shop, pair, deps) {
  const ok = await deps.storeOfflinePair(shop, pair);
  if (ok) {
    deps.pending.delete(shop);
  } else {
    deps.pending.set(shop, pair);
    console.error(`⚠️ offline pair persist failed for ${shop}; cached in memory for retry`);
  }
  return pair.accessToken;
}

// Exchange expired access token for a fresh pair. PERSIST happens before the new
// access token is returned, so the rotated-out refresh token is never the only
// copy. A failed refresh leaves the stored refresh token untouched (safe to retry).
async function refreshAndPersist(shop, refreshToken, deps) {
  let json;
  try {
    json = await deps.postToken(shop, { grant_type: 'refresh_token', refresh_token: refreshToken });
  } catch (e) {
    // Request did NOT succeed → the stored refresh token was not consumed.
    // Transient → next tick retries it; genuinely dead (>90d idle) → reconnect.
    console.error(`offline refresh failed for ${shop}:`, e.message);
    return null;
  }
  return await commitPair(shop, pairFromResponse(json, deps.now()), deps);
}

// One-time migration of a legacy permanent token to an expiring pair, guarded by a
// single-flight claim. Degrades to the still-valid legacy token on a transient
// failure; resolves an "already migrated" race by re-reading the stored pair.
async function migrateAndPersist(shop, legacyToken, deps) {
  const claimed = await deps.claimOfflineMigration(shop);
  if (!claimed) {
    // Another worker holds the claim. Give it a moment, then use its result if
    // ready; otherwise fall back to the legacy token for this run (still valid).
    await deps.sleep(500);
    const rec = await deps.getOfflineRecord(shop);
    if (rec?.offline_token && rec.offline_token_expires_at != null &&
        Number(rec.offline_token_expires_at) - SKEW_MS > deps.now()) {
      return rec.offline_token;
    }
    return legacyToken;
  }
  try {
    let json;
    try {
      json = await deps.postToken(shop, exchangeBody(legacyToken));
    } catch (e) {
      if (e.invalidSubject) {
        // Legacy token already consumed → migration ran elsewhere. Use its pair.
        const rec = await deps.getOfflineRecord(shop);
        if (rec?.offline_token && rec.offline_token_expires_at != null) return rec.offline_token;
        return null; // revoked but no stored pair → background can't recover → reconnect
      }
      // Transient/network: legacy token was NOT revoked → keep using it this run.
      console.error(`offline migration failed for ${shop}:`, e.message);
      return legacyToken;
    }
    // Exchange succeeded → Shopify just revoked the legacy token. Persist NOW.
    return await commitPair(shop, pairFromResponse(json, deps.now()), deps);
  } finally {
    await deps.releaseOfflineMigration(shop);
  }
}

// Resolve a usable offline access token for a background job, migrating/refreshing
// as needed. Returns null only when the shop genuinely needs to reconnect (refresh
// token expired, or a token irrecoverably lost) — callers surface that to merchant.
export async function getValidOfflineToken(shop, deps = realDeps()) {
  const now = deps.now();

  // (0) In-process bridge: a pair we exchanged but couldn't persist last time.
  // Re-persist + reuse so a background-only shop heals without a foreground load.
  const cached = deps.pending.get(shop);
  if (cached) {
    if (Number(cached.accessExpiresAt) - SKEW_MS > now) return await commitPair(shop, cached, deps);
    if (cached.refreshToken && Number(cached.refreshExpiresAt) > now) {
      return await refreshAndPersist(shop, cached.refreshToken, deps);
    }
    deps.pending.delete(shop); // fully expired → fall through to stored record
  }

  const rec = await deps.getOfflineRecord(shop);
  if (!rec) return null;

  // (A) Have an expiring pair.
  if (rec.offline_token && rec.offline_token_expires_at != null) {
    if (Number(rec.offline_token_expires_at) - SKEW_MS > now) return rec.offline_token;
    if (rec.refresh_token && Number(rec.refresh_token_expires_at) > now) {
      return await refreshAndPersist(shop, rec.refresh_token, deps);
    }
    return null; // access + refresh both expired → reconnect
  }

  // (B) Legacy permanent token (NULL expiry) → migrate once.
  if (rec.offline_token && rec.offline_token_expires_at == null) {
    return await migrateAndPersist(shop, rec.offline_token, deps);
  }

  // (C) No offline token → best-effort stored access_token (older installs).
  return rec.access_token ?? null;
}

// Called at install with the code-grant (permanent) token: migrate it to an
// expiring pair immediately. If the exchange fails, store the legacy token as a
// fallback (NULL expiry) so install never breaks and lazy migration retries later.
// Returns: 'migrated' | 'migrated_unpersisted' | 'legacy_fallback'.
export async function installOfflineToken(shop, legacyToken, deps = realDeps()) {
  try {
    const json = await deps.postToken(shop, exchangeBody(legacyToken));
    const pair = pairFromResponse(json, deps.now());
    const ok = await deps.storeOfflinePair(shop, pair);
    if (!ok) deps.pending.set(shop, pair);
    return ok ? 'migrated' : 'migrated_unpersisted';
  } catch (e) {
    console.error(`install offline migration failed for ${shop}, storing legacy fallback:`, e.message);
    await deps.storeLegacyOffline(shop, legacyToken);
    return 'legacy_fallback';
  }
}
