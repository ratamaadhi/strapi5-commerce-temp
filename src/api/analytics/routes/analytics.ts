export default {
  routes: [
    {
      method: 'POST',
      path: '/analytics/events',
      handler: 'analytics.ingest',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/analytics/conversion',
      handler: 'analytics.conversion',
    },
  ],
};
