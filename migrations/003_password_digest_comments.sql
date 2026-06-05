-- Refresh DB comments when upgrading from bcrypt-only wording (safe no-op on schema).
COMMENT ON TABLE users IS 'Application accounts; password_hash is a password digest only.';
COMMENT ON COLUMN users.password_hash IS 'Password digest (never plaintext).';
