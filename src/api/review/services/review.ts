/**
 * review service
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::review.review', ({ strapi }) => ({
  async checkUserPurchase(userId: string | number, productDocumentId: string): Promise<boolean> {
    try {
      const orders = await strapi.documents('api::order.order').findMany({
        filters: {
          user: { id: userId },
          orderStatus: 'delivered',
        },
        populate: {
          items: true,
        },
        limit: 10,
      }) as any[];

      if (!orders || orders.length === 0) return false;

      return orders.some((order: any) => {
        if (!order.items || order.items.length === 0) return false;
        return order.items.some((item: any) => item.productDocumentId === productDocumentId);
      });
    } catch (error) {
      strapi.log.error(`checkUserPurchase failed: ${error}`);
      return false;
    }
  },

  async setVerified(reviewDocumentId: string, verified: boolean): Promise<any> {
    try {
      return await strapi.documents('api::review.review').update({
        documentId: reviewDocumentId,
        data: { verified },
      });
    } catch (error) {
      strapi.log.error(`setVerified failed: ${error}`);
      throw error;
    }
  },
}));
