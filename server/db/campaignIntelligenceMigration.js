import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, 'intelligenceSchema.sql');

export function runCampaignIntelligenceMigration() {
  const db = getDb();
  console.log('[Campaign Intelligence] Applying schema...');

  try {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    console.log('[Campaign Intelligence] Schema ready');
  } catch (error) {
    console.error('[Campaign Intelligence] Migration failed:', error.message);
    throw error;
  }
}
