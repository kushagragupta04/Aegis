import { db } from '../config/db.js';

/**
 * Access control middleware for SOS event routes.
 *
 * role = 'owner'  → must be the SOS event's owner (e.g. posting a location ping)
 * role = 'viewer' → owner OR accepted guardian OR admin (e.g. reading location/event details)
 *
 * Mirrors evidenceAccess.middleware.js — SOS routes previously had no equivalent
 * check, meaning any authenticated user who knew a sosEventId could read or
 * write another person's live location.
 *
 * Attaches req.sosEvent on success.
 */
export const requireSosAccess = (role) => async (req, res, next) => {
  try {
    const { eventId } = req.params;

    const eventResult = await db.query(
      `SELECT id, user_id FROM sos_events WHERE id = $1`,
      [eventId]
    );

    if (!eventResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'SOS event not found' });
    }

    const sosEvent = eventResult.rows[0];
    req.sosEvent = sosEvent;

    const currentUserId = req.user.id;
    const isOwner = sosEvent.user_id === currentUserId;

    if (role === 'owner') {
      if (!isOwner) {
        return res.status(403).json({ success: false, message: 'Access denied: not the SOS owner' });
      }
      return next();
    }

    // role === 'viewer'
    if (isOwner || req.user.role === 'admin') return next();

    const guardianResult = await db.query(
      `SELECT 1 FROM guardian_circles
       WHERE user_id = $1 AND guardian_id = $2 AND status = 'accepted'`,
      [sosEvent.user_id, currentUserId]
    );

    if (guardianResult.rows.length > 0) return next();

    return res.status(403).json({
      success: false,
      message: 'Access denied: must be the SOS owner, an accepted guardian, or an admin',
    });
  } catch (err) {
    next(err);
  }
};
