-- A user's passport photo, shown on their avatar and profile. Stored
-- inline as a small base64 image data URI (resized in the browser before
-- upload, same approach as the organization receipt logo), so there's no
-- file-storage dependency — fitting for the offline-first design.
ALTER TABLE users
    ADD COLUMN photo TEXT;
