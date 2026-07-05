import crypto from 'node:crypto';
import { factories } from '@strapi/strapi';

import {
  normalizeAnalyticsEventBatch,
  normalizeDateRange,
  shouldRateLimitAnalytics,
} from '../services/utils';

function hashIp(ip: string | undefined): string | undefined {
  if (!ip) {
    return undefined;
  }

  return crypto.createHash('sha256').update(ip).digest('hex');
}

export default factories.createCoreController('api::analytics.analytics-event' as any, ({ strapi }) => ({
  async ingest(ctx) {
    const body = ctx.request.body?.data ?? ctx.request.body;
    const validation = normalizeAnalyticsEventBatch(body);

    if (!validation.ok) {
      return ctx.badRequest('message' in validation ? validation.message : 'Invalid analytics batch');
    }

    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const recentEventCount = await strapi.db.query('api::analytics.analytics-event').count({
      where: {
        sessionId: validation.value.sessionId,
        occurredAt: { $gte: oneMinuteAgo },
      },
    });

    if (shouldRateLimitAnalytics(recentEventCount)) {
      ctx.status = 429;
      ctx.body = { error: { message: 'Too many analytics events' } };
      return;
    }

    const userAgentHeader = ctx.request.headers['user-agent'] ?? ctx.get('user-agent');
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;

    const result = await strapi.service('api::analytics.analytics').ingestBatch(validation.value, {
      userId: ctx.state.user?.documentId,
      ipHash: hashIp(ctx.request.ip),
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });

    ctx.body = { data: result };
  },

  async conversion(ctx) {
    const validation = normalizeDateRange(ctx.query as Record<string, unknown>);

    if (!validation.ok) {
      return ctx.badRequest('message' in validation ? validation.message : 'Invalid date range');
    }

    const result = await strapi.service('api::analytics.analytics').getConversionReport({
      ...validation.value,
      utmSource: typeof ctx.query.utm_source === 'string' ? ctx.query.utm_source : undefined,
      utmMedium: typeof ctx.query.utm_medium === 'string' ? ctx.query.utm_medium : undefined,
      utmCampaign: typeof ctx.query.utm_campaign === 'string' ? ctx.query.utm_campaign : undefined,
    });

    ctx.body = { data: result };
  },
}));
