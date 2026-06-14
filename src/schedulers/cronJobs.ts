import cron from 'node-cron';
import { generateNewsScript } from '../services/scriptGenerator';

export function initScheduler(): void {
  // Morning edition — 07:00 UK time
  cron.schedule('0 7 * * *', async () => {
    console.log('[Scheduler] Generating Morning Edition...');
    try {
      const scriptId = await generateNewsScript('MORNING');
      console.log(`[Scheduler] Morning Edition generated: ${scriptId}`);
    } catch (err) {
      console.error('[Scheduler] Morning Edition failed:', err);
    }
  }, { timezone: 'Europe/London' });

  // Evening edition — 20:00 UK time
  cron.schedule('0 20 * * *', async () => {
    console.log('[Scheduler] Generating Evening Edition...');
    try {
      const scriptId = await generateNewsScript('EVENING');
      console.log(`[Scheduler] Evening Edition generated: ${scriptId}`);
    } catch (err) {
      console.error('[Scheduler] Evening Edition failed:', err);
    }
  }, { timezone: 'Europe/London' });

  console.log('[Scheduler] Jobs initialised — Morning: 07:00 UK | Evening: 20:00 UK');
}
