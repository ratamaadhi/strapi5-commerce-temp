import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePaymentMethods,
  isPaymentMethodEnabled,
  validateProofFile,
  computeApprovalEffects,
  isManualPaymentExpired,
  PROOF_MAX_BYTES,
} from '../src/api/manual-payment/services/logic';

test('resolvePaymentMethods defaults gateway on, manual off, hides banks', () => {
  const r = resolvePaymentMethods({});
  assert.equal(r.gateway, true);
  assert.equal(r.manualTransfer, false);
  assert.deepEqual(r.bankAccounts, []);
});

test('resolvePaymentMethods exposes only active banks when manual on', () => {
  const r = resolvePaymentMethods({
    manualTransferEnabled: true,
    bankAccounts: [
      { bankName: 'BCA', accountNumber: '123', accountHolder: 'Toko', isActive: true },
      { bankName: 'BNI', accountNumber: '999', accountHolder: 'Toko', isActive: false },
    ],
  });
  assert.equal(r.manualTransfer, true);
  assert.deepEqual(r.bankAccounts, [
    { bankName: 'BCA', accountNumber: '123', accountHolder: 'Toko' },
  ]);
});

test('resolvePaymentMethods hides banks when manual disabled', () => {
  const r = resolvePaymentMethods({
    manualTransferEnabled: false,
    bankAccounts: [{ bankName: 'BCA', accountNumber: '123', accountHolder: 'Toko', isActive: true }],
  });
  assert.deepEqual(r.bankAccounts, []);
});

test('isPaymentMethodEnabled enforces toggles', () => {
  assert.equal(isPaymentMethodEnabled('manual_transfer', { manualTransferEnabled: true }), true);
  assert.equal(isPaymentMethodEnabled('manual_transfer', { manualTransferEnabled: false }), false);
  assert.equal(isPaymentMethodEnabled('gateway', {}), true);
  assert.equal(isPaymentMethodEnabled('gateway', { gatewayEnabled: false }), false);
});

test('validateProofFile accepts a small jpeg', () => {
  assert.deepEqual(validateProofFile({ mime: 'image/jpeg', size: 1000 }), { ok: true });
});

test('validateProofFile rejects missing file', () => {
  const r = validateProofFile(null);
  assert.equal(r.ok, false);
});

test('validateProofFile rejects wrong mime', () => {
  const r = validateProofFile({ mime: 'application/pdf', size: 1000 });
  assert.equal(r.ok, false);
});

test('validateProofFile rejects oversize file', () => {
  const r = validateProofFile({ mime: 'image/png', size: PROOF_MAX_BYTES + 1 });
  assert.equal(r.ok, false);
});

test('computeApprovalEffects marks paid on first approval', () => {
  assert.deepEqual(computeApprovalEffects('approved', 'pending'), { markPaid: true, stampProof: 'approved' });
});

test('computeApprovalEffects is idempotent when already paid', () => {
  assert.deepEqual(computeApprovalEffects('approved', 'paid'), { markPaid: false, stampProof: null });
});

test('computeApprovalEffects on reject stamps proof, no paid', () => {
  assert.deepEqual(computeApprovalEffects('rejected', 'pending'), { markPaid: false, stampProof: 'rejected' });
});

test('computeApprovalEffects ignores non-terminal transitions', () => {
  assert.deepEqual(computeApprovalEffects('under_review', 'pending'), { markPaid: false, stampProof: null });
});

test('isManualPaymentExpired true when pending and older than ttl', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const order = { createdAt: '2026-07-18T11:00:00Z', paymentStatus: 'pending' };
  assert.equal(isManualPaymentExpired(order, 'awaiting_proof', now), true);
});

test('isManualPaymentExpired false when recent', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const order = { createdAt: '2026-07-19T10:00:00Z', paymentStatus: 'pending' };
  assert.equal(isManualPaymentExpired(order, 'under_review', now), false);
});

test('isManualPaymentExpired false when already paid', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const order = { createdAt: '2026-07-17T10:00:00Z', paymentStatus: 'paid' };
  assert.equal(isManualPaymentExpired(order, 'approved', now), false);
});
