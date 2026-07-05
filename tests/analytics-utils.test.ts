import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYTICS_EVENT_NAMES,
  CANONICAL_EVENT_NAMES,
  calculateConversionRate,
  getDefaultDateRange,
  normalizeAnalyticsEventBatch,
  normalizeDateRange,
  shouldRateLimitAnalytics,
} from '../src/api/analytics/services/utils';

test('analytics event names exclude public purchase ingestion', () => {
  assert.deepEqual(ANALYTICS_EVENT_NAMES, [
    'session_start',
    'product_view',
    'add_to_cart',
    'checkout_start',
  ]);
  assert.deepEqual(CANONICAL_EVENT_NAMES, [
    'session_start',
    'product_view',
    'add_to_cart',
    'checkout_start',
    'purchase',
  ]);
});

test('normalizeAnalyticsEventBatch accepts valid batched events', () => {
  const result = normalizeAnalyticsEventBatch({
    sessionId: ' sess_123 ',
    landingPage: ' /products ',
    referrer: 'https://google.com',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'july_sale',
    events: [
      {
        eventName: 'product_view',
        occurredAt: '2026-07-05T10:00:00.000Z',
        productId: 'prod_1',
        value: '19.5',
        currency: ' IDR ',
      },
    ],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.sessionId, 'sess_123');
    assert.equal(result.value.landingPage, '/products');
    assert.equal(result.value.events[0].eventName, 'product_view');
    assert.equal(result.value.events[0].productId, 'prod_1');
    assert.equal(result.value.events[0].value, 19.5);
    assert.equal(result.value.events[0].currency, 'IDR');
    assert.equal(result.value.events[0].occurredAt, '2026-07-05T10:00:00.000Z');
  }
});

test('normalizeAnalyticsEventBatch normalizes malformed occurredAt values', () => {
  const result = normalizeAnalyticsEventBatch({
    sessionId: 'sess_123',
    events: [{ eventName: 'product_view', occurredAt: 'not-a-date' }],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.value.events[0].occurredAt, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test('normalizeAnalyticsEventBatch ignores non-numeric value payloads', () => {
  const result = normalizeAnalyticsEventBatch({
    sessionId: 'sess_123',
    events: [{ eventName: 'product_view', occurredAt: '2026-07-05T10:00:00.000Z', value: true }],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.events[0].value, undefined);
  }
});

test('normalizeAnalyticsEventBatch rejects purchase from public ingestion', () => {
  const result = normalizeAnalyticsEventBatch({
    sessionId: 'sess_123',
    events: [{ eventName: 'purchase' }],
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    message: 'Unsupported analytics event: purchase',
  });
});

test('normalizeAnalyticsEventBatch rejects malformed session ids and empty events', () => {
  assert.deepEqual(normalizeAnalyticsEventBatch({ sessionId: '', events: [{ eventName: 'session_start' }] }), {
    ok: false,
    status: 400,
    message: 'sessionId is required',
  });

  assert.deepEqual(normalizeAnalyticsEventBatch({ sessionId: 'sess_123', events: [] }), {
    ok: false,
    status: 400,
    message: 'events must be a non-empty array',
  });
});

test('calculateConversionRate handles zero sessions', () => {
  assert.equal(calculateConversionRate(0, 10), 0);
});

test('calculateConversionRate handles negative sessions', () => {
  assert.equal(calculateConversionRate(-5, 10), 0);
});

test('calculateConversionRate rounds to 4 decimals', () => {
  assert.equal(calculateConversionRate(3, 1), 0.3333);
});

test('calculateConversionRate preserves numeric sign for negative purchasing sessions', () => {
  assert.equal(calculateConversionRate(3, -1), -0.3333);
});

test('getDefaultDateRange returns last 30 day inclusive range', () => {
  const now = new Date('2026-07-05T12:00:00.000Z');
  const range = getDefaultDateRange(now);

  assert.equal(range.from, '2026-06-05');
  assert.equal(range.to, '2026-07-05');
});

test('normalizeDateRange rejects from after to', () => {
  assert.deepEqual(normalizeDateRange({ from: '2026-07-06', to: '2026-07-05' }), {
    ok: false,
    status: 400,
    message: 'from must be before or equal to to',
  });
});

test('normalizeDateRange accepts explicit range', () => {
  assert.deepEqual(normalizeDateRange({ from: '2026-07-01', to: '2026-07-05' }), {
    ok: true,
    value: { from: '2026-07-01', to: '2026-07-05' },
  });
});

test('normalizeDateRange defaults to last 30 days inclusive', () => {
  assert.deepEqual(normalizeDateRange({}, new Date('2026-07-05T12:00:00.000Z')), {
    ok: true,
    value: { from: '2026-06-05', to: '2026-07-05' },
  });
});

test('shouldRateLimitAnalytics allows request under limit', () => {
  assert.equal(shouldRateLimitAnalytics(10, 20), false);
});

test('shouldRateLimitAnalytics blocks request at limit', () => {
  assert.equal(shouldRateLimitAnalytics(20, 20), true);
});
