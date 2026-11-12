ALTER TABLE notifications ADD COLUMN source_key text;
ALTER TABLE notifications ADD COLUMN action_path text NOT NULL DEFAULT '/';
CREATE UNIQUE INDEX notification_source ON notifications(staff_id,source_key);
