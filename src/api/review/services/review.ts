/**
 * review service
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::review.review', ({ strapi }) => ({
  async checkUserPurchase(userId: number, productDocumentId: string): Promise<boolean> {
    const order = await strapi.db.query('api::order.order').findOne({
      where: {
        user: { id: userId },
        orderStatus: 'delivered',
        items: {
          productDocumentId: productDocumentId,
        },
      },
    });

    return !!order;
  },

  async setVerified(reviewDocumentId: string, verified: boolean): Promise<any> {
    return strapi.documents('api::review.review').update({
      documentId: reviewDocumentId,
      data: { verified },
    });
  },
}));
