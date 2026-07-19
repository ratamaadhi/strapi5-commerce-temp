import { errors } from '@strapi/utils';
import { incrementVariantInventory } from '../../services/inventory';
import { isPaymentMethodEnabled } from '../../../manual-payment/services/logic';

const { ApplicationError } = errors;

// Bentuk `data.voucher`/`data.user` di titik ini (dikonfirmasi lewat log runtime,
// REST payload mengirim voucher sebagai bare documentId string): Strapi v5
// menormalisasi manyToOne relation set-on-create menjadi `{ set: [{ id: <numeric id
// internal> }] }` — BUKAN string documentId mentah, BUKAN bentuk `{ connect: [...] }`.
// `where: { id: voucherId }` di bawah sudah benar apa adanya (id di sini memang id
// numerik internal, bukan documentId) — TIDAK perlu diganti ke `documentId`.
function extractRelationId(relation: unknown): number | string | undefined {
  if (relation == null) return undefined;
  if (typeof relation === 'number' || typeof relation === 'string') return relation;
  if (typeof relation === 'object') {
    const r = relation as Record<string, unknown>;
    if (Array.isArray(r.connect) && r.connect[0]) {
      const first = r.connect[0] as Record<string, unknown>;
      return (first.id ?? first.documentId) as number | string;
    }
    if (Array.isArray(r.set) && r.set[0] !== undefined) {
      const first = r.set[0];
      if (typeof first === 'object' && first !== null) {
        const f = first as Record<string, unknown>;
        return (f.id ?? f.documentId) as number | string;
      }
      return first as number | string;
    }
  }
  return undefined;
}

export default {
  async beforeCreate(event: any) {
    const { data } = event.params;

    // Enforce payment method toggle from store-setting.
    const method = (data.paymentMethod as 'gateway' | 'manual_transfer') || 'gateway';
    const setting = await strapi
      .documents('api::store-setting.store-setting')
      .findFirst();
    if (!isPaymentMethodEnabled(method, setting ?? {})) {
      throw new ApplicationError('Metode pembayaran ini sedang tidak aktif');
    }

    // subtotal & item.unitPrice/totalPrice SUDAH direcompute oleh Document Service
    // Middleware di src/index.ts (Bagian A, Step 1) — middleware itu jalan SEBELUM
    // Document Service membuat baris component `items`, sedangkan beforeCreate ini
    // (Model Lifecycle, level Query Engine) jalan SETELAH itu, jadi `data.items` di
    // sini sudah jadi stub component reference (tanpa productDocumentId/unitPrice) —
    // TIDAK bisa direcompute dari titik ini. `data.subtotal` (field scalar, bukan
    // component) tetap utuh dan sudah benar — dipakai langsung, tidak dihitung ulang.
    const subtotal = Number(data.subtotal ?? 0);

    // Validasi & hitung discount voucher — HANYA kalau data.voucher ada.
    let discount = 0;

    if (data.voucher) {
      const voucherId = extractRelationId(data.voucher);
      if (!voucherId) {
        throw new ApplicationError('Voucher tidak ditemukan');
      }

      const voucher = await strapi.db.query('api::voucher.voucher').findOne({
        where: { id: voucherId },
      });

      if (!voucher) {
        throw new ApplicationError('Voucher tidak ditemukan');
      }
      if (!voucher.isActive) {
        throw new ApplicationError('Voucher tidak aktif');
      }

      const now = new Date();
      if (voucher.startDate && now < new Date(voucher.startDate)) {
        throw new ApplicationError('Voucher belum berlaku');
      }
      if (voucher.endDate && now > new Date(voucher.endDate)) {
        throw new ApplicationError('Voucher sudah kadaluarsa');
      }

      if (voucher.minPurchase && subtotal < voucher.minPurchase) {
        throw new ApplicationError(
          `Minimal belanja Rp${voucher.minPurchase} untuk memakai voucher ini`,
        );
      }

      // Order yang cancelled/failed TIDAK menggerus kuota voucher — supaya
      // gangguan Midtrans tidak menghabiskan kuota tanpa transaksi sukses.
      const activeUsageFilter = {
        voucher: voucherId,
        orderStatus: { $ne: 'cancelled' },
        paymentStatus: { $notIn: ['failed', 'cancelled'] },
      };

      if (voucher.usageLimit != null) {
        const totalUsage = await strapi.db.query('api::order.order').count({
          where: activeUsageFilter,
        });
        if (totalUsage >= voucher.usageLimit) {
          throw new ApplicationError('Kuota voucher sudah habis');
        }
      }

      const userId = extractRelationId(data.user);
      if (voucher.usageLimitPerUser != null && userId) {
        const userUsage = await strapi.db.query('api::order.order').count({
          where: { ...activeUsageFilter, user: userId },
        });
        if (userUsage >= voucher.usageLimitPerUser) {
          throw new ApplicationError('Voucher ini sudah pernah kamu pakai');
        }
      }

      discount =
        voucher.discountType === 'percentage'
          ? subtotal * (Number(voucher.discountValue) / 100)
          : Number(voucher.discountValue);

      if (voucher.discountType === 'percentage' && voucher.maxDiscountAmount) {
        discount = Math.min(discount, Number(voucher.maxDiscountAmount));
      }
      discount = Math.min(discount, subtotal);
      discount = Math.round(discount);
    }

    data.discount = discount;

    // totalAmount = subtotal & discount (server-trusted) + tax & shippingCost.
    // CATATAN: tax & shippingCost MASIH sepenuhnya dipercaya dari client —
    // tidak ada rate table/shipping config di codebase ini untuk menghitung
    // ulang keduanya. Ini known gap, bukan sesuatu yang sudah aman.
    const tax = Number(data.tax ?? 0);
    const shippingCost = Number(data.shippingCost ?? 0);
    data.totalAmount = subtotal + tax + shippingCost - discount;
  },

  async afterCreate(event: any) {
    const { result } = event;

    // Manual bank transfer: create the linked manual-payment record.
    if (result.paymentMethod === 'manual_transfer') {
      try {
        const existing = await strapi.documents('api::manual-payment.manual-payment').findFirst({
          filters: { order: { documentId: result.documentId } },
        });
        if (!existing) {
          await strapi.documents('api::manual-payment.manual-payment').create({
            data: {
              status: 'awaiting_proof',
              expectedAmount: Number(result.totalAmount) || 0,
              order: result.documentId,
            },
          });
        }
      } catch (err: any) {
        strapi.log.error('Failed to create manual-payment for order:', err);
      }
    }

    // ---- existing email-confirmation logic continues below ----
    try {
      const order = await strapi.documents('api::order.order').findOne({
        documentId: result.documentId,
        populate: ['user', 'items', 'shippingAddress'],
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

      await strapi.plugins['email'].services.email.send({
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
      const becamePaid = data.paymentStatus && result.paymentStatus === 'paid';

      if (becamePaid) {
        try {
          const paidOrder = await strapi.documents('api::order.order').findOne({
            documentId: result.documentId,
            populate: ['user'],
          }) as any;

          await strapi.service('api::analytics.analytics').createPurchaseFromOrder(paidOrder);
        } catch (err: any) {
          strapi.log.error('Failed to create analytics purchase event:', err);
        }
      }

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

        if (item.variantSku) {
          const qty = Number(item.quantity) || 0;
          await incrementVariantInventory(strapi, item.variantSku, item.productDocumentId, qty);
          strapi.log.info(`Restored variant ${item.variantSku} inventory by ${qty}`);
        } else {
          const qty = Number(item.quantity) || 0;
          await strapi.db.connection.raw(
            `UPDATE products SET inventory = inventory + :qty WHERE document_id = :documentId`,
            { documentId: item.productDocumentId, qty }
          );
          strapi.log.info(`Restored product ${item.productDocumentId} inventory by ${qty}`);
        }
      }
    } catch (err: any) {
      strapi.log.error('Failed to restore inventory on order update:', err);
    }
  },
};
