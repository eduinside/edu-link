-- migrations/0004_add_password_to_urls.sql
ALTER TABLE urls ADD COLUMN password TEXT;
