import api from './axios';

export const listEvidenceChunks = (sosEventId) =>
  api.get(`/evidence/${sosEventId}`).then(r => r.data.data);

/**
 * Fetches a short-lived playback URL for a single audio chunk (a normal
 * authenticated JSON call — the JWT goes in the Authorization header, never
 * in the URL). In S3 deployments this is a presigned S3 URL; locally it's a
 * signed link to the backend's fallback streaming route.
 */
export const getEvidenceChunkPlaybackUrl = (sosEventId, chunkId) =>
  api.get(`/evidence/${sosEventId}/chunk/${chunkId}`).then(({ data }) => {
    const { url } = data.data;
    // Presigned S3 URLs are already absolute; the local dev fallback route
    // is API-relative and needs the API origin prefixed for <audio src>.
    if (/^https?:\/\//i.test(url)) return url;
    const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    return `${apiOrigin}${url}`;
  });
