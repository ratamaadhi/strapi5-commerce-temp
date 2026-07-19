export default {
  routes: [
    {
      method: 'GET',
      path: '/store-setting/payment-methods',
      handler: 'store-setting.paymentMethods',
      config: { auth: false },
    },
  ],
};
