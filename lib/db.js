// Turso (libsql) — TOKEN-ONLY store.
// This DB intentionally holds NOTHING but the shop access token.
// All image data is fetched live from Shopify and held client-side; we never
// persist product/file/article image rows here.
import { createClient } from '@libsql/client';

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('❌ MISSING TURSO CREDENTIALS!');
  console.error('TURSO_DATABASE_URL:', !!process.env.TURSO_DATABASE_URL);
  console.error('TURSO_AUTH_TOKEN:', !!process.env.TURSO_AUTH_TOKEN);
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Initialize schema — just the shops/token table.
const initSchema = async () => {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS shops (
        shop TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // `access_token` is the SHORT-LIVED online token (re-exchanged on every page
    // load). `offline_token` is the LONG-LIVED offline token captured at install —
    // it is NEVER overwritten by the online flow, so background/scheduled jobs
    // (which run with no merchant tab open) always have a usable token.
    try {
      await db.execute('ALTER TABLE shops ADD COLUMN offline_token TEXT');
    } catch {
      /* column already exists — ignore */
    }
    // Expiring offline access tokens (Shopify deprecated permanent ones; all
    // public apps must use expiring offline tokens by 2027-01-01). The offline
    // token now expires in ~1h and is rotated via a 90-day refresh token, so
    // background/scheduled jobs refresh proactively before use.
    //   offline_token_expires_at   — epoch ms; NULL marks a LEGACY (permanent)
    //                                 offline_token that still needs migration.
    //   refresh_token / *_expires_at — the 90-day refresh credential.
    //   offline_migrating_at       — transient claim so two background ticks
    //                                 don't both run the one-time migration.
    for (const col of [
      'offline_token_expires_at INTEGER',
      'refresh_token TEXT',
      'refresh_token_expires_at INTEGER',
      'offline_migrating_at INTEGER',
    ]) {
      try {
        await db.execute(`ALTER TABLE shops ADD COLUMN ${col}`);
      } catch {
        /* column already exists — ignore */
      }
    }
    console.log('✅ Schema initialized (token-only)');
  } catch (e) {
    console.error('❌ Schema error:', e);
  }
};

initSchema();

// ==================== SHOP / TOKEN FUNCTIONS ====================

export const storeShop = async (shop, accessToken) => {
  try {
    await db.execute({
      sql: `
        INSERT INTO shops (shop, access_token)
        VALUES (?, ?)
        ON CONFLICT(shop) DO UPDATE SET access_token = excluded.access_token
      `,
      args: [shop, accessToken],
    });
    console.log('✅ Token stored for', shop);
    return true;
  } catch (e) {
    console.error('❌ storeShop error:', e);
    return false;
  }
};

// Persist the LONG-LIVED offline token (captured once at OAuth install). Kept in
// its own column so the online-token refresh in serverAuth never clobbers it.
export const storeOfflineToken = async (shop, offlineToken) => {
  try {
    await db.execute({
      sql: `
        INSERT INTO shops (shop, access_token, offline_token)
        VALUES (?, ?, ?)
        ON CONFLICT(shop) DO UPDATE SET offline_token = excluded.offline_token
      `,
      args: [shop, offlineToken, offlineToken],
    });
    return true;
  } catch (e) {
    console.error('❌ storeOfflineToken error:', e);
    return false;
  }
};

// Token for autonomous (no-tab) work — prefers the offline token, falls back to
// whatever access_token is stored (older installs that predate offline_token).
export const getOfflineToken = async (shop) => {
  try {
    const result = await db.execute({
      sql: 'SELECT offline_token, access_token FROM shops WHERE shop = ?',
      args: [shop],
    });
    return result.rows[0]?.offline_token ?? result.rows[0]?.access_token ?? null;
  } catch (e) {
    console.error('❌ getOfflineToken error:', e);
    return null;
  }
};

// Full offline-token record for the expiring-token flow. `offline_token_expires_at`
// is NULL for a legacy permanent token (signals it must be migrated before use).
export const getOfflineRecord = async (shop) => {
  try {
    const result = await db.execute({
      sql: `SELECT offline_token, offline_token_expires_at, refresh_token,
                   refresh_token_expires_at, offline_migrating_at, access_token
            FROM shops WHERE shop = ?`,
      args: [shop],
    });
    return result.rows[0] ?? null;
  } catch (e) {
    console.error('❌ getOfflineRecord error:', e);
    return null;
  }
};

// Persist a fresh expiring offline pair DURABLY. This is the write that closes
// the irreversible-migration / refresh-rotation window, so it retries on
// transient DB errors rather than dropping a token we can never re-mint in the
// background. Writes the new pair AND clears the migration claim atomically; the
// legacy permanent offline_token is overwritten here (only after the exchange
// already succeeded), never before.
export const storeOfflinePair = async (shop, pair, { retries = 4 } = {}) => {
  const { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt } = pair;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await db.execute({
        sql: `INSERT INTO shops
                (shop, access_token, offline_token, offline_token_expires_at,
                 refresh_token, refresh_token_expires_at, offline_migrating_at)
              VALUES (?, ?, ?, ?, ?, ?, NULL)
              ON CONFLICT(shop) DO UPDATE SET
                offline_token = excluded.offline_token,
                offline_token_expires_at = excluded.offline_token_expires_at,
                refresh_token = excluded.refresh_token,
                refresh_token_expires_at = excluded.refresh_token_expires_at,
                offline_migrating_at = NULL`,
        args: [shop, accessToken, accessToken, accessExpiresAt, refreshToken, refreshExpiresAt],
      });
      return true;
    } catch (e) {
      console.error(`❌ storeOfflinePair attempt ${attempt} failed:`, e.message);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  return false;
};

// Atomic single-flight claim for the one-time migration. Returns true only to the
// caller that wins the claim; a stale claim (older than ttlMs) can be reclaimed
// so a crash mid-migration doesn't wedge the shop forever.
export const claimOfflineMigration = async (shop, ttlMs = 120000) => {
  try {
    const ts = Date.now();
    const res = await db.execute({
      sql: `UPDATE shops SET offline_migrating_at = ?
            WHERE shop = ?
              AND (offline_migrating_at IS NULL OR offline_migrating_at < ?)`,
      args: [ts, shop, ts - ttlMs],
    });
    return Number(res.rowsAffected) === 1;
  } catch (e) {
    console.error('❌ claimOfflineMigration error:', e);
    return false;
  }
};

export const releaseOfflineMigration = async (shop) => {
  try {
    await db.execute({
      sql: 'UPDATE shops SET offline_migrating_at = NULL WHERE shop = ?',
      args: [shop],
    });
  } catch (e) {
    console.error('❌ releaseOfflineMigration error:', e);
  }
};

export const getAccessToken = async (shop) => {
  try {
    const result = await db.execute({
      sql: 'SELECT access_token FROM shops WHERE shop = ?',
      args: [shop],
    });
    return result.rows[0]?.access_token ?? null;
  } catch (e) {
    console.error('❌ getAccessToken error:', e);
    return null;
  }
};

export const deleteShop = async (shop) => {
  try {
    await db.execute({ sql: 'DELETE FROM shops WHERE shop = ?', args: [shop] });
    console.log(`✅ Deleted: ${shop}`);
    return true;
  } catch (e) {
    console.error('❌ Delete error:', e);
    return false;
  }
};

export const shopExists = async (shop) => {
  try {
    const result = await db.execute({
      sql: 'SELECT 1 FROM shops WHERE shop = ?',
      args: [shop],
    });
    return result.rows.length > 0;
  } catch (e) {
    console.error('❌ shopExists error:', e);
    return false;
  }
};

export default db;
