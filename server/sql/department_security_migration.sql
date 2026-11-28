-- WaitLess v2 migration. Run ONCE in MySQL Workbench after backup.
-- Existing users, queues, tokens, services and counters are preserved.
USE waitless_db;

-- Add active/disabled account flag only if it does not exist yet.
SET @exists_column = (
 SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wl_users' AND COLUMN_NAME = 'is_active'
);
SET @statement = IF(@exists_column = 0,
 'ALTER TABLE wl_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
 'SELECT 1');
PREPARE add_user_active FROM @statement;
EXECUTE add_user_active;
DEALLOCATE PREPARE add_user_active;

-- Each staff member has ONE service and ONE counter assignment.
CREATE TABLE IF NOT EXISTS wl_staff_assignments (
 staff_user_id BIGINT UNSIGNED PRIMARY KEY,
 service_id BIGINT UNSIGNED NOT NULL,
 counter_id BIGINT UNSIGNED NOT NULL,
 is_active TINYINT(1) NOT NULL DEFAULT 1,
 assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_staff_assignment_user FOREIGN KEY (staff_user_id) REFERENCES wl_users(id),
 CONSTRAINT fk_staff_assignment_service FOREIGN KEY (service_id) REFERENCES wl_services(id),
 CONSTRAINT fk_staff_assignment_counter FOREIGN KEY (counter_id) REFERENCES wl_counters(id),
 INDEX idx_staff_service (service_id,is_active),
 INDEX idx_staff_counter (counter_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wl_token_audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 token_id BIGINT UNSIGNED NOT NULL,
 service_id BIGINT UNSIGNED NOT NULL,
 action VARCHAR(32) NOT NULL,
 old_status VARCHAR(24) NULL,
 new_status VARCHAR(24) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES wl_users(id),
 CONSTRAINT fk_audit_token FOREIGN KEY (token_id) REFERENCES wl_tokens(id),
 CONSTRAINT fk_audit_service FOREIGN KEY (service_id) REFERENCES wl_services(id),
 INDEX idx_audit_token (token_id,created_at),
 INDEX idx_audit_service (service_id,created_at)
) ENGINE=InnoDB;

-- VIEW ONLY: find available staff and counters for assignment.
SELECT u.id AS staff_id,u.email,u.is_active FROM wl_users u WHERE u.role='staff';
SELECT c.id AS counter_id,c.label,c.service_id,s.name AS service_name
FROM wl_counters c JOIN wl_services s ON s.id=c.service_id ORDER BY s.id,c.id;

-- After this migration, use the Admin API to assign each existing staff user.
-- Do not grant default access to all departments.
