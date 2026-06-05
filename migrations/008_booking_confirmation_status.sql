-- Booking workflow: submitted jobs await admin approval before they are confirmed.
ALTER TABLE bookings
  ALTER COLUMN status SET DEFAULT 'pending_confirmation';

UPDATE bookings SET status = 'pending_confirmation' WHERE status = 'pending';

COMMENT ON COLUMN bookings.status IS
  'pending_confirmation = submitted, awaiting admin approval; confirmed = approved / on schedule; rejected = declined by admin; cancelled = cancelled (cancelled_at may be set).';
