/**
 * order service
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::order.order', ({ strapi }) => ({
  async cancelOrder(documentId: string) {
    const order = (await strapi.documents('api::order.order').findOne({
      documentId,
    })) as any;

    if (order?.midtransSnapToken) {
      try {
        await strapi.service('api::midtrans.midtrans')
          .cancelTransaction(order.midtransSnapToken);
      } catch (err) {
        strapi.log.error(
          `Midtrans cancel failed for order ${order.orderNumber}:`,
          err
        );
      }
    }

    const result = (await strapi.documents('api::order.order').update({
      documentId,
      data: {
        orderStatus: 'cancelled',
        paymentStatus: 'cancelled',
      },
    })) as any;

    strapi.log.info(`Order ${result.orderNumber} cancelled`);
    return result;
  },
}));
