// Server-side BULK EDIT pipeline: scan → filter → generate → auto-write-back.
// Runs entirely server-side in the long-lived PM2 process, so it works for BOTH
// the immediate "Start Bulk Editing" button (tab can close) and the scheduler
// (no tab at all). Progress lives in its own `bulk_runs` table (one row per shop)
// so it never collides with the manual Alt-text-studio generate flow.
import db, { getOfflineToken } from '@/lib/db';
import { getAllImages, embedAlts } from '@/lib/shopifyAdmin';
import { generateWithGemini } from '@/lib/altText';
import { classify } from '@/lib/classify';
import { sanitizeAlt } from '@/lib/sanitizeAlt';
import { getEntitlement, incrementAiUsage, getUsage } from '@/lib/billing/usage';
import { settleOverflow } from '@/lib/billing/meter';
import { getPlan } from '@/lib/billing/plans';

const now = () => Date.now();
const AI_MODES = new Set(['ai', 'ai_custom']);

let ready;
function ensureSchema() {
  if (ready) return ready;
  ready = db.execute(`
    CREATE TABLE IF NOT EXISTS bulk_runs (
      shop       TEXT PRIMARY KEY,
      status     TEXT NOT NULL,   -- 'running' | 'done' | 'error'
      phase      TEXT,            -- 'scanning' | 'generating' | 'applying' | 'finished'
      total      INTEGER NOT NULL DEFAULT 0,
      done       INTEGER NOT NULL DEFAULT 0,
      applied    INTEGER NOT NULL DEFAULT 0,
      errors     INTEGER NOT NULL DEFAULT 0,
      note       TEXT,
      source     TEXT,            -- 'manual' | 'schedule'
      updated_at INTEGER NOT NULL
    )
  `);
  return ready;
}

export async function getBulkRun(shop) {
  await ensureSchema();
  const r = await db.execute({ sql: 'SELECT * FROM bulk_runs WHERE shop = ?', args: [shop] });
  const row = r.rows[0];
  if (!row) return null;
  return {
    status: row.status,
    phase: row.phase || null,
    total: Number(row.total),
    done: Number(row.done),
    applied: Number(row.applied),
    errors: Number(row.errors),
    note: row.note || null,
    source: row.source || null,
    updatedAt: Number(row.updated_at),
  };
}

async function writeRun(shop, patch) {
  const cols = Object.keys(patch);
  const setSql = cols.map((c) => `${c}=?`).join(', ');
  const args = cols.map((c) => patch[c]);
  await db.execute({
    sql: `UPDATE bulk_runs SET ${setSql}, updated_at=? WHERE shop=?`,
    args: [...args, now(), shop],
  });
}

function hasAlt(item) {
  return !!(item.alt && String(item.alt).trim());
}

function applyTemplate(tpl, img) {
  const filled = (tpl || '')
    .replace(/\[product_title\]/g, img.title || '')
    .replace(/\[product_type\]/g, img.type || '')
    .replace(/\[product_vendor\]/g, img.vendor || '')
    .replace(/\[option[123]\]/g, '');
  return sanitizeAlt(filled);
}

function buildContext(mode, infoFields, item) {
  if (mode !== 'ai_custom') return '';
  const bits = [];
  if (infoFields.includes('title') && item.title) bits.push(`Title: ${item.title}`);
  if (infoFields.includes('type') && item.type) bits.push(`Type: ${item.type}`);
  if (infoFields.includes('vendor') && item.vendor) bits.push(`Vendor: ${item.vendor}`);
  return bits.join('; ');
}

// In-process guard: one bulk run per shop per instance.
const active = new Set();

export function isBulkActive(shop) {
  return active.has(shop);
}

// Run a full bulk edit. `config`:
//   { sources:[], mode, template, scope:'missing'|'all', skipExisting,
//     infoFields:[], instructions, triggeredBy:'manual'|'schedule' }
// Returns a summary object (also persisted in bulk_runs). Safe to fire-and-forget.
export async function runBulkEdit(shop, config) {
  await ensureSchema();
  if (active.has(shop)) return { error: 'A bulk edit is already running for this shop.' };
  active.add(shop);

  const triggeredBy = config.triggeredBy === 'schedule' ? 'schedule' : 'manual';
  const mode = config.mode;
  const isAI = AI_MODES.has(mode);
  const sources = Array.isArray(config.sources) && config.sources.length
    ? config.sources
    : ['product', 'file', 'article', 'collection'];
  const infoFields = Array.isArray(config.infoFields) ? config.infoFields : [];
  const instructions = (config.instructions || '').toString().slice(0, 400);

  // Seed (or replace) the progress row.
  await db.execute({
    sql: `INSERT INTO bulk_runs (shop, status, phase, total, done, applied, errors, note, source, updated_at)
          VALUES (?, 'running', 'scanning', 0, 0, 0, 0, NULL, ?, ?)
          ON CONFLICT(shop) DO UPDATE SET status='running', phase='scanning', total=0, done=0,
            applied=0, errors=0, note=NULL, source=excluded.source, updated_at=excluded.updated_at`,
    args: [shop, triggeredBy, now()],
  });

  const fail = async (note) => {
    await writeRun(shop, { status: 'error', phase: 'finished', note: String(note).slice(0, 200) });
    return { error: note };
  };

  try {
    const token = await getOfflineToken(shop);
    if (!token) return await fail('No stored Shopify token — please reopen the app to reconnect.');

    // Entitlement (needed for AI budget + overflow). Non-AI modes are always free.
    let ent = null;
    if (isAI) {
      ent = await getEntitlement(shop, token);
      if (!ent.plan.ai || !ent.active) return await fail(`AI generation isn’t included in your ${ent.plan.name} plan.`);
      if (ent.remaining <= 0) return await fail('Monthly AI image limit reached. Upgrade or wait for the next cycle.');
    }

    // 1) Scan the whole store server-side (authoritative — no client needed).
    const all = await getAllImages(shop, token);

    // 2) Filter by source + scope + skip-existing.
    let targets = all.filter((i) => sources.includes(i.source));
    if (config.scope === 'missing') targets = targets.filter((i) => !hasAlt(i));
    if (config.skipExisting) targets = targets.filter((i) => !hasAlt(i));
    if (mode === 'remove') targets = all.filter((i) => sources.includes(i.source) && hasAlt(i));

    if (!targets.length) {
      await writeRun(shop, { status: 'done', phase: 'finished', total: 0, note: 'No matching images.' });
      return { processed: 0, applied: 0, errors: 0, note: 'No matching images.' };
    }

    // Cap AI work to the remaining quota.
    if (isAI && ent) targets = targets.slice(0, ent.remaining);

    await writeRun(shop, { phase: 'generating', total: targets.length });

    // 3) Build the alt text for each target.
    const toApply = [];   // { source, id, url, alt }
    let done = 0;
    let madeAI = 0;
    let geminiErr = null;

    if (mode === 'remove') {
      for (const it of targets) toApply.push({ source: it.source, id: it.id, url: it.url, alt: '' });
      done = targets.length;
      await writeRun(shop, { done });
    } else if (!isAI) {
      // template / title — instant, no quota.
      for (const it of targets) {
        const tpl = mode === 'title' ? '[product_title]' : (config.template || '[product_title]');
        const alt = applyTemplate(tpl, it);
        if (alt) toApply.push({ source: it.source, id: it.id, url: it.url, alt });
        done += 1;
      }
      await writeRun(shop, { done });
    } else {
      // AI — chunked, metered, stops on quota/credit errors (keeps what's made).
      const CHUNK = 3;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const batch = targets.slice(i, i + CHUNK);
        const out = await Promise.all(batch.map(async (it) => {
          try {
            const alt = await generateWithGemini(it.url, buildContext(mode, infoFields, it), instructions);
            return { source: it.source, id: it.id, url: it.url, alt };
          } catch (e) {
            const msg = e.message || 'failed';
            if (/\b429\b|quota|rate.?limit/i.test(msg)) { geminiErr = msg; return null; }
            console.error('bulk AI error:', msg);
            return null;
          }
        }));
        const made = out.filter(Boolean);
        toApply.push(...made);
        madeAI += made.length;
        done += batch.length;
        if (made.length) await incrementAiUsage(shop, ent.cycleKey, made.length);
        await writeRun(shop, { done: Math.min(done, targets.length) });
        if (geminiErr) break;
      }
    }

    // 4) Write the alt text back to Shopify.
    await writeRun(shop, { phase: 'applying' });
    let applied = 0;
    const errs = [];
    if (toApply.length) {
      // allowEmpty is implicit for 'remove' (alt = '').
      const res = await embedAlts(shop, token, toApply);
      applied = res.applied;
      if (res.errors?.length) errs.push(...res.errors);
    }

    // 5) Settle Compliance overflow once (best-effort).
    if (isAI && ent?.plan?.overflow) {
      try {
        const { aiCount } = await getUsage(shop, ent.cycleKey);
        await settleOverflow(shop, token, ent.plan, ent.cycleKey, aiCount);
      } catch (e) {
        console.error('overflow settle (bulk) failed:', e.message);
      }
    }

    const note = geminiErr
      ? 'AI was busy / out of credits — applied what was generated. Try again later.'
      : `Applied alt text to ${applied} image${applied === 1 ? '' : 's'}.`;
    await writeRun(shop, {
      status: geminiErr ? 'error' : 'done',
      phase: 'finished',
      applied,
      errors: errs.length,
      note,
    });

    return { processed: targets.length, generated: isAI ? madeAI : toApply.length, applied, errors: errs.length, note };
  } catch (e) {
    console.error('runBulkEdit fatal:', e);
    return await fail(String(e?.message || e));
  } finally {
    active.delete(shop);
  }
}
