import multer from 'multer';
import multerS3 from 'multer-s3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, DeleteObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

const PLAYBACK_URL_TTL_SECONDS = 120;

const UPLOAD_BASE = process.env.UPLOAD_DIR || './uploads';
const maxSizeMB = parseInt(process.env.MAX_EVIDENCE_CHUNK_SIZE_MB || '10', 10);
const allowedMimeTypes = ['audio/webm', 'audio/ogg', 'video/webm', 'audio/mp4', 'video/mp4'];

/**
 * Evidence storage mode is decided once, at boot, by whether an S3 bucket is
 * configured. Production (ECS/Fargate) deployments MUST set EVIDENCE_S3_BUCKET —
 * local container disk is ephemeral and doesn't survive a restart or a second
 * task instance. Local dev/docker-compose can omit it and fall back to disk.
 */
export const isS3Storage = Boolean(env.EVIDENCE_S3_BUCKET);

const s3Client = isS3Storage ? new S3Client({ region: env.AWS_REGION }) : null;

const extFor = (mimetype) =>
  mimetype.includes('webm') ? '.webm'
  : mimetype.includes('ogg')  ? '.ogg'
  : mimetype.includes('mp4')  ? '.mp4'
  : '.audio';

export const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
};

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sosEventId = req.params.sosEventId || req.body.sosEventId;
    const dir = path.join(UPLOAD_BASE, 'evidence', sosEventId);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `chunk_${Date.now()}_${uuidv4().slice(0, 8)}${extFor(file.mimetype)}`);
  },
});

const s3Storage = isS3Storage
  ? multerS3({
      s3: s3Client,
      bucket: env.EVIDENCE_S3_BUCKET,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (req, file, cb) => {
        const sosEventId = req.params.sosEventId || req.body.sosEventId;
        const key = `evidence/${sosEventId}/chunk_${Date.now()}_${uuidv4().slice(0, 8)}${extFor(file.mimetype)}`;
        cb(null, key);
      },
    })
  : null;

export const evidenceUpload = multer({
  storage: isS3Storage ? s3Storage : diskStorage,
  limits: { fileSize: maxSizeMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, allowedMimeTypes.includes(file.mimetype));
  },
});

/**
 * Given a multer file object (S3 or disk mode), return the identifier to
 * persist in evidence_recordings.file_path — an S3 key or a local path.
 */
export const getStoredFileRef = (file) => (isS3Storage ? file.key : file.path);

/**
 * Generate a short-lived presigned S3 GET URL for playback (S3 mode only).
 */
export const getPresignedEvidenceUrl = async (key, expiresIn = PLAYBACK_URL_TTL_SECONDS) => {
  const command = new GetObjectCommand({ Bucket: env.EVIDENCE_S3_BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Local-disk fallback (dev only): a short-lived signed URL for the /raw
 * streaming route, so an <audio src> never has to carry the user's real
 * JWT (which would otherwise leak into browser history / access logs).
 * On S3, the presigned URL above serves the same purpose.
 */
const signPlaybackPayload = (chunkId, exp) =>
  crypto.createHmac('sha256', env.ACCESS_TOKEN_SECRET).update(`${chunkId}.${exp}`).digest('hex');

export const getLocalPlaybackPath = (sosEventId, chunkId) => {
  const exp = Date.now() + PLAYBACK_URL_TTL_SECONDS * 1000;
  const sig = signPlaybackPayload(chunkId, exp);
  return `/api/evidence/${sosEventId}/chunk/${chunkId}/raw?exp=${exp}&sig=${sig}`;
};

export const verifyLocalPlaybackToken = (chunkId, exp, sig) => {
  if (!exp || !sig) return false;
  if (Date.now() > Number(exp)) return false;
  const expected = signPlaybackPayload(chunkId, exp);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
};

/**
 * Delete a batch of evidence files by their stored refs (S3 keys or local paths).
 */
export const deleteStoredFiles = async (refs) => {
  if (refs.length === 0) return { deletedCount: 0 };

  if (isS3Storage) {
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: env.EVIDENCE_S3_BUCKET,
        Delete: { Objects: refs.map((key) => ({ Key: key })) },
      })
    );
    return { deletedCount: refs.length };
  }

  let deletedCount = 0;
  for (const filePath of refs) {
    try {
      fs.unlinkSync(filePath);
      deletedCount++;
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('[Storage] Delete file error:', e.message);
    }
  }
  return { deletedCount };
};
