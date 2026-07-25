-- "Vital data" on a staff member — HR-style details (contact, next of
-- kin, bank, salary, benefits) attached to the user record WITHOUT a
-- separate HR module. Filled in from the Staff → Update drawer. These
-- fields are sensitive (salary especially): only a super_admin/developer
-- may view or change them (enforced in users.service), so no
-- application-level default is exposed to ordinary admins.
ALTER TABLE users
    ADD COLUMN position VARCHAR(120),
    ADD COLUMN employment_date DATE,
    ADD COLUMN phone VARCHAR(40),
    ADD COLUMN address TEXT,
    ADD COLUMN date_of_birth DATE,
    ADD COLUMN gender VARCHAR(20),
    ADD COLUMN next_of_kin VARCHAR(160),
    ADD COLUMN next_of_kin_phone VARCHAR(40),
    ADD COLUMN national_id VARCHAR(60),
    ADD COLUMN bank_name VARCHAR(120),
    ADD COLUMN bank_account_number VARCHAR(40),
    ADD COLUMN salary NUMERIC(14, 2),
    ADD COLUMN benefits TEXT;
