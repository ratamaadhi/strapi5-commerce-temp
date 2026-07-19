import { isManualPaymentExpired } from './logic';

export async function expireStaleManualPayments(strapi: any): Promise<number> {
  const candidates = await strapi.documents('api::manual-payment.manual-payment').findMany({
    filters: { status: { $in: ['awaiting_proof', 'under_review'] } },
    populate: { order: true },
    limit: 500,
  });

  let cancelled = 0;
  const now = new Date();

  for (const mp of candidates) {
    const order = mp.order;
    if (!order) continue;
    if (
      !isManualPaymentExpired(
        { createdAt: order.createdAt, paymentStatus: order.paymentStatus },
        mp.status,
        now
      )
    ) {
      continue;
    }

    try {
      // Setting paymentStatus=cancelled triggers order.afterUpdate, which restores
      // inventory. Do NOT restore stock here or it double-increments.
      await strapi.documents('api::order.order').update({
        documentId: order.documentId,
        data: { orderStatus: 'cancelled', paymentStatus: 'cancelled' },
      });
      await strapi.documents('api::manual-payment.manual-payment').update({
        documentId: mp.documentId,
        data: {
          status: 'rejected',
          rejectionReason: 'Payment expired: no proof received within 24 hours',
        },
      });
      cancelled += 1;
    } catch (err: any) {
      strapi.log.error('Failed to expire manual payment order:', err);
    }
  }

  return cancelled;
}
