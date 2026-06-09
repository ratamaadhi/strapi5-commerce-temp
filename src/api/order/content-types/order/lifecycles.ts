export default {
  async afterCreate(event: any) {
    const { result } = event;

    try {
      const order = await strapi.documents('api::order.order').findOne({
        documentId: result.documentId,
        populate: ['items'],
      }) as any;

      if (order.items && order.items.length > 0) {
        for (const item of order.items) {
          if (!item.productDocumentId) {
            strapi.log.warn('Order item missing productDocumentId, skipping decrement');
            continue;
          }

          const product = await strapi.documents('api::product.product').findOne({
            documentId: item.productDocumentId,
            populate: ['variants'],
          }) as any;

          if (!product) {
            strapi.log.warn(`Product not found for decrement: ${item.productDocumentId}`);
            continue;
          }

          if (item.variantSku && product.variants && product.variants.length > 0) {
            const variantIndex = product.variants.findIndex(
              (v: any) => v.sku === item.variantSku
            );
            if (variantIndex >= 0) {
              const variant = product.variants[variantIndex];
              const qty = Number(item.quantity) || 0;
              variant.inventory = Math.max(0, Number(variant.inventory) - qty);

              await strapi.documents('api::product.product').update({
                documentId: product.documentId,
                data: { variants: product.variants },
              });

              strapi.log.info(
                `Decremented variant ${variant.sku} inventory by ${qty}`
              );
            }
          } else {
            const qty = Number(item.quantity) || 0;
            const newInventory = Math.max(0, Number(product.inventory) - qty);

            await strapi.documents('api::product.product').update({
              documentId: product.documentId,
              data: { inventory: newInventory },
            });

            strapi.log.info(
              `Decremented product ${product.documentId} inventory by ${qty}`
            );
          }
        }
      }
    } catch (err: any) {
      strapi.log.error('Failed to decrement inventory on order create:', err);
    }

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

      const template = {
        subject: `Order #${order.orderNumber} - Confirmed`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Order Confirmed</h1>
            <p>Thank you for your order! Your order <strong>#<%= orderNumber %></strong> has been received.</p>

            <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Order Details</h2>
            <p>Status: <strong><%= orderStatus %></strong></p>
            <p>Payment: <strong><%= paymentStatus %></strong></p>

            <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Items</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="background: #f5f5f5;">
                <th style="text-align: left; padding: 8px;">Product</th>
                <th style="text-align: right; padding: 8px;">Qty</th>
                <th style="text-align: right; padding: 8px;">Price</th>
                <th style="text-align: right; padding: 8px;">Total</th>
              </tr>
              <% items.forEach(item => { %>
                <tr>
                  <td style="padding: 8px;"><%= item.productName %><% if (item.variantInfo) { %> <small>(<%= item.variantInfo %>)</small><% } %></td>
                  <td style="text-align: right; padding: 8px;"><%= item.quantity %></td>
                  <td style="text-align: right; padding: 8px;"><%= currency %> <%= Number(item.unitPrice).toLocaleString() %></td>
                  <td style="text-align: right; padding: 8px;"><%= currency %> <%= Number(item.totalPrice).toLocaleString() %></td>
                </tr>
              <% }) %>
            </table>

            <p style="margin-top: 16px; font-weight: bold;">Subtotal: <%= currency %> <%= Number(subtotal).toLocaleString() %></p>
            <p>Tax: <%= currency %> <%= Number(tax).toLocaleString() %></p>
            <p>Shipping: <%= currency %> <%= Number(shippingCost).toLocaleString() %></p>
            <% if (discount > 0) { %><p>Discount: -<%= currency %> <%= Number(discount).toLocaleString() %></p><% } %>
            <p style="font-size: 18px; font-weight: bold; color: #d32f2f;">Total: <%= currency %> <%= Number(totalAmount).toLocaleString() %></p>

            <% if (shippingAddress) { %>
              <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Shipping Address</h2>
              <p><%= shippingAddress.firstName %> <%= shippingAddress.lastName %></p>
              <p><%= shippingAddress.addressLine1 %></p>
              <% if (shippingAddress.addressLine2) { %><p><%= shippingAddress.addressLine2 %></p><% } %>
              <p><%= shippingAddress.city %>, <%= shippingAddress.state %> <%= shippingAddress.postalCode %></p>
              <p><%= shippingAddress.country %></p>
            <% } %>

            <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;" />
            <p style="font-size: 12px; color: #999;">This is an automated message. Please do not reply.</p>
          </div>
        `,
      };

      await strapi.plugins['email'].services.email.sendTemplatedEmail(
        { to: customerEmail },
        template,
        {
          orderNumber: order.orderNumber,
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
          items: order.items || [],
          subtotal: order.subtotal,
          tax: order.tax,
          shippingCost: order.shippingCost,
          discount: order.discount,
          totalAmount: order.totalAmount,
          currency: order.currency,
          shippingAddress: order.shippingAddress,
        }
      );

      strapi.log.info(`Order confirmation sent to ${customerEmail}`);
    } catch (err: any) {
      strapi.log.error('Failed to send order confirmation:', err);
    }
  },

  async afterUpdate(event: any) {
    const { result } = event;

    try {
      const statusesToRestore = ['cancelled', 'refunded'];
      const newOrderStatus = result.orderStatus;
      const newPaymentStatus = result.paymentStatus;

      const shouldRestore =
        statusesToRestore.includes(newOrderStatus) ||
        statusesToRestore.includes(newPaymentStatus);

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
          populate: ['variants'],
        }) as any;

        if (!product) {
          strapi.log.warn(`Product not found for restore: ${item.productDocumentId}`);
          continue;
        }

        if (item.variantSku && product.variants && product.variants.length > 0) {
          const variantIndex = product.variants.findIndex(
            (v: any) => v.sku === item.variantSku
          );
          if (variantIndex >= 0) {
            const variant = product.variants[variantIndex];
            const qty = Number(item.quantity) || 0;
            variant.inventory = Number(variant.inventory) + qty;

            await strapi.documents('api::product.product').update({
              documentId: product.documentId,
              data: { variants: product.variants },
            });

            strapi.log.info(
              `Restored variant ${variant.sku} inventory by ${qty}`
            );
          }
        } else {
          const qty = Number(item.quantity) || 0;
          const newInventory = Number(product.inventory) + qty;

          await strapi.documents('api::product.product').update({
            documentId: product.documentId,
            data: { inventory: newInventory },
          });

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
