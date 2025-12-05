import { getDb } from '../db/database.js';

function pick(obj, keys) {
  if (!obj) return null;
  const objKeys = Object.keys(obj);
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
      return obj[k];
    }
    // Fuzzy match
    const fuzzy = objKeys.find(ok => ok.toLowerCase().includes(k.toLowerCase()));
    if (fuzzy && obj[fuzzy]) return obj[fuzzy];
  }
  return null;
}

function toNumber(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function normalizeText(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.length ? s : '';
}

function normalizeCountry(v) {
  if (!v) return 'ALL';
  const s = String(v).trim();
  return s.length ? s : 'ALL';
}

function rowToRecord(store, row) {
  // Support specific CSV headers
  const dateRaw = pick(row, ['date', 'day', 'date_start', 'Reporting starts', 'Starts']); 
  const campaignRaw = pick(row, ['campaign', 'campaign_name', 'Campaign name']);
  const countryRaw = pick(row, ['country', 'country_code', 'Country']);

  const spendRaw = pick(row, ['spend', 'amount_spent', 'Amount spent']); 
  const impressionsRaw = pick(row, ['impressions', 'Impressions']);
  const clicksRaw = pick(row, ['clicks', 'Clicks', 'link_clicks']);
  const purchasesRaw = pick(row, ['purchases', 'Purchases', 'purchase', 'Results']);
  const purchaseValueRaw = pick(row, ['purchase_value', 'Purchase value', 'revenue', 'conversion_value']);

  const date = normalizeDate(dateRaw);
  const campaignName = normalizeText(campaignRaw) || 'Unknown Campaign';
  const country = normalizeCountry(countryRaw);

  return {
    store,
    date,
    campaign_name: campaignName, // Correct DB Column
    // Unique ID: store_campaign_date_country
    campaign_id: `manual_${campaignName.replace(/[^a-zA-Z0-9]/g, '')}_${date}_${country}`,
    country,
    spend: toNumber(spendRaw),
    impressions: toNumber(impressionsRaw),
    clicks: toNumber(clicksRaw),
    conversions: toNumber(purchasesRaw), 
    conversion_value: toNumber(purchaseValueRaw),
    age: '', gender: '', publisher_platform: '', platform_position: ''
  };
}

export function importMetaDailyRows(store, rows) {
  const db = getDb();

  // 1. Ensure table has the new columns if missing
  try { db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN conversions INTEGER DEFAULT 0`); } catch(e){}
  try { db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN conversion_value REAL DEFAULT 0`); } catch(e){}

  // 2. Prepare the Insert Statement using campaign_name (NOT campaign)
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO meta_daily_metrics (
      store, date, campaign_id, campaign_name, country,
      spend, impressions, clicks, conversions, conversion_value,
      age, gender, publisher_platform, platform_position
    ) VALUES (
      @store, @date, @campaign_id, @campaign_name, @country,
      @spend, @impressions, @clicks, @conversions, @conversion_value,
      @age, @gender, @publisher_platform, @platform_position
    )
  `);

  let inserted = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      try {
        const record = rowToRecord(store, row || {});
        
        // Validation: Must have date and campaign name
        if (!record.date || !record.campaign_name) {
          skipped++;
          continue;
        }

        insertStmt.run(record);
        inserted++;
      } catch (e) {
        console.error('Import Row Error:', e.message);
        skipped++;
      }
    }
  });

  tx();
  return { inserted, updated: 0, skipped };
}
