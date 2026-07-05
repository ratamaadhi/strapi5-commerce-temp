export default {
  analyticsDailyMaintenance: {
    task: async ({ strapi }) => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const date = yesterday.toISOString().slice(0, 10);

      const analyticsService = strapi.service('api::analytics.analytics');
      await analyticsService.refreshDailyAggregate(date);
      await analyticsService.pruneRawEventsOlderThan13Months();
    },
    options: {
      rule: '0 10 2 * * *',
      tz: 'UTC',
    },
  },
};
