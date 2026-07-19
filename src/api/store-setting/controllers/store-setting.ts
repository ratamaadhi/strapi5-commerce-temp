import { factories } from '@strapi/strapi';
import { resolvePaymentMethods } from '../../manual-payment/services/logic';

export default factories.createCoreController('api::store-setting.store-setting', ({ strapi }) => ({
  async paymentMethods(ctx) {
    const setting = await strapi
      .documents('api::store-setting.store-setting')
      .findFirst({ populate: { bankAccounts: true } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.body = { data: resolvePaymentMethods((setting ?? {}) as any) };
  },
}));
