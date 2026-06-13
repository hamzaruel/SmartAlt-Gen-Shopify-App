// Server-side scan persistence (Turso). Stores the merchant's most recent scan
// (image list + stats + generated suggestions) keyed by shop, so it survives
// tab close and loads on any device. One row per shop. TTL'd so we don't hoard.
import db from '@/lib/db';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, like the source app

let ready;
async function ensureSchema() {
  if (ready) return ready;
  ready = db.execute(`
    CREATE TABLE IF NOT EXISTS scans (
      shop TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      scanned_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  return ready;
}

export async function saveScanRow(shop, payload) {
  await ensureSchema();
  const scannedAt = Number(payload?.scannedAt) || Date.now();
  const expiresAt = scannedAt + TTL_MS;
  await db.execute({
    sql: `
      INSERT INTO scans (shop, data, scanned_at, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(shop) DO UPDATE SET
        data = excluded.data, scanned_at = excluded.scanned_at, expires_at = excluded.expires_at
    `,
    args: [shop, JSON.stringify(payload), scannedAt, expiresAt],
  });
}

export async function getScanRow(shop) {
  await ensureSchema();
  const r = await db.execute({
    sql: 'SELECT data, expires_at FROM scans WHERE shop = ?',
    args: [shop],
  });
  const row = r.rows[0];
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await deleteScanRow(shop); // expired → clean up, treat as empty
    return null;
  }
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export async function deleteScanRow(shop) {
  await ensureSchema();
  try {
    await db.execute({ sql: 'DELETE FROM scans WHERE shop = ?', args: [shop] });
  } catch (e) {
    console.error('deleteScanRow error:', e.message);
  }
}
