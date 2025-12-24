function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function calculateBudgetCurve({ spend1, conv1, spend2, conv2, aov, margin, monthlyOverhead = 0 }) {
  const parsed = {
    spend1: Number(spend1),
    conv1: Number(conv1),
    spend2: Number(spend2),
    conv2: Number(conv2),
    aov: Number(aov),
    margin: Number(margin),
    monthlyOverhead: Number(monthlyOverhead)
  };

  if (!parsed.spend1 || !parsed.conv1 || !parsed.spend2 || !parsed.conv2 || !parsed.aov || !parsed.margin) {
    return { error: 'Missing required inputs for budget calculation.' };
  }

  if (parsed.spend1 >= parsed.spend2) {
    return { error: 'Test 2 spend must be higher than Test 1.' };
  }

  const dailyOverhead = parsed.monthlyOverhead / 30;
  const B = Math.log(parsed.conv2 / parsed.conv1) / Math.log(parsed.spend2 / parsed.spend1);
  const a = parsed.conv1 / Math.pow(parsed.spend1, B);
  const breakevenRoas = 1 / parsed.margin;

  let ceiling;
  if (B < 1) {
    ceiling = Math.pow(breakevenRoas / (a * parsed.aov), 1 / (B - 1));
  } else {
    ceiling = Infinity;
  }

  let realCeiling = ceiling;
  if (parsed.monthlyOverhead > 0 && B < 1) {
    let low = 1;
    let high = ceiling;
    for (let i = 0; i < 50; i += 1) {
      const mid = (low + high) / 2;
      const conv = a * Math.pow(mid, B);
      const profit = conv * parsed.aov * parsed.margin - mid;
      if (profit > dailyOverhead) {
        low = mid;
      } else {
        high = mid;
      }
    }
    realCeiling = (low + high) / 2;
  }

  let optimal;
  if (B < 1 && B > 0) {
    optimal = Math.pow(1 / (a * B * parsed.aov * parsed.margin), 1 / (B - 1));
  } else {
    optimal = Infinity;
  }

  const convAtOptimal = a * Math.pow(optimal, B);
  const revenueAtOptimal = convAtOptimal * parsed.aov;
  const profitAtOptimal = revenueAtOptimal * parsed.margin - optimal - dailyOverhead;

  return {
    B,
    a,
    ceiling,
    realCeiling,
    optimal,
    profitAtOptimal,
    dailyOverhead,
    monthlyOverhead: parsed.monthlyOverhead,
    inputs: parsed
  };
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return '∞';
  return `$${Math.round(value)}`;
}

function formatDateRange({ startDate, endDate }) {
  if (!startDate || !endDate) return 'n/a';
  return `${startDate} → ${endDate}`;
}

function safeDivide(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function summarizeCampaign(rows) {
  if (!rows || rows.length === 0) return null;
  const totals = rows.reduce(
    (acc, row) => {
      acc.spend += safeNumber(row.spend);
      acc.conversions += safeNumber(row.conversions);
      acc.revenue += safeNumber(row.revenue);
      acc.startDate = acc.startDate ? (acc.startDate < row.startDate ? acc.startDate : row.startDate) : row.startDate;
      acc.endDate = acc.endDate ? (acc.endDate > row.endDate ? acc.endDate : row.endDate) : row.endDate;
      return acc;
    },
    { spend: 0, conversions: 0, revenue: 0, startDate: null, endDate: null }
  );

  const start = new Date(totals.startDate);
  const end = new Date(totals.endDate);
  const days = totals.startDate && totals.endDate
    ? Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1
    : 0;

  return {
    ...totals,
    days,
    dailySpend: safeDivide(totals.spend, days),
    dailyConversions: safeDivide(totals.conversions, days),
    aov: safeDivide(totals.revenue, totals.conversions)
  };
}

export {
  calculateBudgetCurve,
  formatCurrency,
  formatDateRange,
  safeDivide,
  summarizeCampaign
};
