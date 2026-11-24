-- Preserve internal staff UUIDs and historical foreign keys while supporting Firebase UIDs.
ALTER TABLE staff ADD COLUMN firebase_uid text UNIQUE;
ALTER TABLE staff ADD CONSTRAINT staff_firebase_uid_length CHECK (firebase_uid IS NULL OR length(firebase_uid) BETWEEN 1 AND 128);
COMMENT ON COLUMN staff.firebase_uid IS 'Verified Firebase Authentication UID; never infer membership from email or token role claims';
