import { initDb } from '../db/database.js';
import { runCampaignIntelligenceDailyTrainer } from '../services/campaignIntelligence/trainer.js';

async function main() {
  initDb();
  const store = process.env.CI_TRAINER_STORE || null;
  const result = await runCampaignIntelligenceDailyTrainer({ store });
  console.log('[Campaign Intelligence Trainer] Run complete');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[Campaign Intelligence Trainer] Failed:', error?.message || error);
  process.exitCode = 1;
});
