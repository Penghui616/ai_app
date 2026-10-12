-- Reference only. Confirm company authorization and the database name first.
CREATE DATABASE IF NOT EXISTS `vision_lab_dev`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Replace both placeholders. Use the backend machine permitted host/IP.
-- CREATE USER 'vision_lab_app'@'<BACKEND_HOST>' IDENTIFIED BY '<STRONG_PASSWORD>';
-- GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX
--   ON `vision_lab_dev`.* TO 'vision_lab_app'@'<BACKEND_HOST>';
-- Application tables: vl_projects, vl_training_runs. No global privileges needed.
