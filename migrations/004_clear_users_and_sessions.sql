-- Clear sessions and registered users (one-time wipe; e.g. after password algorithm change).
DELETE FROM "session";
DELETE FROM users;
