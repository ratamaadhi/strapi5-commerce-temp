export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const MANUAL_PAYMENT_TTL_HOURS = 24;

export interface BankAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  isActive?: boolean;
}

export interface PaymentMethodsView {
  gateway: boolean;
  manualTransfer: boolean;
  bankAccounts: Array<Pick<BankAccount, 'bankName' | 'accountNumber' | 'accountHolder'>>;
}

export type PaymentMethod = 'gateway' | 'manual_transfer';
export type ManualPaymentStatus = 'awaiting_proof' | 'under_review' | 'approved' | 'rejected';

interface StoreSettingLike {
  gatewayEnabled?: boolean;
  manualTransferEnabled?: boolean;
  bankAccounts?: BankAccount[];
}

export function resolvePaymentMethods(setting: StoreSettingLike): PaymentMethodsView {
  const gateway = setting?.gatewayEnabled !== false; // default true
  const manualTransfer = setting?.manualTransferEnabled === true;
  const bankAccounts = manualTransfer
    ? (setting?.bankAccounts ?? [])
        .filter((b) => b.isActive !== false)
        .map(({ bankName, accountNumber, accountHolder }) => ({
          bankName,
          accountNumber,
          accountHolder,
        }))
    : [];
  return { gateway, manualTransfer, bankAccounts };
}

export function isPaymentMethodEnabled(method: PaymentMethod, setting: StoreSettingLike): boolean {
  if (method === 'manual_transfer') return setting?.manualTransferEnabled === true;
  return setting?.gatewayEnabled !== false;
}

interface ProofFileLike {
  mime?: string;
  type?: string;
  size?: number;
}

export function validateProofFile(
  file: ProofFileLike | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!file) return { ok: false, error: 'Bukti pembayaran wajib diunggah' };
  const mime = file.mime ?? file.type ?? '';
  if (!PROOF_ALLOWED_MIME.includes(mime)) {
    return { ok: false, error: 'Format file harus JPEG, PNG, atau WEBP' };
  }
  if ((file.size ?? 0) > PROOF_MAX_BYTES) {
    return { ok: false, error: 'Ukuran file maksimal 5MB' };
  }
  return { ok: true };
}

export function computeApprovalEffects(
  newStatus: ManualPaymentStatus,
  currentOrderPaymentStatus: string,
): { markPaid: boolean; stampProof: 'approved' | 'rejected' | null } {
  if (newStatus === 'approved') {
    if (currentOrderPaymentStatus === 'paid') return { markPaid: false, stampProof: null };
    return { markPaid: true, stampProof: 'approved' };
  }
  if (newStatus === 'rejected') {
    return { markPaid: false, stampProof: 'rejected' };
  }
  return { markPaid: false, stampProof: null };
}

export function isManualPaymentExpired(
  order: { createdAt: string | Date; paymentStatus: string },
  manualStatus: ManualPaymentStatus,
  now: Date = new Date(),
  ttlHours: number = MANUAL_PAYMENT_TTL_HOURS,
): boolean {
  if (order.paymentStatus !== 'pending') return false;
  if (manualStatus !== 'awaiting_proof' && manualStatus !== 'under_review') return false;
  const created = new Date(order.createdAt).getTime();
  return now.getTime() - created > ttlHours * 60 * 60 * 1000;
}
