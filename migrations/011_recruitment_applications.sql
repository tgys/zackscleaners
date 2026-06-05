-- Recruitment applications with CV stored on disk (path relative to RECRUITMENT_CV_DIR).

CREATE TABLE IF NOT EXISTS recruitment_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  mobile TEXT NOT NULL,
  cv_stored_filename TEXT NOT NULL,
  cv_original_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recruitment_applications_created_at_idx
  ON recruitment_applications (created_at DESC);
