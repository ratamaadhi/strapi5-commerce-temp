import { computeApprovalEffects, type ManualPaymentStatus } from '../../services/logic';

export default {
  async afterUpdate(event: any) {
    const { result, params } = event;
    // Only react when this update set `status`.
    const newStatus = params?.data?.status as ManualPaymentStatus | undefined;
    if (!newStatus || (newStatus !== 'approved' && newStatus !== 'rejected')) return;

    const strapi = (global as any).strapi;

    const manualPayment = await strapi.documents('api::manual-payment.manual-payment').findOne({
      documentId: result.documentId,
      populate: { order: true, proofs: true },
    });
    if (!manualPayment?.order) return;

    const order = manualPayment.order;
    const effects = computeApprovalEffects(newStatus, order.paymentStatus);
    const now = new Date().toISOString();

    // Stamp the latest proof.
    if (effects.stampProof && Array.isArray(manualPayment.proofs) && manualPayment.proofs.length) {
      const proofs = manualPayment.proofs.map((p: any) => ({
        image: p.image?.id ?? p.image,
        senderName: p.senderName,
        senderBank: p.senderBank,
        transferAmount: p.transferAmount,
        transferDate: p.transferDate,
        referenceNote: p.referenceNote,
        destinationBankName: p.destinationBankName,
        destinationAccountNumber: p.destinationAccountNumber,
        proofStatus: p.proofStatus,
        submittedAt: p.submittedAt,
      }));
      proofs[proofs.length - 1].proofStatus = effects.stampProof;

      await strapi.documents('api::manual-payment.manual-payment').update({
        documentId: manualPayment.documentId,
        data: { proofs, reviewedAt: now },
      });
    } else {
      await strapi.documents('api::manual-payment.manual-payment').update({
        documentId: manualPayment.documentId,
        data: { reviewedAt: now },
      });
    }

    if (effects.markPaid) {
      await strapi.documents('api::order.order').update({
        documentId: order.documentId,
        data: { paymentStatus: 'paid', paidAt: now },
      });
    }
  },
};
