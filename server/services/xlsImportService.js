import * as XLSX from 'xlsx';
import { getDb } from '../db/database.js';
import path from 'path';

// Meta Ads Manager column mappings (handles various export formats)
const COLUMN_MAPPINGS = {
  // Date columns
  date: ['Day', 'Date', 'Reporting starts', 'Reporting ends', 'date', 'day'],

  // Campaign info
  campaign_id: ['Campaign ID', 'campaign_id', 'Campaign id'],
  campaign_name: ['Campaign name', 'Campaign Name', 'campaign_name', 'Campaign'],

  // Breakdown columns
  country: ['Country', 'country', 'Country/Region', 'Region'],
  age: ['Age', 'age'],
  gender: ['Gender', 'gender'],
  publisher_platform: ['Publisher platform', 'Platform', 'publisher_platform'],
  platform_position: ['Platform position', 'Placement', 'platform_position', 'Impression device'],

  // Spend & Performance
  spend: ['Amount spent', 'Spend', 'spend', 'Amount Spent (USD)', 'Amount Spent (SAR)', 'Amount Spent (TRY)', 'Cost'],
  impressions: ['Impressions', 'impressions', 'Impr.'],
  reach: ['Reach', 'reach'],
  clicks: ['Clicks (all)', 'Link clicks', 'Clicks', 'clicks'],

  // Calculated metrics
  cpm: ['CPM (cost per 1,000 impressions)', 'CPM', 'cpm'],
  cpc: ['CPC (cost per link click)', 'CPC (all)', 'CPC', 'cpc'],
  ctr: ['CTR (link click-through rate)', 'CTR (all)', 'CTR', 'ctr'],
  frequency: ['Frequency', 'frequency'],

  // Funnel metrics
  landing_page_views: ['Landing page views', 'Landing Page Views', 'LP views', 'lpv'],
  add_to_cart: ['Adds to cart', 'Add to cart', 'ATC', 'atc'],
  checkouts_initiated: ['Checkouts initiated', 'Initiate checkout', 'Checkout', 'checkouts'],

  // Conversions
  conversions: ['Purchases', 'Results', 'Conversions', 'conversions', 'Purchase'],
  conversion_value: ['Purchase conversion value', 'Conversion value', 'Purchase ROAS', 'Revenue', 'conversion_value', 'Website purchases conversion value']
};

// Country code mapping for common country names
const COUNTRY_NAME_TO_CODE = {
  'Saudi Arabia': 'SA',
  'United States': 'US',
  'United Arab Emirates': 'AE',
  'Turkey': 'TR',
  'Egypt': 'EG',
  'Kuwait': 'KW',
  'Qatar': 'QA',
  'Bahrain': 'BH',
  'Oman': 'OM',
  'Jordan': 'JO',
  'Lebanon': 'LB',
  'Iraq': 'IQ',
  'Morocco': 'MA',
  'Algeria': 'DZ',
  'Tunisia': 'TN',
  'Libya': 'LY',
  'United Kingdom': 'GB',
  'Germany': 'DE',
  'France': 'FR',
  'Canada': 'CA',
  'Australia': 'AU',
  'India': 'IN',
  'Pakistan': 'PK',
  'Malaysia': 'MY',
  'Indonesia': 'ID',
  'Philippines': 'PH',
  'Unknown': 'ZZ'
};

/**
 * Parse a date string from various formats
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  // Handle various date formats
  const str = String(dateStr).trim();

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // DD/MM/YYYY or MM/DD/YYYY (try to detect)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    // Assume DD/MM/YYYY for Meta exports (European format)
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }

  // Excel serial date number
  if (!isNaN(str) && parseFloat(str) > 40000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + parseFloat(str) * 86400000);
    return date.toISOString().split('T')[0];
  }

  // Try Date.parse as fallback
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Parse a numeric value, handling various formats
 */
function parseNumber(value, defaultValue = 0) {
  if (value === null || value === undefined || value === '' || value === '-') {
    return defaultValue;
  }

  // Remove currency symbols, commas, and percentage signs
  const cleaned = String(value)
    .replace(/[,$%€£¥₺﷼]/g, '')
    .replace(/\s/g, '')
    .trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Map a header to a known field
 */
function mapHeader(header) {
  const normalizedHeader = String(header).trim();

  for (const [field, aliases] of Object.entries(COLUMN_MAPPINGS)) {
    if (aliases.some(alias =>
      alias.toLowerCase() === normalizedHeader.toLowerCase() ||
      normalizedHeader.toLowerCase().includes(alias.toLowerCase())
    )) {
      return field;
    }
  }

  return null;
}

/**
 * Get country code from country name or code
 */
function getCountryCode(value) {
  if (!value) return 'ZZ';

  const str = String(value).trim();

  // Already a 2-letter code
  if (/^[A-Z]{2}$/.test(str.toUpperCase())) {
    return str.toUpperCase();
  }

  // Try to map from name
  return COUNTRY_NAME_TO_CODE[str] || 'ZZ';
}

/**
 * Detect the breakdown type from the data
 */
function detectBreakdownType(headers) {
  const mappedHeaders = headers.map(h => mapHeader(h));

  if (mappedHeaders.includes('publisher_platform') || mappedHeaders.includes('platform_position')) {
    return 'placement';
  }
  if (mappedHeaders.includes('age') && mappedHeaders.includes('gender')) {
    return 'age_gender';
  }
  if (mappedHeaders.includes('age')) {
    return 'age';
  }
  if (mappedHeaders.includes('gender')) {
    return 'gender';
  }
  if (mappedHeaders.includes('country')) {
    return 'country';
  }
  return 'campaign';
}

/**
 * Parse XLS/XLSX file and return structured data
 */
export async function parseXlsFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to JSON with headers
  const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rawData.length === 0) {
    throw new Error('No data found in the file');
  }

  // Get headers from first row keys
  const headers = Object.keys(rawData[0]);
  const breakdownType = detectBreakdownType(headers);

  // Map headers to fields
  const headerMap = {};
  headers.forEach(header => {
    const field = mapHeader(header);
    if (field) {
      headerMap[header] = field;
    }
  });

  // Parse rows
  const rows = [];
  const dates = new Set();

  for (const rawRow of rawData) {
    const row = {};

    // Map each column
    for (const [header, value] of Object.entries(rawRow)) {
      const field = headerMap[header];
      if (field) {
        if (field === 'date') {
          row[field] = parseDate(value);
          if (row[field]) dates.add(row[field]);
        } else if (field === 'country') {
          row[field] = getCountryCode(value);
        } else if (['spend', 'cpm', 'cpc', 'ctr', 'frequency', 'conversion_value'].includes(field)) {
          row[field] = parseNumber(value);
        } else if (['impressions', 'reach', 'clicks', 'landing_page_views', 'add_to_cart', 'checkouts_initiated', 'conversions'].includes(field)) {
          row[field] = Math.round(parseNumber(value));
        } else {
          row[field] = String(value).trim();
        }
      }
    }

    // Skip rows without date or campaign info
    if (!row.date) continue;

    // Generate campaign_id if not present
    if (!row.campaign_id) {
      row.campaign_id = row.campaign_name ?
        `imported_${row.campaign_name.replace(/\s+/g, '_').toLowerCase()}` :
        `imported_${Date.now()}`;
    }

    // Default campaign name if not present
    if (!row.campaign_name) {
      row.campaign_name = 'Imported Campaign';
    }

    rows.push(row);
  }

  // Get date range
  const sortedDates = Array.from(dates).sort();
  const dateFrom = sortedDates[0] || null;
  const dateTo = sortedDates[sortedDates.length - 1] || dateFrom;

  return {
    rows,
    headers: Object.values(headerMap),
    breakdownType,
    dateFrom,
    dateTo,
    recordCount: rows.length
  };
}

/**
 * Import parsed data into the database
 */
export async function importXlsData(store, parsedData, originalFilename, notes = '') {
  const db = getDb();

  const { rows, breakdownType, dateFrom, dateTo, recordCount } = parsedData;

  if (rows.length === 0) {
    throw new Error('No valid data to import');
  }

  // Create import record
  const importStmt = db.prepare(`
    INSERT INTO meta_xls_imports (store, filename, original_filename, date_from, date_to, records_count, breakdown_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const filename = `import_${Date.now()}.xlsx`;
  const result = importStmt.run(store, filename, originalFilename, dateFrom, dateTo, recordCount, breakdownType, notes);
  const importId = result.lastInsertRowid;

  // Prepare insert statement for metrics
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO meta_daily_metrics (
      store, date, campaign_id, campaign_name, country, age, gender,
      publisher_platform, platform_position, spend, impressions, reach,
      clicks, landing_page_views, add_to_cart, checkouts_initiated,
      conversions, conversion_value, cpm, cpc, ctr, frequency, import_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Insert in a transaction for performance
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      insertStmt.run(
        store,
        row.date,
        row.campaign_id,
        row.campaign_name,
        row.country || 'ALL',
        row.age || '',
        row.gender || '',
        row.publisher_platform || '',
        row.platform_position || '',
        row.spend || 0,
        row.impressions || 0,
        row.reach || 0,
        row.clicks || 0,
        row.landing_page_views || 0,
        row.add_to_cart || 0,
        row.checkouts_initiated || 0,
        row.conversions || 0,
        row.conversion_value || 0,
        row.cpm || 0,
        row.cpc || 0,
        row.ctr || 0,
        row.frequency || 0,
        importId
      );
    }
  });

  insertMany(rows);

  return {
    importId,
    filename,
    originalFilename,
    dateFrom,
    dateTo,
    recordCount,
    breakdownType
  };
}

/**
 * Get all imports for a store
 */
export function getImports(store) {
  const db = getDb();

  const stmt = db.prepare(`
    SELECT id, store, filename, original_filename, date_from, date_to,
           records_count, breakdown_type, notes, created_at
    FROM meta_xls_imports
    WHERE store = ?
    ORDER BY created_at DESC
  `);

  return stmt.all(store);
}

/**
 * Get a single import by ID
 */
export function getImportById(importId) {
  const db = getDb();

  const stmt = db.prepare(`
    SELECT id, store, filename, original_filename, date_from, date_to,
           records_count, breakdown_type, notes, created_at
    FROM meta_xls_imports
    WHERE id = ?
  `);

  return stmt.get(importId);
}

/**
 * Delete an import and all associated data
 */
export function deleteImport(importId, store) {
  const db = getDb();

  // Verify the import belongs to the store
  const importRecord = getImportById(importId);
  if (!importRecord) {
    throw new Error('Import not found');
  }
  if (importRecord.store !== store) {
    throw new Error('Import does not belong to this store');
  }

  // Delete in transaction
  const deleteTransaction = db.transaction(() => {
    // Delete associated metrics
    const deleteMetrics = db.prepare(`
      DELETE FROM meta_daily_metrics WHERE import_id = ?
    `);
    deleteMetrics.run(importId);

    // Delete import record
    const deleteImport = db.prepare(`
      DELETE FROM meta_xls_imports WHERE id = ?
    `);
    deleteImport.run(importId);
  });

  deleteTransaction();

  return { success: true, deletedImportId: importId };
}

/**
 * Preview XLS file without importing
 */
export async function previewXlsFile(filePath, maxRows = 10) {
  const parsed = await parseXlsFile(filePath);

  return {
    headers: parsed.headers,
    breakdownType: parsed.breakdownType,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    totalRecords: parsed.recordCount,
    sampleRows: parsed.rows.slice(0, maxRows)
  };
}
