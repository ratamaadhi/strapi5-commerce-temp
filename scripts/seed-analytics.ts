import { createStrapi } from '@strapi/strapi';

/**
 * Seed dummy analytics data so the Conversion report has something to show.
 *
 * Writes analytics-session + analytics-event rows over the last 90 days, then
 * rebuilds the analytics-daily-aggregate table. Deletes all existing analytics
 * data first (fresh seed) so repeated runs stay deterministic-ish.
 *
 * Usage: pnpm seed:analytics
 */

const DAYS = 90;
const MIN_SESSIONS_PER_DAY = 80;
const MAX_SESSIONS_PER_DAY = 150;

// Funnel step probabilities (per session, conditional on reaching prior step is
// not enforced — each drawn independently against the session, matching how the
// report counts raw events vs. unique purchasing sessions).
const P_PRODUCT_VIEW = 0.7;
const P_ADD_TO_CART = 0.3;
const P_CHECKOUT_START = 0.15;
const P_PURCHASE = 0.08;

const UTM_SOURCES = ['google', 'facebook', 'instagram', 'tiktok', 'direct', 'newsletter'];
const UTM_MEDIUMS = ['cpc', 'social', 'organic', 'email', 'referral'];
const UTM_CAMPAIGNS = ['ramadan_sale', 'payday', 'flash_sale', 'retargeting', null];

const LANDING_PAGES = ['/', '/products', '/category/electronics', '/deals', '/search?q=headset'];
const REFERRERS = [
  'https://www.google.com/',
  'https://www.facebook.com/',
  'https://www.instagram.com/',
  'https://t.co/',
  '',
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(p: number): boolean {
  return Math.random() < p;
}

/** UTM combo that is internally consistent (direct/organic traffic has no campaign). */
function pickUtm(): { utmSource: string; utmMedium: string; utmCampaign: string | null } {
  const utmSource = pick(UTM_SOURCES);

  if (utmSource === 'direct') {
    return { utmSource, utmMedium: 'organic', utmCampaign: null };
  }
  if (utmSource === 'newsletter') {
    return { utmSource, utmMedium: 'email', utmCampaign: pick(['payday', 'flash_sale']) };
  }
  if (utmSource === 'google') {
    return { utmSource, utmMedium: pick(['cpc', 'organic']), utmCampaign: pick(UTM_CAMPAIGNS) };
  }
  // facebook / instagram / tiktok
  return { utmSource, utmMedium: 'social', utmCampaign: pick(UTM_CAMPAIGNS) };
}

async function main(): Promise<void> {
  const strapi = await createStrapi({ distDir: './dist' }).load();

  try {
    // 1. Fresh: wipe existing analytics data.
    console.log('Clearing existing analytics data...');
    await strapi.db.query('api::analytics.analytics-event').deleteMany({ where: {} });
    await strapi.db.query('api::analytics.analytics-session').deleteMany({ where: {} });
    await strapi.db.query('api::analytics.analytics-daily-aggregate').deleteMany({ where: {} });

    // 2. Pull real product documentIds for productId/orderId realism.
    const products = (await strapi.db.query('api::product.product').findMany({
      select: ['documentId'],
      limit: 500,
    })) as Array<{ documentId: string }>;
    const productIds = products.map((p) => p.documentId).filter(Boolean);

    if (productIds.length === 0) {
      console.warn('No products found — falling back to synthetic productIds.');
      for (let i = 0; i < 20; i++) productIds.push(`prod_${i}`);
    }
    console.log(`Using ${productIds.length} product ids.`);

    const now = new Date();
    const seededDates: string[] = [];

    let totalSessions = 0;
    let totalEvents = 0;
    let totalPurchases = 0;

    // 3. Loop days (oldest -> today).
    for (let d = DAYS - 1; d >= 0; d--) {
      const day = new Date(now);
      day.setUTCDate(day.getUTCDate() - d);
      const dateOnly = day.toISOString().slice(0, 10); // YYYY-MM-DD
      seededDates.push(dateOnly);

      const sessionCount = randInt(MIN_SESSIONS_PER_DAY, MAX_SESSIONS_PER_DAY);
      totalSessions += sessionCount;

      for (let s = 0; s < sessionCount; s++) {
        // firstSeenAt anywhere in the day; session lasts a few minutes.
        const startMs =
          Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) +
          randInt(0, 23) * 3600_000 +
          randInt(0, 59) * 60_000;
        const durationMs = randInt(1, 30) * 60_000;
        const firstSeenAt = new Date(startMs);
        const lastSeenAt = new Date(startMs + durationMs);

        const sessionId = `sess_${dateOnly}_${s}_${randInt(1000, 999999)}`;
        const utm = pickUtm();

        await strapi.db.query('api::analytics.analytics-session').create({
          data: {
            sessionId,
            firstSeenAt: firstSeenAt.toISOString(),
            lastSeenAt: lastSeenAt.toISOString(),
            landingPage: pick(LANDING_PAGES),
            referrer: pick(REFERRERS),
            utmSource: utm.utmSource,
            utmMedium: utm.utmMedium,
            utmCampaign: utm.utmCampaign,
            ipHash: `ip_${randInt(100000, 999999)}`,
            userAgent:
              'Mozilla/5.0 (seeded dummy) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
            user: null,
          },
        });

        // Event timeline within the session window, ordered by funnel.
        let cursor = startMs;
        const step = () => {
          cursor += randInt(5, 60) * 1000;
          return new Date(Math.min(cursor, lastSeenAt.getTime())).toISOString();
        };

        const events: any[] = [];

        // session_start always.
        events.push({ eventName: 'session_start', occurredAt: firstSeenAt.toISOString() });

        if (chance(P_PRODUCT_VIEW)) {
          const views = randInt(1, 4);
          for (let v = 0; v < views; v++) {
            events.push({
              eventName: 'product_view',
              productId: pick(productIds),
              occurredAt: step(),
            });
          }
        }

        if (chance(P_ADD_TO_CART)) {
          events.push({
            eventName: 'add_to_cart',
            productId: pick(productIds),
            cartId: `cart_${randInt(100000, 999999)}`,
            occurredAt: step(),
          });
        }

        if (chance(P_CHECKOUT_START)) {
          events.push({
            eventName: 'checkout_start',
            cartId: `cart_${randInt(100000, 999999)}`,
            occurredAt: step(),
          });
        }

        if (chance(P_PURCHASE)) {
          events.push({
            eventName: 'purchase',
            productId: pick(productIds),
            orderId: `order_${randInt(100000, 999999)}`,
            value: randInt(50000, 2000000),
            currency: 'IDR',
            occurredAt: step(),
          });
          totalPurchases += 1;
        }

        for (const ev of events) {
          await strapi.db.query('api::analytics.analytics-event').create({
            data: { sessionId, user: null, ...ev },
          });
          totalEvents += 1;
        }
      }

      console.log(`  ${dateOnly}: ${sessionCount} sessions seeded`);
    }

    // 4. Rebuild daily aggregate for each seeded date.
    console.log('Refreshing daily aggregates...');
    const analyticsService = strapi.service('api::analytics.analytics') as any;
    for (const date of seededDates) {
      await analyticsService.refreshDailyAggregate(date);
    }

    const avgConversion = totalSessions ? ((totalPurchases / totalSessions) * 100).toFixed(2) : '0';
    console.log('-'.repeat(60));
    console.log('Analytics seed complete:');
    console.log(`  days:        ${DAYS} (${seededDates[0]} -> ${seededDates[seededDates.length - 1]})`);
    console.log(`  sessions:    ${totalSessions}`);
    console.log(`  events:      ${totalEvents}`);
    console.log(`  purchases:   ${totalPurchases}`);
    console.log(`  conversion:  ~${avgConversion}%`);

    await strapi.destroy();
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    console.error(`\nFatal error: ${message}`);
    await strapi.destroy().catch(() => {});
    process.exit(1);
  }
}

main();
