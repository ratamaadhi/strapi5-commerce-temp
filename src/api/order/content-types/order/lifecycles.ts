import { incrementVariantInventory } from '../../services/inventory';

export default {
  async afterCreate(event: any) {
    const { result } = event;

    try {
      const order = await strapi.documents('api::order.order').findOne({
        documentId: result.documentId,
        populate: ['user', 'items'],
      }) as any;

      const customerEmail = order.user?.email ?? null;
      if (!customerEmail) {
        strapi.log.warn('Order confirmation skipped: order has no associated user with email');
        return;
      }

      const cur = order.currency ?? 'IDR';
      const fmt = (n: any) => Number(n ?? 0).toLocaleString();

      let itemsHtml = '';
      for (const item of order.items ?? []) {
        const variantExtra = item.variantInfo ? ` <small>(${item.variantInfo})</small>` : '';
        itemsHtml += `
          <tr>
            <td style="padding: 8px;">${item.productName}${variantExtra}</td>
            <td style="text-align: right; padding: 8px;">${item.quantity}</td>
            <td style="text-align: right; padding: 8px;">${cur} ${fmt(item.unitPrice)}</td>
            <td style="text-align: right; padding: 8px;">${cur} ${fmt(item.totalPrice)}</td>
          </tr>`;
      }

      let addressHtml = '';
      if (order.shippingAddress) {
        const a = order.shippingAddress;
        addressHtml = `
          <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Shipping Address</h2>
          <p>${a.firstName} ${a.lastName}</p>
          <p>${a.addressLine1}</p>
          ${a.addressLine2 ? `<p>${a.addressLine2}</p>` : ''}
          <p>${a.city}, ${a.state} ${a.postalCode}</p>
          <p>${a.country}</p>`;
      }

      let discountHtml = '';
      if (Number(order.discount) > 0) {
        discountHtml = `<p>Discount: -${cur} ${fmt(order.discount)}</p>`;
      }

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Order Confirmed</h1>
          <p>Thank you for your order! Your order <strong>#${order.orderNumber}</strong> has been received.</p>

          <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Order Details</h2>
          <p>Status: <strong>${order.orderStatus}</strong></p>
          <p>Payment: <strong>${order.paymentStatus}</strong></p>

          <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Items</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background: #f5f5f5;">
              <th style="text-align: left; padding: 8px;">Product</th>
              <th style="text-align: right; padding: 8px;">Qty</th>
              <th style="text-align: right; padding: 8px;">Price</th>
              <th style="text-align: right; padding: 8px;">Total</th>
            </tr>
            ${itemsHtml}
          </table>

          <p style="margin-top: 16px; font-weight: bold;">Subtotal: ${cur} ${fmt(order.subtotal)}</p>
          <p>Tax: ${cur} ${fmt(order.tax)}</p>
          <p>Shipping: ${cur} ${fmt(order.shippingCost)}</p>
          ${discountHtml}
          <p style="font-size: 18px; font-weight: bold; color: #d32f2f;">Total: ${cur} ${fmt(order.totalAmount)}</p>

          ${addressHtml}

          <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #999;">This is an automated message. Please do not reply.</p>
        </div>`;

      strapi.plugins['email'].services.email.send({
        to: customerEmail,
        subject: `Order #${order.orderNumber} - Confirmed`,
        text: `Your order #${order.orderNumber} has been confirmed. Total: ${cur} ${fmt(order.totalAmount)}. Status: ${order.orderStatus}. Payment: ${order.paymentStatus}.`,
        html,
      });

      strapi.log.info(`Order confirmation sent to ${customerEmail}`);
    } catch (err: any) {
      strapi.log.error('Failed to send order confirmation:', err);
    }
  },

  async afterUpdate(event: any) {
    const { result, params } = event;

    try {
      const statusesToRestore = ['cancelled', 'refunded', 'failed'];

      const data = params?.data || {};
      const paymentExplicitlyChanged = data.paymentStatus && statusesToRestore.includes(result.paymentStatus);
      const orderExplicitlyChanged = data.orderStatus && statusesToRestore.includes(result.orderStatus);

      const shouldRestore = paymentExplicitlyChanged || orderExplicitlyChanged;

      if (!shouldRestore) {
        return;
      }

      const order = await strapi.documents('api::order.order').findOne({
        documentId: result.documentId,
        populate: ['items'],
      }) as any;

      if (!order.items || order.items.length === 0) {
        return;
      }

      for (const item of order.items) {
        if (!item.productDocumentId) {
          strapi.log.warn('Order item missing productDocumentId, skipping restore');
          continue;
        }

        const product = await strapi.documents('api::product.product').findOne({
          documentId: item.productDocumentId,
          status: 'published',
          populate: ['variants'],
        }) as any;

        if (!product) {
          strapi.log.warn(`Product not found for restore: ${item.productDocumentId}`);
          continue;
        }

        if (item.variantSku && product.variants && product.variants.length > 0) {
          const variant = product.variants.find(
            (v: any) => v.sku === item.variantSku
          );
          if (variant) {
            const qty = Number(item.quantity) || 0;
            await incrementVariantInventory(strapi, variant.id, qty);

            strapi.log.info(
              `Restored variant ${variant.sku} inventory by ${qty}`
            );
          }
        } else {
          const qty = Number(item.quantity) || 0;

          await strapi.db.connection.raw(
            `UPDATE products SET inventory = inventory + :qty WHERE id = :id`,
            { id: Number(product.id), qty }
          );

          strapi.log.info(
            `Restored product ${product.documentId} inventory by ${qty}`
          );
        }
      }
    } catch (err: any) {
      strapi.log.error('Failed to restore inventory on order update:', err);
    }
  },
};
