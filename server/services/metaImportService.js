// server/services/metaImportService.js
import { getDb } from '../database.js';

function pick(obj, keys) {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== undefined &&
      obj[k] !== null &&
      obj[k] !== ''
    ) {
      return obj[k];
    }
  }
  return null;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();

  // already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // try Date.parse
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeCountry(v) {
  if (!v) return 'ALL';
  const s = String(v).trim();
  // If user gives ISO2, fine; otherwise we store the raw label.
  return s.length ? s : 'ALL';
}

function normalizeText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// Map a raw CSV row from Meta to our meta_daily_metrics schema
function rowToRecord(store, row) {
  const dateRaw = pick(row, ['date', 'day', 'date_start', 'Date', 'Day', 'Date start']);
  const campaignRaw = pick(row, ['campaign', 'campaign_name', 'Campaign', 'Campaign name']);
  const countryRaw = pick(row, ['country', 'country_code', 'Country', 'Country Code']);

  const ageRaw = pick(row, ['age', 'Age']);
  const genderRaw = pick(row, ['gender', 'Gender']);
  const publisherRaw = pick(row, ['publisher_platform', 'Publisher platform', 'publisher']);
  const positionRaw = pick(row, ['platform_position', 'Platform position', 'position']);
  const placementRaw = pick(row, ['placement', 'Placement']);

  const spendRaw = pick(row, ['spend', 'Spend', 'amount_spent', 'Amount spent']);
  const impressionsRaw = pick(row, ['impressions', 'Impressions']);
  const clicksRaw = pick(row, ['clicks', 'Clicks', 'link_clicks', 'Link clicks']);

  const purchasesRaw = pick(row, ['purchases', 'Purchases', 'purchase', 'Purchase']);
  const purchaseValueRaw = pick(row, [
    'purchase_value',
    'Purchase value',
    'revenue',
    'Revenue',
    'conversion_value'
  ]);

  const date = normalizeDate(dateRaw);
  const campaign = normalizeText(campaignRaw) || 'Unknown Campaign';
  const country = normalizeCountry(countryRaw);

  return {
    store,
    date,
    campaign,
    country,
    spend: toNumber(spendRaw),
    impressions: toNumber(impressionsRaw),
    clicks: toNumber(clicksRaw),
    purchases: toNumber(purchasesRaw),
    purchase_value: toNumber(purchaseValueRaw),
    age: normalizeText(ageRaw),
    gender: normalizeText(genderRaw),
    publisher_platform: normalizeText(publisherRaw),
    platform_position: normalizeText(positionRaw),
    placement: normalizeText(placementRaw)
  };
}

export function importMetaDailyRows(store, rows) {
  const db = getDb();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO meta_daily_metrics (
      store, date, campaign, country,
      spend, impressions, clicks, purchases, purchase_value,
      age, gender, publisher_platform, platform_position, placement
    ) VALUES (
      @store, @date, @campaign, @country,
      @spend, @impressions, @clicks, @purchases, @purchase_value,
      @age, @gender, @publisher_platform, @platform_position, @placement
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE meta_daily_metrics SET
      spend = @spend,
      impressions = @impressions,
      clicks = @clicks,
      purchases = @purchases,
      purchase_value = @purchase_value,
      placement = COALESCE(@placement, placement)
    WHERE
      store = @store
      AND date = @date
      AND campaign = @campaign
      AND country = @country
      AND age IS @age
      AND gender IS @gender
      AND publisher_platform IS @publisher_platform
      AND platform_position IS @platform_position
  `);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      try {
        const record = rowToRecord(store, row || {});
        if (!record.date || !record.campaign) {
          skipped += 1;
          continue;
        }

        const ins = insertStmt.run(record);
        if (ins.changes === 1) {
          inserted += 1;
          continue;
        }

        const upd = updateStmt.run(record);
        if (upd.changes > 0) {
          updated += 1;
        } else {
          skipped += 1;
        }
      } catch (e) {
        skipped += 1;
      }
    }
  });

  tx();

  return { inserted, updated, skipped };
}
