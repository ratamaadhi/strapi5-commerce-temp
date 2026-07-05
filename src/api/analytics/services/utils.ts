export const ANALYTICS_EVENT_NAMES = [
  'session_start',
  'product_view',
  'add_to_cart',
  'checkout_start',
] as const;

export const CANONICAL_EVENT_NAMES = [...ANALYTICS_EVENT_NAMES, 'purchase'] as const;

export type PublicAnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
export type CanonicalAnalyticsEventName = (typeof CANONICAL_EVENT_NAMES)[number];

export type NormalizedAnalyticsEvent = {
  eventName: PublicAnalyticsEventName;
  occurredAt: string;
  productId?: string;
  variantId?: string;
  cartId?: string;
  orderId?: string;
  value?: number;
  currency?: string;
};

export type NormalizedAnalyticsBatch = {
  sessionId: string;
  landingPage?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  events: NormalizedAnalyticsEvent[];
};

type ValidationFailure = {
  ok: false;
  status: 400;
  message: string;
};

type ValidationSuccess<T> = {
  ok: true;
  value: T;
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'number' && typeof value !== 'string') {
    return undefined;
  }

  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '') {
    return undefined;
  }

  if (typeof normalized === 'number') {
    return Number.isFinite(normalized) ? normalized : undefined;
  }

  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOccurredAt(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return new Date().toISOString();
  }

  if (typeof value === 'string' || value instanceof Date) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date().toISOString();
}

function isPublicAnalyticsEventName(value: string): value is PublicAnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value);
}

export function normalizeAnalyticsEventBatch(input: unknown): ValidationResult<NormalizedAnalyticsBatch> {
  if (!input || typeof input !== 'object') {
    return { ok: false, status: 400, message: 'Request body must be an object' };
  }

  const body = input as Record<string, unknown>;
  const sessionId = optionalString(body.sessionId);
  if (!sessionId) {
    return { ok: false, status: 400, message: 'sessionId is required' };
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return { ok: false, status: 400, message: 'events must be a non-empty array' };
  }

  const events: NormalizedAnalyticsEvent[] = [];
  for (const rawEvent of body.events) {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return { ok: false, status: 400, message: 'Each event must be an object' };
    }

    const event = rawEvent as Record<string, unknown>;
    const eventName = optionalString(event.eventName);
    if (!eventName || !isPublicAnalyticsEventName(eventName)) {
      return { ok: false, status: 400, message: `Unsupported analytics event: ${eventName ?? ''}` };
    }

    events.push({
      eventName,
      occurredAt: normalizeOccurredAt(event.occurredAt),
      productId: optionalString(event.productId),
      variantId: optionalString(event.variantId),
      cartId: optionalString(event.cartId),
      orderId: optionalString(event.orderId),
      value: optionalNumber(event.value),
      currency: optionalString(event.currency),
    });
  }

  return {
    ok: true,
    value: {
      sessionId,
      landingPage: optionalString(body.landingPage),
      referrer: optionalString(body.referrer),
      utmSource: optionalString(body.utmSource),
      utmMedium: optionalString(body.utmMedium),
      utmCampaign: optionalString(body.utmCampaign),
      events,
    },
  };
}

export function calculateConversionRate(sessions: number, purchasingSessions: number): number {
  if (sessions <= 0) {
    return 0;
  }

  return Number((purchasingSessions / sessions).toFixed(4));
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getDefaultDateRange(now = new Date()): { from: string; to: string } {
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 30);

  return {
    from: dateOnly(from),
    to: dateOnly(to),
  };
}

export type DateRangeResult =
  | { ok: true; value: { from: string; to: string } }
  | { ok: false; status: 400; message: string };

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeDateRange(
  query: Record<string, unknown>,
  now = new Date(),
): DateRangeResult {
  const defaults = getDefaultDateRange(now);
  const from = typeof query.from === 'string' ? query.from : defaults.from;
  const to = typeof query.to === 'string' ? query.to : defaults.to;

  if (!isDateOnly(from) || !isDateOnly(to)) {
    return { ok: false, status: 400, message: 'from and to must use YYYY-MM-DD format' };
  }

  if (from > to) {
    return { ok: false, status: 400, message: 'from must be before or equal to to' };
  }

  return { ok: true, value: { from, to } };
}

export function shouldRateLimitAnalytics(recentEventCount: number, maxEventsPerMinute = 120): boolean {
  return recentEventCount >= maxEventsPerMinute;
}
