import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'finance.db');

export async function runMigration() {
  console.log('🔧 Running AIBudget Schema Migration...');

  // Open database synchronously to avoid sqlite3 dependency issues
  const db = new Database(dbPath);

  try {
    const hasAnalyticsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analytics'")
      .get();

    if (!hasAnalyticsTable) {
      console.warn('⚠️  Skipping AIBudget migration: analytics table does not exist yet.');
      return;
    }

    const columns = db.prepare('PRAGMA table_info(analytics)').all();
    const columnNames = columns.map(col => col.name);

    // Define new columns needed for AIBudget
    const newColumns = {
      country: 'TEXT',
      atc: 'INTEGER DEFAULT 0',
      ic: 'INTEGER DEFAULT 0',
      frequency: 'REAL DEFAULT 0',
      adset_name: 'TEXT',
      adset_id: 'TEXT',
      effective_status: 'TEXT',
      budget_remaining: 'REAL DEFAULT 0'
    };

    const columnsToAdd = Object.entries(newColumns)
      .filter(([name]) => !columnNames.includes(name))
      .map(([name, type]) => ({ name, type }));

    if (columnsToAdd.length === 0) {
      console.log('✅ All columns already exist. No migration needed.');
      return;
    }

    console.log(`📊 Adding ${columnsToAdd.length} new columns to analytics table...`);

    const addColumn = db.prepare('ALTER TABLE analytics ADD COLUMN @name @type');
    for (const col of columnsToAdd) {
      try {
        addColumn.run({ name: col.name, type: col.type });
        console.log(`✅ Added column: ${col.name}`);
      } catch (err) {
        // If column already exists (race condition), skip and continue
        if (!/duplicate column/i.test(err.message)) {
          throw err;
        }
      }
    }

    // Create index for country for faster geo queries
    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_country ON analytics(country)');
    } catch (err) {
      console.error('Warning: Could not create country index:', err);
    }

    console.log('🎉 Migration completed successfully!');
  } finally {
    db.close();
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Migration failed:', err);
      process.exit(1);
    });
}

