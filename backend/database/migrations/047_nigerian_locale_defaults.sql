-- Switch the deployment to Nigerian currency (NGN / ₦) and timezone
-- (Africa/Lagos, WAT). New organizations get these from
-- auth.service.DEFAULT_SETTINGS; this brings EXISTING organizations in
-- line by replacing the old USD/UTC/ISO defaults.
--
-- Scoped to rows that still hold the previous defaults, so an
-- organization that had deliberately been set to something else is left
-- untouched.
UPDATE settings SET value = 'NGN', updated_at = NOW()
    WHERE key_name = 'currency' AND value = 'USD';

UPDATE settings SET value = 'Africa/Lagos', updated_at = NOW()
    WHERE key_name = 'timezone' AND value = 'UTC';

UPDATE settings SET value = 'DD/MM/YYYY', updated_at = NOW()
    WHERE key_name = 'date_format' AND value = 'YYYY-MM-DD';
