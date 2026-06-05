-- Admin hides booking from dashboards while preserving the row + optional Square refund audit.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS admin_removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS square_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS square_refund_status TEXT;

COMMENT ON COLUMN bookings.admin_removed_at IS
  'When set, hidden from overview / active booking lists but retained for audit (refunded or removed-only).';

COMMENT ON COLUMN bookings.square_refund_id IS 'Square PaymentRefund id from Refunds API refundPayment.';
COMMENT ON COLUMN bookings.square_refund_status IS 'Square refund status snapshot (COMPLETED/PENDING/etc.).';



