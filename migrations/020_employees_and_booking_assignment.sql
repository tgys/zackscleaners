-- Cleaners / employees for booking assignment (managed in admin Settings).
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_active ON employees (active, name);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS assigned_employee_id UUID REFERENCES employees (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_assigned_employee ON bookings (assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);

COMMENT ON TABLE employees IS 'Cleaners/staff assignable to bookings from admin overview.';
COMMENT ON COLUMN bookings.assigned_employee_id IS 'Cleaner assigned to this booking (nullable).';
