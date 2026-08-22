const EXCHANGE_APPLY_TABLES = ['meta_daily_metrics', 'meta_adset_metrics', 'meta_ad_metrics'];

/**
 * Recompute stored USD values from the original TRY amounts using the stored
 * per-day TRY→USD rate. Rows imported before their rate landed keep spend = NULL,
 * so this has to run again whenever new rates are backfilled.
 */
export function applyExchangeRatesToMetaMetrics({ db, store, startDate, endDate }) {
  const perTable = {};
  let totalCandidates = 0;
  let totalConvertible = 0;
  let totalUpdated = 0;

  const tx = db.transaction(() => {
    for (const table of EXCHANGE_APPLY_TABLES) {
      const candidateRows = db.prepare(`
        SELECT COUNT(*) as count
        FROM ${table}
        WHERE store = ?
          AND date BETWEEN ? AND ?
          AND COALESCE(original_currency, 'TRY') = 'TRY'
      `).get(store, startDate, endDate)?.count || 0;

      const convertibleRows = db.prepare(`
        SELECT COUNT(*) as count
        FROM ${table}
        WHERE store = ?
          AND date BETWEEN ? AND ?
          AND COALESCE(original_currency, 'TRY') = 'TRY'
          AND EXISTS (
            SELECT 1
            FROM exchange_rates er
            WHERE er.from_currency = 'TRY'
              AND er.to_currency = 'USD'
              AND er.date = ${table}.date
          )
      `).get(store, startDate, endDate)?.count || 0;

      const updateResult = db.prepare(`
        UPDATE ${table}
        SET
          spend = CASE
            WHEN spend_original IS NOT NULL THEN spend_original * (
              SELECT er.rate
              FROM exchange_rates er
              WHERE er.from_currency = 'TRY'
                AND er.to_currency = 'USD'
                AND er.date = ${table}.date
            )
            ELSE spend
          END,
          conversion_value = CASE
            WHEN conversion_value_original IS NOT NULL THEN conversion_value_original * (
              SELECT er.rate
              FROM exchange_rates er
              WHERE er.from_currency = 'TRY'
                AND er.to_currency = 'USD'
                AND er.date = ${table}.date
            )
            ELSE conversion_value
          END,
          cost_per_inline_link_click = CASE
            WHEN cost_per_inline_link_click_original IS NOT NULL THEN cost_per_inline_link_click_original * (
              SELECT er.rate
              FROM exchange_rates er
              WHERE er.from_currency = 'TRY'
                AND er.to_currency = 'USD'
                AND er.date = ${table}.date
            )
            ELSE cost_per_inline_link_click
          END
        WHERE store = ?
          AND date BETWEEN ? AND ?
          AND COALESCE(original_currency, 'TRY') = 'TRY'
          AND EXISTS (
            SELECT 1
            FROM exchange_rates er
            WHERE er.from_currency = 'TRY'
              AND er.to_currency = 'USD'
              AND er.date = ${table}.date
          )
      `).run(store, startDate, endDate);

      totalCandidates += candidateRows;
      totalConvertible += convertibleRows;
      totalUpdated += updateResult.changes;

      perTable[table] = {
        candidates: candidateRows,
        convertible: convertibleRows,
        updated: updateResult.changes
      };
    }
  });

  tx();

  return {
    perTable,
    totals: {
      candidates: totalCandidates,
      convertible: totalConvertible,
      updated: totalUpdated
    }
  };
}

export { EXCHANGE_APPLY_TABLES };
