export default ({ strapi }: { strapi: any }) => ({
  getServerKey(): string {
    return process.env.MIDTRANS_SERVER_KEY ?? '';
  },

  getSnapUrl(): string {
    return process.env.MIDTRANS_SNAP_URL ?? 'https://app.sandbox.midtrans.com/snap/v1/transactions';
  },

  getAuthHeader(): string {
    const serverKey = this.getServerKey();
    return 'Basic ' + Buffer.from(serverKey + ':').toString('base64');
  },

  async generateSnapToken(params: {
    orderId: string;
    grossAmount: number;
    customerDetails: {
      firstName: string;
      email: string;
      phone: string;
    };
    itemDetails: Array<{
      id: string;
      price: number;
      quantity: number;
      name: string;
    }>;
  }): Promise<{ token: string; redirectUrl: string }> {
    const body = {
      transaction_details: {
        order_id: params.orderId,
        gross_amount: params.grossAmount,
      },
      customer_details: {
        first_name: params.customerDetails.firstName,
        email: params.customerDetails.email,
        phone: params.customerDetails.phone,
      },
      item_details: params.itemDetails,
    };

    const response = await fetch(this.getSnapUrl(), {
      method: 'POST',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Midtrans Snap API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as any;
    return { token: data.token, redirectUrl: data.redirect_url };
  },

  validateSignature(payload: {
    orderId: string;
    statusCode: string;
    grossAmount: string;
    signatureKey: string;
  }): boolean {
    const serverKey = this.getServerKey();
    const input = payload.orderId + payload.statusCode + payload.grossAmount + serverKey;
    const crypto = require('crypto');
    const expected = crypto.createHash('sha512').update(input).digest('hex');
    return expected === payload.signatureKey;
  },

  mapPaymentStatus(midtransStatus: string): string {
    const mapping: Record<string, string> = {
      settlement: 'paid',
      capture: 'paid',
      pending: 'pending',
      deny: 'failed',
      expire: 'failed',
      cancel: 'failed',
      refund: 'refunded',
      partial_refund: 'refunded',
    };
    return mapping[midtransStatus] ?? 'pending';
  },
});
