import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireEvidenceAccess } from '../middleware/evidenceAccess.middleware.js';
import { evidenceUpload } from '../config/storage.js';
import {
  uploadChunk,
  listChunks,
  getChunkUrl,
  streamChunkRaw,
  deleteEvidence,
} from '../controllers/evidence.controller.js';

const router = express.Router();

/**
 * POST /api/evidence/:sosEventId/chunk
 * Upload a 30-second audio chunk — SOS owner only.
 */
router.post(
  '/:sosEventId/chunk',
  authenticate,
  requireEvidenceAccess('owner'),
  evidenceUpload.single('chunk'),
  uploadChunk
);

/**
 * GET /api/evidence/:sosEventId
 * List chunk metadata — owner, guardians, admins.
 */
router.get(
  '/:sosEventId',
  authenticate,
  requireEvidenceAccess('viewer'),
  listChunks
);

/**
 * GET /api/evidence/:sosEventId/chunk/:chunkId
 * Returns a short-lived playback URL (presigned S3 URL, or a signed /raw
 * link in local-disk dev mode) — owner, guardians, admins.
 */
router.get(
  '/:sosEventId/chunk/:chunkId',
  authenticate,
  requireEvidenceAccess('viewer'),
  getChunkUrl
);

/**
 * GET /api/evidence/:sosEventId/chunk/:chunkId/raw?exp=&sig=
 * Local-disk dev-mode only — the actual byte stream, gated by a short-lived
 * signed token (not a JWT) since <audio src> can't send an auth header.
 * Never used when EVIDENCE_S3_BUCKET is set (S3 mode uses presigned URLs).
 */
router.get(
  '/:sosEventId/chunk/:chunkId/raw',
  streamChunkRaw
);

/**
 * DELETE /api/evidence/:sosEventId
 * Delete all evidence — admin only.
 */
router.delete(
  '/:sosEventId',
  authenticate,
  requireEvidenceAccess('admin'),
  deleteEvidence
);

export default router;
