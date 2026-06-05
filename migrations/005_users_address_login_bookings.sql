-- Profile / audit fields on users; bookings tied to registered accounts (admin reporting).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  address TEXT,
  cleaning_type TEXT,
  addons JSONB,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings (created_at DESC);

COMMENT ON COLUMN users.address IS 'Optional profile / service address; may be filled from booking flows.';
COMMENT ON COLUMN users.last_login_at IS 'Last successful password login for this row (not set for env-only admin).';
COMMENT ON TABLE bookings IS 'Booking requests per user; cancellations use status=cancelled and cancelled_at.';
