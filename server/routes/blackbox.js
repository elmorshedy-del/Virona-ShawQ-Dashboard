import express from 'express';
import {
  exportBlackboxEventsCsv,
  getBlackboxOverview,
  listBlackboxEvents,
  recordBlackboxEvent
} from '../services/blackboxService.js';

const router = express.Router();

const DEFAULT_STORE = 'shawq';
const MAX_BATCH_EVENTS = 50;

// Accept `navigator.sendBeacon()` default payloads (`text/plain`) without requiring callers
// to set JSON content-type. We parse JSON strings in `parseIngestPayload` below.
const INGEST_TEXT_LIMIT = '2mb';

router.use((req, res, next) => {
  // Avoid stale diagnostics when behind CDN/proxy caches.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
});

function normalizeStoreFromRequest(req) {
  return req?.query?.store || req?.body?.store || DEFAULT_STORE;
}

function normalizeBooleanFlag(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parseIngestPayload(body) {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) return [];
    try {
      // sendBeacon() often posts text/plain; allow JSON string bodies.
      // eslint-disable-next-line no-param-reassign
      body = JSON.parse(trimmed);
    } catch (_error) {
      return [];
    }
  }

  if (body && Buffer.isBuffer(body)) {
    try {
      // eslint-disable-next-line no-param-reassign
      body = JSON.parse(body.toString('utf8'));
    } catch (_error) {
      return [];
    }
  }

  if (!body || typeof body !== 'object') return [];

  if (Array.isArray(body)) {
    return body.slice(0, MAX_BATCH_EVENTS).filter((item) => item && typeof item === 'object');
  }

  if (Array.isArray(body.events)) {
    const { events, ...base } = body;
    return events
      .slice(0, MAX_BATCH_EVENTS)
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ ...base, ...item }));
  }

  return [body];
}

router.post('/ingest', express.text({ type: ['text/*'], limit: INGEST_TEXT_LIMIT }), (req, res) => {
  try {
    const items = parseIngestPayload(req.body);
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'Expected JSON event object or events[] payload' });
    }

    const store = normalizeStoreFromRequest(req);
    const results = [];
    const errors = [];

    items.forEach((item, index) => {
      try {
        const resolvedStore = item.store || store;
        const recorded = recordBlackboxEvent({ store: resolvedStore, payload: item, req });
        results.push(recorded);
      } catch (error) {
        errors.push({
          index,
          error: error?.message || String(error)
        });
      }
    });

    if (!results.length) {
      return res.status(500).json({
        success: false,
        error: 'No events were ingested',
        details: errors.slice(0, 5)
      });
    }

    res.json({
      success: true,
      inserted: results.length,
      rejected: errors.length,
      events: results,
      errors: normalizeBooleanFlag(req.query.debug) ? errors : undefined
    });
  } catch (error) {
    console.error('[Blackbox] ingest error:', error);
    res.status(500).json({ success: false, error: 'Failed to ingest Blackbox events' });
  }
});

router.get('/overview', (req, res) => {
  try {
    const store = normalizeStoreFromRequest(req);
    const data = getBlackboxOverview(store, {
      startDate: req.query.startDate || req.query.start,
      endDate: req.query.endDate || req.query.end,
      lookbackDays: req.query.lookbackDays || req.query.lookback,
      duplicateWindowSeconds: req.query.duplicateWindowSeconds,
      ghostSessionLimit: req.query.ghostSessionLimit,
      ghostOrderLimit: req.query.ghostOrderLimit,
      analysisLimit: req.query.analysisLimit
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Blackbox] overview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load Blackbox overview' });
  }
});

router.get('/events', (req, res) => {
  try {
    const store = normalizeStoreFromRequest(req);
    const data = listBlackboxEvents(store, {
      startDate: req.query.startDate || req.query.start,
      endDate: req.query.endDate || req.query.end,
      lookbackDays: req.query.lookbackDays || req.query.lookback,
      eventName: req.query.eventName || req.query.event,
      source: req.query.source,
      sessionHint: req.query.sessionHint || req.query.session,
      limit: req.query.limit,
      offset: req.query.offset
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Blackbox] events error:', error);
    res.status(500).json({ success: false, error: 'Failed to load Blackbox events' });
  }
});

router.get('/export.csv', (req, res) => {
  try {
    const store = normalizeStoreFromRequest(req);
    const data = exportBlackboxEventsCsv(store, {
      startDate: req.query.startDate || req.query.start,
      endDate: req.query.endDate || req.query.end,
      lookbackDays: req.query.lookbackDays || req.query.lookback,
      eventName: req.query.eventName || req.query.event,
      source: req.query.source,
      sessionHint: req.query.sessionHint || req.query.session,
      limit: req.query.limit
    });

    const fileSuffix = `${data.range.startDate}_to_${data.range.endDate}`;
    const fileName = `blackbox-events-${data.store}-${fileSuffix}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(data.csv);
  } catch (error) {
    console.error('[Blackbox] export error:', error);
    res.status(500).json({ success: false, error: 'Failed to export Blackbox CSV' });
  }
});

export default router;
