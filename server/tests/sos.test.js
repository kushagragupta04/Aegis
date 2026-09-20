import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_SECRET = 'test_access_secret_at_least_32_characters_long';
const REFRESH_TOKEN_SECRET = 'test_refresh_secret_at_least_32_characters_long';

process.env.ACCESS_TOKEN_SECRET = ACCESS_TOKEN_SECRET;
process.env.REFRESH_TOKEN_SECRET = REFRESH_TOKEN_SECRET;
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// NOTE: with native ESM (`--experimental-vm-modules`), Jest's module linker can
// invoke a jest.unstable_mockModule factory more than once across a large,
// multi-branch import graph (e.g. every controller/middleware that imports
// db.js). If the factory returned a fresh object each time, different files
// would silently receive *different* `db.query` jest.fn() instances, so
// mockResolvedValueOnce() calls in a test would never reach the mock that a
// deeper middleware/service actually uses. Memoizing into a singleton makes
// every consumer share the exact same mock regardless of invocation count.
let dbMockSingleton;
jest.unstable_mockModule('../src/config/db.js', () => {
  if (!dbMockSingleton) {
    dbMockSingleton = {
      db: {
        query: jest.fn(),
        end: jest.fn(),
      },
      testConnection: jest.fn().mockResolvedValue(true),
    };
  }
  return dbMockSingleton;
});

jest.unstable_mockModule('../src/config/redis.js', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn(),
  },
  bullmqRedis: { disconnect: jest.fn() },
}));

jest.unstable_mockModule('../src/jobs/queues.js', () => ({
  alertQueue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }) },
  incidentQueue: { add: jest.fn().mockResolvedValue({ id: 'job-2' }) },
}));

jest.unstable_mockModule('../src/sockets/index.js', () => ({
  initSocketIO: jest.fn(),
  emitToRoom: jest.fn(),
  getIO: jest.fn(),
}));

jest.unstable_mockModule('../src/services/map.service.js', () => ({
  getNearestPlace: jest.fn().mockResolvedValue(null),
  findNearbyPlaces: jest.fn().mockResolvedValue([]),
  getRoute: jest.fn(),
  reverseGeocode: jest.fn(),
  getLivePings: jest.fn(),
}));

jest.unstable_mockModule('../src/config/firebase.js', () => ({
  firebase: null,
  messaging: null,
}));

const { default: request } = await import('supertest');
const { default: app } = await import('../src/app.js');
const { db: mockDb } = await import('../src/config/db.js');

const SOS_EVENT = {
  id: 'sos-event-uuid-1234',
  user_id: 'user-uuid-1234',
  status: 'active',
  triggered_at: new Date().toISOString(),
  notes: null,
};

const makeAccessToken = (role = 'user') =>
  jwt.sign(
    { id: 'user-uuid-1234', email: 'test@example.com', role, name: 'Test User' },
    ACCESS_TOKEN_SECRET,
    { expiresIn: '15m' }
  );

describe('POST /api/sos/trigger', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 201 with sosEventId when authenticated', async () => {
    // triggerSOS: insert sos_event + fetch guardians + insert initial location ping
    mockDb.query
      .mockResolvedValueOnce({ rows: [SOS_EVENT] })  // INSERT sos_events
      .mockResolvedValueOnce({ rows: [] })            // fetch guardians (empty)
      .mockResolvedValueOnce({ rows: [] });           // INSERT initial location ping

    const token = makeAccessToken();
    const res = await request(app)
      .post('/api/sos/trigger')
      .set('Authorization', `Bearer ${token}`)
      .send({ latitude: 40.712776, longitude: -74.005974 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('sosEventId');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/sos/trigger')
      .send({ latitude: 40.712776, longitude: -74.005974 });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 for invalid coordinates', async () => {
    const token = makeAccessToken();
    const res = await request(app)
      .post('/api/sos/trigger')
      .set('Authorization', `Bearer ${token}`)
      .send({ latitude: 999, longitude: -74.005974 }); // lat out of range

    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/sos/:eventId/resolve', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 and resolved status when event belongs to user', async () => {
    const resolvedEvent = { ...SOS_EVENT, status: 'resolved', resolved_at: new Date().toISOString() };
    mockDb.query.mockResolvedValueOnce({ rows: [resolvedEvent] });

    const token = makeAccessToken();
    const res = await request(app)
      .patch(`/api/sos/${SOS_EVENT.id}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.event.status).toBe('resolved');
  });

  it('returns 404 when event not found or already resolved', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // no match

    const token = makeAccessToken();
    const res = await request(app)
      .patch('/api/sos/nonexistent-id/resolve')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

describe('GET /api/sos/:eventId — access control', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 for the SOS owner', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [SOS_EVENT] }); // requireSosAccess lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ ...SOS_EVENT, name: 'Test User', phone: '+10000000000' }] }); // getSOSEvent

    const token = makeAccessToken(); // id: user-uuid-1234, same as SOS_EVENT.user_id
    const res = await request(app)
      .get(`/api/sos/${SOS_EVENT.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('returns 403 for an unrelated authenticated user who is not a guardian', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [SOS_EVENT] }); // requireSosAccess lookup — owner is user-uuid-1234
    mockDb.query.mockResolvedValueOnce({ rows: [] });          // guardian_circles lookup — not a guardian

    const strangerToken = jwt.sign(
      { id: 'stranger-uuid-9999', email: 'stranger@example.com', role: 'user', name: 'Stranger' },
      ACCESS_TOKEN_SECRET,
      { expiresIn: '15m' }
    );

    const res = await request(app)
      .get(`/api/sos/${SOS_EVENT.id}`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent SOS event', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // requireSosAccess lookup — no event

    const token = makeAccessToken();
    const res = await request(app)
      .get('/api/sos/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/sos/:eventId/location — access control', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 when a non-owner tries to post a location ping', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [SOS_EVENT] }); // requireSosAccess('owner') lookup

    const strangerToken = jwt.sign(
      { id: 'stranger-uuid-9999', email: 'stranger@example.com', role: 'user', name: 'Stranger' },
      ACCESS_TOKEN_SECRET,
      { expiresIn: '15m' }
    );

    const res = await request(app)
      .post(`/api/sos/${SOS_EVENT.id}/location`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ latitude: 40.712776, longitude: -74.005974 });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/sos/history', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns paginated array of SOS events', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [SOS_EVENT] })  // events
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }); // count

    const token = makeAccessToken();
    const res = await request(app)
      .get('/api/sos/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(1);
  });
});
