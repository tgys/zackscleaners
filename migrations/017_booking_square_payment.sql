-- Payment metadata for bookings processed via Square Web Payments SDK + Payments API.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS square_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS checkout_amount_cents INTEGER;

COMMENT ON COLUMN bookings.square_payment_id IS 'Square Payments API payment id when checkout completed online.';
COMMENT ON COLUMN bookings.checkout_amount_cents IS 'Amount charged at checkout (USD cents); mirrors tariff quote used for payment.';
