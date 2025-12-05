import { getDb } from '../db/database.js';

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeCountry(v) {
  if (!v) return 'ALL';
  const s = String(v).trim();
  return s.length ? s : 'ALL';
}

function normalizeText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

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
  const purchaseValueRaw = pick(row, ['purchase_value', 'Purchase value', 'revenue', 'Revenue', 'conversion_value']);

  const date = normalizeDate(dateRaw);
  const campaignName = normalizeText(campaignRaw) || 'Unknown Campaign';
  const country = normalizeCountry(countryRaw);

  return {
    store,
    date,
    campaign_name: campaignName,
    campaign_id: `manual_${campaignName.replace(/\s+/g, '_')}_${date}`, // Generate a fake ID
    country,
    spend: toNumber(spendRaw),
    impressions: toNumber(impressionsRaw),
    clicks: toNumber(clicksRaw),
    conversions: toNumber(purchasesRaw), // Map 'purchases' to 'conversions' column
    conversion_value: toNumber(purchaseValueRaw), // Map to 'conversion_value'
    age: normalizeText(ageRaw) || '',
    gender: normalizeText(genderRaw) || '',
    publisher_platform: normalizeText(publisherRaw) || '',
    platform_position: normalizeText(positionRaw) || '',
    placement: normalizeText(placementRaw) || '',
  };
}

export function importMetaDailyRows(store, rows) {
  const db = getDb();

  // Updated query to match schema: use campaign_name, conversions, conversion_value
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO meta_daily_metrics (
      store, date, campaign_id, campaign_name, country,
      spend, impressions, clicks, conversions, conversion_value,
      age, gender, publisher_platform, platform_position
    ) VALUES (
      @store, @date, @campaign_id, @campaign_name, @country,
      @spend, @impressions, @clicks, @conversions, @conversion_value,
      @age, @gender, @publisher_platform, @platform_position
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE meta_daily_metrics SET
      spend = @spend,
      impressions = @impressions,
      clicks = @clicks,
      conversions = @conversions,
      conversion_value = @conversion_value
    WHERE
      store = @store
      AND date = @date
      AND campaign_name = @campaign_name
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
        if (!record.date || !record.campaign_name) {
          skipped += 1;
          continue;
        }

        const ins = insertStmt.run(record);
        if (ins.changes === 1) {
          inserted += 1;
          continue;
        }

        const upd = updateStmt.run(record);
        if (upd.changes > 0) updated += 1;
        else skipped += 1;
      } catch (e) {
        console.error('Import row error:', e.message);
        skipped += 1;
      }
    }
  });

  tx();

  return { inserted, updated, skipped };
}
