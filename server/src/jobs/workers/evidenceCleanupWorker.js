import { Worker } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { bullmqRedis } from '../../config/redis.js';
import { db } from '../../config/db.js';
import { isS3Storage, deleteStoredFiles } from '../../config/storage.js';
import { evidenceCleanupQueue } from '../queues.js';

const UPLOAD_BASE = process.env.UPLOAD_DIR || './uploads';
const RETENTION_DAYS = parseInt(process.env.EVIDENCE_RETENTION_DAYS || '30', 10);

/**
 * Evidence cleanup worker — runs daily via BullMQ cron.
 * Deletes audio files (S3 objects or local disk) and DB records older than
 * RETENTION_DAYS.
 */
const evidenceCleanupWorker = new Worker(
  'evidenceCleanup',
  async (job) => {
    console.log(`[EvidenceCleanup] Starting cleanup — retaining last ${RETENTION_DAYS} days`);

    const result = await db.query(
      `SELECT id, file_path FROM evidence_recordings
       WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
    );

    if (result.rows.length === 0) {
      console.log('[EvidenceCleanup] Nothing to clean up');
      return;
    }

    // Track sosEventIds so local-disk mode can clean up now-empty directories
    const sosEventIds = new Set();
    if (!isS3Storage) {
      for (const row of result.rows) {
        const parts = row.file_path.split(path.sep);
        const evidenceIdx = parts.indexOf('evidence');
        if (evidenceIdx >= 0 && parts[evidenceIdx + 1]) {
          sosEventIds.add(parts[evidenceIdx + 1]);
        }
      }
    }

    const { deletedCount } = await deleteStoredFiles(result.rows.map((r) => r.file_path));

    // Delete stale DB records
    await db.query(
      `DELETE FROM evidence_recordings
       WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
    );

    // Attempt to clean up empty event directories (local-disk mode only)
    for (const eventId of sosEventIds) {
      const dir = path.join(UPLOAD_BASE, 'evidence', eventId);
      try {
        const remaining = fs.readdirSync(dir);
        if (remaining.length === 0) fs.rmdirSync(dir);
      } catch {
        /* ignore */
      }
    }

    console.log(`[EvidenceCleanup] Done. Deleted ${deletedCount} files.`);
  },
  { connection: bullmqRedis }
);

evidenceCleanupWorker.on('failed', (job, err) => {
  console.error('[EvidenceCleanup] Job failed:', err.message);
});

// Schedule the cron job (2AM daily)
evidenceCleanupQueue.add(
  'cleanup',
  {},
  {
    repeat: { pattern: '0 2 * * *' },
    jobId: 'evidence-cleanup-cron', // stable ID prevents duplicate registrations
  }
).catch(err => console.warn('[EvidenceCleanup] Failed to schedule cron:', err.message));

export default evidenceCleanupWorker;
