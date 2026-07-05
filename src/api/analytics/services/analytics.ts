import { factories } from '@strapi/strapi';

import { calculateConversionRate, type NormalizedAnalyticsBatch } from './utils';

type ConversionFilters = {
  from: string;
  to: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

type AnalyticsMeta = {
  userId?: string;
  ipHash?: string;
  userAgent?: string;
};

function dayStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function dayEnd(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function dateOnly(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const value = error as { code?: unknown; message?: unknown };
  return value.code === 'SQLITE_CONSTRAINT' || value.code === '23505';
}

export default factories.createCoreService('api::analytics.analytics-event' as any, ({ strapi }) => ({
  async ingestBatch(batch: NormalizedAnalyticsBatch, meta: AnalyticsMeta = {}) {
    const now = new Date().toISOString();
    return await strapi.db.transaction(async () => {
      const existingSession = (await strapi.db.query('api::analytics.analytics-session').findOne({
        where: { sessionId: batch.sessionId },
      })) as any;

      const sessionData: Record<string, unknown> = {
        sessionId: batch.sessionId,
        lastSeenAt: now,
        ...(batch.landingPage ? { landingPage: batch.landingPage } : {}),
        ...(batch.referrer ? { referrer: batch.referrer } : {}),
        ...(batch.utmSource ? { utmSource: batch.utmSource } : {}),
        ...(batch.utmMedium ? { utmMedium: batch.utmMedium } : {}),
        ...(batch.utmCampaign ? { utmCampaign: batch.utmCampaign } : {}),
        ...(meta.ipHash ? { ipHash: meta.ipHash } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
        ...(meta.userId ? { user: meta.userId } : {}),
      };

      let session = existingSession;
      if (session) {
        session = await strapi.db.query('api::analytics.analytics-session').update({
          where: { id: session.id },
          data: sessionData,
        });
      } else {
        try {
          session = await strapi.db.query('api::analytics.analytics-session').create({
            data: { ...sessionData, firstSeenAt: now },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }

          session = (await strapi.db.query('api::analytics.analytics-session').findOne({
            where: { sessionId: batch.sessionId },
          })) as any;
          if (!session) {
            throw new Error('Failed to create analytics session');
          }

          session = await strapi.db.query('api::analytics.analytics-session').update({
            where: { id: session.id },
            data: sessionData,
          });
        }
      }

      for (const event of batch.events) {
        await strapi.db.query('api::analytics.analytics-event').create({
          data: {
            ...event,
            sessionId: batch.sessionId,
            session: session.id,
            ...(meta.userId ? { user: meta.userId } : {}),
          },
        });
      }

      return { accepted: batch.events.length };
    });
  },

  async createPurchaseFromOrder(order: any) {
    if (!order?.documentId) {
      strapi.log.warn('Analytics purchase unattributed: order missing documentId');
    }

    if (!order?.sessionId || !order?.documentId) {
      strapi.log.warn('Analytics purchase unattributed: order missing sessionId');
      return { created: false, reason: 'missing_session_id' };
    }

    const existing = await strapi.db.query('api::analytics.analytics-event').findOne({
      where: { eventName: 'purchase', orderId: order.documentId },
    });

    if (existing) {
      return { created: false, reason: 'duplicate' };
    }

    const session = (await strapi.db.query('api::analytics.analytics-session').findOne({
      where: { sessionId: order.sessionId },
    })) as any;

    const totalAmount = Number(order.totalAmount);
    if (!Number.isFinite(totalAmount)) {
      strapi.log.warn('Analytics purchase totalAmount invalid; defaulting to 0');
    }

    const occurredAtValue =
      typeof order.paidAt === 'string' || order.paidAt instanceof Date
        ? (() => {
            const date = new Date(order.paidAt);
            return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
          })()
        : undefined;
    if (!occurredAtValue) {
      strapi.log.warn('Analytics purchase paidAt invalid; defaulting to now');
    }
    const occurredAt = occurredAtValue ?? new Date().toISOString();

    await strapi.db.query('api::analytics.analytics-event').create({
      data: {
        eventName: 'purchase',
        sessionId: order.sessionId,
        ...(session ? { session: session.id } : {}),
        ...(order.user?.id ? { user: order.user.id } : {}),
        orderId: order.documentId,
        value: Number.isFinite(totalAmount) ? totalAmount : 0,
        currency: order.currency ?? 'IDR',
        occurredAt,
      },
    });

    return { created: true };
  },

  async getConversionReport(filters: ConversionFilters) {
    const sessionWhere: Record<string, unknown> = {
      firstSeenAt: { $gte: dayStart(filters.from), $lte: dayEnd(filters.to) },
      ...(filters.utmSource ? { utmSource: filters.utmSource } : {}),
      ...(filters.utmMedium ? { utmMedium: filters.utmMedium } : {}),
      ...(filters.utmCampaign ? { utmCampaign: filters.utmCampaign } : {}),
    };

    const sessions = (await strapi.db.query('api::analytics.analytics-session').findMany({
      where: sessionWhere,
    })) as any[];
    const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));

    const sessionIds = sessions.map((session) => session.sessionId);
    const events = sessionIds.length
      ? ((await strapi.db.query('api::analytics.analytics-event').findMany({
          where: { sessionId: { $in: sessionIds } },
        })) as any[])
      : [];

    const dayMap = new Map<string, any>();
    function getBucket(date: string) {
      const bucket = dayMap.get(date) ?? {
        date,
        sessions: 0,
        productViews: 0,
        addToCarts: 0,
        checkoutStarts: 0,
        purchases: 0,
        purchasingSessions: new Set<string>(),
      };

      dayMap.set(date, bucket);
      return bucket;
    }

    for (const session of sessions) {
      const date = dateOnly(session.firstSeenAt);
      const bucket = getBucket(date);
      bucket.sessions += 1;
    }

    for (const event of events) {
      const session = sessionById.get(event.sessionId);
      if (!session) {
        continue;
      }

      const date = dateOnly(session.firstSeenAt);
      const bucket = getBucket(date);

      if (event.eventName === 'product_view') bucket.productViews += 1;
      if (event.eventName === 'add_to_cart') bucket.addToCarts += 1;
      if (event.eventName === 'checkout_start') bucket.checkoutStarts += 1;
      if (event.eventName === 'purchase') {
        bucket.purchases += 1;
        bucket.purchasingSessions.add(event.sessionId);
      }
    }

    const totalPurchasingSessions = new Set(
      events.filter((event) => event.eventName === 'purchase').map((event) => event.sessionId),
    ).size;

    const days = Array.from(dayMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((bucket) => ({
        date: bucket.date,
        sessions: bucket.sessions,
        productViews: bucket.productViews,
        addToCarts: bucket.addToCarts,
        checkoutStarts: bucket.checkoutStarts,
        purchases: bucket.purchases,
        conversionRate: calculateConversionRate(bucket.sessions, bucket.purchasingSessions.size),
      }));

    const totals = days.reduce(
      (acc, day) => ({
        sessions: acc.sessions + day.sessions,
        productViews: acc.productViews + day.productViews,
        addToCarts: acc.addToCarts + day.addToCarts,
        checkoutStarts: acc.checkoutStarts + day.checkoutStarts,
        purchases: acc.purchases + day.purchases,
      }),
      { sessions: 0, productViews: 0, addToCarts: 0, checkoutStarts: 0, purchases: 0 },
    );

    return {
      range: { from: filters.from, to: filters.to },
      totals: {
        ...totals,
        purchasingSessions: totalPurchasingSessions,
        conversionRate: calculateConversionRate(totals.sessions, totalPurchasingSessions),
      },
      days,
    };
  },

  async refreshDailyAggregate(date: string) {
    const analyticsService = strapi.service('api::analytics.analytics') as any;
    const report = await analyticsService.getConversionReport({ from: date, to: date });

    const aggregateData = {
      date,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      sessions: report.totals.sessions,
      productViews: report.totals.productViews,
      addToCarts: report.totals.addToCarts,
      checkoutStarts: report.totals.checkoutStarts,
      purchases: report.totals.purchases,
      purchasingSessions: Math.round(report.totals.sessions * report.totals.conversionRate),
    };

    const existing = (await strapi.db.query('api::analytics.analytics-daily-aggregate').findOne({
      where: {
        date,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
      },
    })) as any;

    if (existing) {
      await strapi.db.query('api::analytics.analytics-daily-aggregate').update({
        where: { id: existing.id },
        data: aggregateData,
      });

      return { updated: true, date };
    }

    await strapi.db.query('api::analytics.analytics-daily-aggregate').create({
      data: aggregateData,
    });

    return { created: true, date };
  },

  async pruneRawEventsOlderThan13Months(now = new Date()) {
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 13);

    return await strapi.db.query('api::analytics.analytics-event').deleteMany({
      where: {
        occurredAt: { $lt: cutoff.toISOString() },
      },
    });
  },
}));
