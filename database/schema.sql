CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  role VARCHAR(100) NULL,
  team VARCHAR(100) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS meetings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  meeting_type ENUM('meeting','work_transfer') NOT NULL DEFAULT 'meeting',
  agenda TEXT NULL,
  scheduled_at DATETIME NULL,
  status ENUM('draft','scheduled','completed','cancelled') NOT NULL DEFAULT 'draft',
  facilitator_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_meeting_facilitator FOREIGN KEY (facilitator_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_meeting_creator FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_meeting_schedule (scheduled_at),
  INDEX idx_meeting_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  attendance_status ENUM('invited','attended','absent') NOT NULL DEFAULT 'invited',
  participant_role VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (meeting_id,user_id),
  CONSTRAINT fk_mp_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_mp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS meeting_notes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meeting_id BIGINT UNSIGNED NOT NULL,
  note_type ENUM('agenda','discussion','transcript','summary','other') NOT NULL DEFAULT 'discussion',
  content LONGTEXT NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_note_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_note_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FULLTEXT KEY ft_meeting_notes (content)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS decisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meeting_id BIGINT UNSIGNED NOT NULL,
  decision_text TEXT NOT NULL,
  rationale TEXT NULL,
  decided_by BIGINT UNSIGNED NULL,
  decision_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_decision_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_decision_user FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_decision_meeting (meeting_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS action_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_meeting_id BIGINT UNSIGNED NOT NULL,
  current_meeting_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  owner_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  due_date DATE NULL,
  priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  status ENUM('open','in_progress','blocked','completed','cancelled') NOT NULL DEFAULT 'open',
  outcome TEXT NULL,
  completed_at DATETIME NULL,
  carry_forward_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_action_source_meeting FOREIGN KEY (source_meeting_id) REFERENCES meetings(id),
  CONSTRAINT fk_action_current_meeting FOREIGN KEY (current_meeting_id) REFERENCES meetings(id),
  CONSTRAINT fk_action_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_action_creator FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_action_owner (owner_id),
  INDEX idx_action_status (status),
  INDEX idx_action_due (due_date),
  INDEX idx_action_current_meeting (current_meeting_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS action_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action_item_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('created','assigned','reassigned','status_changed','carried_forward','outcome_recorded','updated','comment_added') NOT NULL,
  previous_status ENUM('open','in_progress','blocked','completed','cancelled') NULL,
  new_status ENUM('open','in_progress','blocked','completed','cancelled') NULL,
  previous_owner_id BIGINT UNSIGNED NULL,
  new_owner_id BIGINT UNSIGNED NULL,
  from_meeting_id BIGINT UNSIGNED NULL,
  to_meeting_id BIGINT UNSIGNED NULL,
  actor_id BIGINT UNSIGNED NULL,
  details TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_history_task FOREIGN KEY (action_item_id) REFERENCES action_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_history_prev_owner FOREIGN KEY (previous_owner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_history_new_owner FOREIGN KEY (new_owner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_history_from_meeting FOREIGN KEY (from_meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
  CONSTRAINT fk_history_to_meeting FOREIGN KEY (to_meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
  CONSTRAINT fk_history_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_history_task (action_item_id),
  INDEX idx_history_event (event_type),
  INDEX idx_history_time (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  document_type ENUM('document','policy','guide','reference','meeting_record','other') NOT NULL DEFAULT 'document',
  content LONGTEXT NOT NULL,
  source_url VARCHAR(2048) NULL,
  tags VARCHAR(500) NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_knowledge_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  FULLTEXT KEY ft_knowledge (title,content,tags),
  INDEX idx_knowledge_type (document_type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS knowledge_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id BIGINT UNSIGNED NOT NULL,
  meeting_id BIGINT UNSIGNED NULL,
  action_item_id BIGINT UNSIGNED NULL,
  decision_id BIGINT UNSIGNED NULL,
  relevance_note TEXT NULL,
  linked_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_kl_document FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_kl_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_kl_action FOREIGN KEY (action_item_id) REFERENCES action_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_kl_decision FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE,
  CONSTRAINT fk_kl_user FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_knowledge_target CHECK (
    (meeting_id IS NOT NULL AND action_item_id IS NULL AND decision_id IS NULL) OR
    (meeting_id IS NULL AND action_item_id IS NOT NULL AND decision_id IS NULL) OR
    (meeting_id IS NULL AND action_item_id IS NULL AND decision_id IS NOT NULL)
  ),
  UNIQUE KEY uq_knowledge_meeting (document_id,meeting_id),
  UNIQUE KEY uq_knowledge_action (document_id,action_item_id),
  UNIQUE KEY uq_knowledge_decision (document_id,decision_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_generations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id CHAR(36) NULL,
  generation_type ENUM('meeting_extraction','catch_up_brief','knowledge_recommendation') NOT NULL,
  meeting_id BIGINT UNSIGNED NULL,
  requested_by BIGINT UNSIGNED NULL,
  target_user_id BIGINT UNSIGNED NULL,
  provider_name VARCHAR(100) NOT NULL,
  model_name VARCHAR(150) NULL,
  input_text LONGTEXT NULL,
  output_json JSON NULL,
  status ENUM('succeeded','failed') NOT NULL,
  review_status ENUM('pending','approved','rejected','not_required') NOT NULL DEFAULT 'pending',
  latency_ms INT UNSIGNED NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_requester FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_target FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ai_type (generation_type),
  INDEX idx_ai_status (status),
  INDEX idx_ai_review (review_status),
  INDEX idx_ai_created (created_at)
) ENGINE=InnoDB;
