import { Router } from 'express';
import * as sosController from '../controllers/sos.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { requireSosAccess } from '../middleware/sosAccess.middleware.js';
import { sosLimiter } from '../middleware/rateLimiter.middleware.js';
import { triggerSOSSchema, locationPingSchema, resolveSOSSchema } from '../validators/schemas.js';

const router = Router();

// All SOS routes require authentication
router.use(authenticate);

// GET /api/sos/history  — must be before /:eventId routes
router.get('/history', sosController.getHistory);

// POST /api/sos/trigger
router.post('/trigger', sosLimiter, validate(triggerSOSSchema), sosController.trigger);

// POST /api/sos/:eventId/location  — only the SOS owner may post their own location
router.post(
  '/:eventId/location',
  requireSosAccess('owner'),
  validate(locationPingSchema),
  sosController.addLocation
);

// GET /api/sos/:eventId/location  — owner, accepted guardians, or admins
router.get('/:eventId/location', requireSosAccess('viewer'), sosController.getLatestLocation);

// GET /api/sos/:eventId  — owner, accepted guardians, or admins
router.get('/:eventId', requireSosAccess('viewer'), sosController.getEvent);

// PATCH /api/sos/:eventId/resolve
router.patch('/:eventId/resolve', sosController.resolve);

export default router;
