/**
 * manual-payment controller — customer proof upload
 */

import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { validateProofFile } from '../services/logic';

const { ApplicationError, ForbiddenError, NotFoundError } = errors;

export default factories.createCoreController(
  'api::manual-payment.manual-payment',
  ({ strapi }) => ({
    async uploadProof(ctx) {
      const user = ctx.state.user;
      if (!user) throw new ForbiddenError('Login diperlukan');

      const { orderDocumentId } = ctx.params as { orderDocumentId: string };

      const order = await strapi.documents('api::order.order').findOne({
        documentId: orderDocumentId,
        populate: { user: true, manualPayment: { populate: { proofs: true } } },
      });
      if (!order) throw new NotFoundError('Order tidak ditemukan');

      if ((order.user as any)?.documentId !== user.documentId) {
        throw new ForbiddenError('Order ini bukan milik Anda');
      }

      const manualPayment = (order as any).manualPayment;
      if (!manualPayment) throw new ApplicationError('Order ini bukan pembayaran manual');

      if (!['awaiting_proof', 'rejected'].includes(manualPayment.reviewStatus)) {
        return ctx.badRequest('Cannot upload proof in current payment status');
      }

      if (order.paymentStatus === 'cancelled' || order.paymentStatus === 'failed') {
        return ctx.badRequest('Order is no longer active');
      }

      // Retrieve uploaded file from multipart request
      const allFiles = (ctx.request as any).files ?? {};
      const rawFile = allFiles.files ?? allFiles.image ?? null;
      const file = Array.isArray(rawFile) ? rawFile[0] : rawFile;

      const check = validateProofFile(file);
      if (!check.ok) throw new ApplicationError((check as { ok: false; error: string }).error);

      // Upload file via Strapi upload plugin
      const uploaded = await strapi
        .plugin('upload')
        .service('upload')
        .upload({
          data: {},
          files: file,
        });

      const imageId = uploaded?.[0]?.id;
      if (!imageId) throw new ApplicationError('Gagal mengunggah file');

      // Collect metadata from request body
      // Strapi 5 multipart passes `data` field as a JSON string
      const rawBody = (ctx.request as any).body ?? {};
      let body: Record<string, unknown> = rawBody;
      if (typeof rawBody.data === 'string') {
        try {
          body = JSON.parse(rawBody.data);
        } catch {
          body = {};
        }
      } else if (rawBody.data && typeof rawBody.data === 'object') {
        body = rawBody.data as Record<string, unknown>;
      }

      // Build existing proofs list (preserve existing entries)
      const existingProofs: any[] = (manualPayment.proofs ?? []).map((p: any) => ({
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

      // Append new proof entry
      existingProofs.push({
        image: imageId,
        senderName: body.senderName ?? null,
        senderBank: body.senderBank ?? null,
        transferAmount: body.transferAmount != null ? Number(body.transferAmount) : null,
        transferDate: body.transferDate ?? null,
        referenceNote: body.referenceNote ?? null,
        destinationBankName: body.destinationBankName ?? null,
        destinationAccountNumber: body.destinationAccountNumber ?? null,
        proofStatus: 'pending',
        submittedAt: new Date().toISOString(),
      });

      const updated = await strapi.documents('api::manual-payment.manual-payment').update({
        documentId: manualPayment.documentId,
        data: {
          reviewStatus: 'under_review',
          proofs: existingProofs,
        },
        populate: { proofs: true },
      });

      ctx.body = { data: updated };
    },
  }),
);
