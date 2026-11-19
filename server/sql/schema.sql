-- Safe additive schema: leaves your existing users/organizations tables untouched.
CREATE DATABASE IF NOT EXISTS waitless_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE waitless_db;
CREATE TABLE IF NOT EXISTS wl_users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 full_name VARCHAR(120) NOT NULL,
 email VARCHAR(190) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 role ENUM('student','staff','admin') NOT NULL DEFAULT 'student',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wl_services (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(140) NOT NULL UNIQUE,
 avg_duration_min INT NOT NULL DEFAULT 10,
 is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wl_counters (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 label VARCHAR(60) NOT NULL UNIQUE,
 service_id BIGINT UNSIGNED NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY (service_id) REFERENCES wl_services(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wl_tokens (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 token_code VARCHAR(40) NOT NULL UNIQUE,
 user_id BIGINT UNSIGNED NOT NULL,
 service_id BIGINT UNSIGNED NOT NULL,
 counter_id BIGINT UNSIGNED NULL,
 status ENUM('waiting','called','serving','completed','skipped','cancelled') NOT NULL DEFAULT 'waiting',
 predicted_minutes INT NULL,
 prediction_source VARCHAR(30) NULL,
 issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 called_at TIMESTAMP NULL,
 started_at TIMESTAMP NULL,
 completed_at TIMESTAMP NULL,
 FOREIGN KEY (user_id) REFERENCES wl_users(id),
 FOREIGN KEY (service_id) REFERENCES wl_services(id),
 FOREIGN KEY (counter_id) REFERENCES wl_counters(id),
 INDEX idx_queue (service_id,status,issued_at),
 INDEX idx_user (user_id,issued_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wl_daily_sequences (
 day_key DATE NOT NULL,
 service_id BIGINT UNSIGNED NOT NULL,
`last_value` INT NOT NULL,
 PRIMARY KEY (day_key,service_id),
 FOREIGN KEY (service_id) REFERENCES wl_services(id)
) ENGINE=InnoDB;
INSERT IGNORE INTO wl_services (name,avg_duration_min) VALUES
 ('Registrar Office',12),('Accounts & Fees',8),('Academic Advising',15),('Certificate Collection',6);
INSERT IGNORE INTO wl_counters (label,service_id)
 SELECT CONCAT('Counter-', s.id),s.id FROM wl_services s;
