export default {
  routes: [
    {
      method: 'POST',
      path: '/midtrans/webhook',
      handler: 'midtrans.webhook',
      config: {
        auth: false,
      },
    },
  ],
};
