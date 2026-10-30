-- Knowledge-transfer workflow. Idempotent: safe to re-run.
ALTER TABLE ai_generations MODIFY generation_type ENUM('meeting_extraction','catch_up_brief','knowledge_recommendation','transfer_report','transfer_answer') NOT NULL;
ALTER TABLE action_history MODIFY event_type ENUM('created','assigned','reassigned','status_changed','carried_forward','outcome_recorded','updated','comment_added','transferred') NOT NULL;

CREATE TABLE IF NOT EXISTS transfer_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  project_name VARCHAR(150) NOT NULL,
  manager_id BIGINT UNSIGNED NOT NULL,
  outgoing_user_id BIGINT UNSIGNED NOT NULL,
  successor_user_id BIGINT UNSIGNED NOT NULL,
  meeting_id BIGINT UNSIGNED NULL,
  status ENUM('initiated','capturing','pending_review','changes_requested','onboarding','completed') NOT NULL DEFAULT 'initiated',
  due_date DATE NULL,
  approved_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ts_manager FOREIGN KEY (manager_id) REFERENCES users(id),
  CONSTRAINT fk_ts_out FOREIGN KEY (outgoing_user_id) REFERENCES users(id),
  CONSTRAINT fk_ts_succ FOREIGN KEY (successor_user_id) REFERENCES users(id),
  CONSTRAINT fk_ts_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
  CONSTRAINT chk_ts_distinct CHECK (outgoing_user_id <> successor_user_id),
  INDEX idx_ts_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfer_inputs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  input_type ENUM('project_info','process','decision','technical_doc') NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  document_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ti_session FOREIGN KEY (session_id) REFERENCES transfer_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ti_doc FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_ti_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfer_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  generation_id BIGINT UNSIGNED NULL,
  provider_name VARCHAR(100) NOT NULL,
  content_json JSON NOT NULL,
  review_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewer_id BIGINT UNSIGNED NULL,
  review_comment TEXT NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tr_session FOREIGN KEY (session_id) REFERENCES transfer_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_tr_gen FOREIGN KEY (generation_id) REFERENCES ai_generations(id) ON DELETE SET NULL,
  UNIQUE KEY uq_tr_version (session_id, version)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfer_checklist_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  document_id BIGINT UNSIGNED NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at DATETIME NULL,
  CONSTRAINT fk_tc_session FOREIGN KEY (session_id) REFERENCES transfer_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_tc_doc FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfer_tasks (
  session_id BIGINT UNSIGNED NOT NULL,
  action_item_id BIGINT UNSIGNED NOT NULL,
  from_user_id BIGINT UNSIGNED NULL,
  to_user_id BIGINT UNSIGNED NOT NULL,
  transferred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at DATETIME NULL,
  PRIMARY KEY (session_id, action_item_id),
  CONSTRAINT fk_tt_session FOREIGN KEY (session_id) REFERENCES transfer_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_task FOREIGN KEY (action_item_id) REFERENCES action_items(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfer_questions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  asked_by BIGINT UNSIGNED NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  citations JSON NULL,
  grounded BOOLEAN NOT NULL DEFAULT TRUE,
  provider_name VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tq_session FOREIGN KEY (session_id) REFERENCES transfer_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
