export default {
  async webhook(ctx: any) {
    const payload = ctx.request.body;

    strapi.log.info('Midtrans webhook received:', JSON.stringify(payload));

    const service = strapi.service('api::midtrans.midtrans');

    const isValid = service.validateSignature({
      orderId: payload.order_id,
      statusCode: payload.status_code,
      grossAmount: payload.gross_amount,
      signatureKey: payload.signature_key,
    });

    if (!isValid) {
      strapi.log.warn('Midtrans webhook: invalid signature');
      return ctx.forbidden('Invalid signature');
    }

    const orders = await strapi.documents('api::order.order').findMany({
      filters: { orderNumber: { $eq: payload.order_id } },
    }) as any;

    if (!orders || orders.length === 0) {
      strapi.log.warn(`Midtrans webhook: order not found: ${payload.order_id}`);
      return ctx.notFound('Order not found');
    }

    const order = orders[0];
    const newPaymentStatus = service.mapPaymentStatus(payload.transaction_status);

    const updateData: any = {
      midtransTransactionId: payload.transaction_id,
      midtransTransactionStatus: payload.transaction_status,
      midtransPaymentType: payload.payment_type,
      paymentStatus: newPaymentStatus,
    };

    if (payload.transaction_status === 'settlement' || payload.transaction_status === 'capture') {
      updateData.paidAt = new Date().toISOString();
    }

    await strapi.documents('api::order.order').update({
      documentId: order.documentId,
      data: updateData,
    });

    strapi.log.info(`Order ${payload.order_id} payment updated: ${newPaymentStatus}`);

    ctx.body = { status: 'ok' };
  },
};
