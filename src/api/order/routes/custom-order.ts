export default {
  routes: [
    {
      method: 'POST',
      path: '/orders/:documentId/regenerate-snap-token',
      handler: 'order.regenerateSnapToken',
    },
    {
      method: 'POST',
      path: '/orders/:documentId/retry',
      handler: 'order.retryOrder',
    },
  ],
};
