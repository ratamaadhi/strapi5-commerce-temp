/**
 * order service
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::order.order', ({ strapi }) => ({
  async cancelOrder(documentId: string) {
    const result = (await strapi.documents('api::order.order').update({
      documentId,
      data: { orderStatus: 'cancelled' },
    })) as any;

    strapi.log.info(`Order ${result.orderNumber} cancelled`);
    return result;
  },
}));
