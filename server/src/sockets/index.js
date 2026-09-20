import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { env, corsOrigins } from '../config/env.js';
import { redis } from '../config/redis.js';

let io = null;

/**
 * Initialize Socket.io on the HTTP server.
 * Call once from server.js.
 */
export const initSocketIO = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // Redis adapter: without this, room broadcasts (io.to(room).emit(...)) only
  // reach sockets connected to *this* process. That's invisible with a single
  // instance, but the moment you run >1 ECS task behind an ALB, a guardian's
  // socket on task A silently never receives a location update whose insert
  // landed on task B. The adapter fans broadcasts out over Redis pub/sub so
  // every instance's sockets stay in sync regardless of which task a
  // connection lands on.
  const pubClient = redis.duplicate();
  const subClient = pubClient.duplicate();

  Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      console.log('🔌 Socket.IO Redis adapter connected — safe to run multiple instances');
    })
    .catch((err) => {
      console.error(
        '❌ Socket.IO Redis adapter failed to connect — falling back to single-instance, in-memory rooms:',
        err.message
      );
    });

  // JWT authentication middleware for WebSocket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Authentication required. Provide token in socket.handshake.auth.token'));
    }

    try {
      const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
      socket.userId = decoded.id;
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token.'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId } = socket;
    console.log(`🔌 Socket connected: userId=${userId}`);

    // Auto-join personal SOS room and private User room
    socket.join(`sos:${userId}`);
    socket.join(`user:${userId}`);

    // Fetch and join rooms for everyone this user is a guardian for
    try {
      const { db } = await import('../config/db.js');
      const result = await db.query(
        `SELECT user_id FROM guardian_circles
         WHERE guardian_id = $1 AND status = 'accepted'`,
        [userId]
      );
      result.rows.forEach(row => {
        socket.join(`sos:${row.user_id}`);
      });
      console.log(`👥 User ${userId} auto-joined ${result.rows.length} guardian rooms`);
    } catch (err) {
      console.error(`[Socket] Failed to auto-join guardian rooms for user ${userId}:`, err.message);
    }

    // Register SOS room handlers
    socket.on('sos:join', ({ targetUserId }) => {
      socket.join(`sos:${targetUserId}`);
      console.log(`👀 User ${userId} joined SOS room for user ${targetUserId}`);
    });

    socket.on('sos:leave', ({ targetUserId }) => {
      socket.leave(`sos:${targetUserId}`);
    });

    // Register map/location tracking handlers
    socket.on('map:join-sos', async ({ sosEventId }) => {
      socket.join(`map:${sosEventId}`);
      console.log(`🗺️  User ${userId} joined map room sos:${sosEventId}`);

      // Emit last 10 pings as catch-up for the joining client
      try {
        const { db } = await import('../config/db.js');
        const result = await db.query(
          `SELECT
             ST_X(coordinates::geometry) AS longitude,
             ST_Y(coordinates::geometry) AS latitude,
             accuracy, pinged_at
           FROM location_pings
           WHERE sos_event_id = $1
           ORDER BY pinged_at DESC
           LIMIT 10`,
          [sosEventId]
        );
        socket.emit('map:catch-up', {
          sosEventId,
          pings: result.rows.reverse(),
        });
      } catch (err) {
        console.error('[Socket] map:join-sos catch-up error:', err.message);
      }
    });

    socket.on('map:location-update', async ({ sosEventId, lat, lng, accuracy }) => {
      const isValidCoord =
        typeof sosEventId === 'string' && sosEventId.length > 0 &&
        Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        Number.isFinite(lng) && lng >= -180 && lng <= 180 &&
        (accuracy === undefined || accuracy === null || Number.isFinite(accuracy));

      if (!isValidCoord) {
        console.warn(`[Socket] Rejected invalid map:location-update payload from userId=${userId}`);
        return;
      }

      try {
        const { db } = await import('../config/db.js');

        // Only the SOS owner's own socket may post pings into their event —
        // otherwise any connected user could inject fake location data.
        const ownerCheck = await db.query(
          `SELECT 1 FROM sos_events WHERE id = $1 AND user_id = $2`,
          [sosEventId, userId]
        );
        if (ownerCheck.rows.length === 0) {
          console.warn(`[Socket] Rejected map:location-update — userId=${userId} is not the owner of sosEventId=${sosEventId}`);
          return;
        }

        const coordinates = `SRID=4326;POINT(${lng} ${lat})`;
        await db.query(
          `INSERT INTO location_pings (sos_event_id, coordinates, accuracy)
           VALUES ($1, ST_GeomFromEWKT($2), $3)`,
          [sosEventId, coordinates, accuracy || null]
        );

        io.to(`map:${sosEventId}`).emit('map:position', {
          lat,
          lng,
          accuracy,
          timestamp: new Date().toISOString(),
          sosEventId,
        });
      } catch (err) {
        console.error('[Socket] map:location-update error:', err.message);
      }
    });

    socket.on('map:sos-resolved', ({ sosEventId }) => {
      io.to(`map:${sosEventId}`).emit('map:tracking-ended', { sosEventId });
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Socket disconnected: userId=${userId}, reason=${reason}`);
    });
  });

  return io;
};

/**
 * Emit an event to all sockets in a named room.
 * Used by services to broadcast without direct io reference.
 */
export const emitToRoom = (room, event, data) => {
  if (!io) {
    console.warn(`[Socket] emitToRoom called before Socket.io initialized: room=${room} event=${event}`);
    return;
  }
  io.to(room).emit(event, data);
};

export const getIO = () => io;
