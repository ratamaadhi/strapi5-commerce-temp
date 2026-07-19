export default {
  routes: [
    {
      method: 'POST',
      path: '/manual-payments/:orderDocumentId/proofs',
      handler: 'manual-payment.uploadProof',
      config: {
        middlewares: [],
      },
    },
  ],
};
