export default {
  routes: [
    {
      method: 'PATCH',
      path: '/reviews/:documentId/verify',
      handler: 'review.verify',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
