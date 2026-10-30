-- Idempotent demonstration dataset. The people and records are fictional.
INSERT IGNORE INTO users (id,full_name,email,role,team) VALUES
(1,'Ananya Desai','ananya@contextflow.demo','Project Manager','Management'),
(2,'Rahul Mehta','rahul@contextflow.demo','Backend Developer','Engineering'),
(3,'Priya Nair','priya@contextflow.demo','QA Engineer','Quality Assurance'),
(4,'Arjun Shah','arjun@contextflow.demo','Frontend Developer','Engineering');

INSERT IGNORE INTO meetings (id,title,meeting_type,agenda,scheduled_at,status,facilitator_id,created_by) VALUES
(1,'Sprint Planning - Authentication Module','meeting','Plan authentication implementation, assign development responsibilities and agree on API security.','2026-10-20 10:00:00','completed',1,1),
(2,'Weekly Project Review','meeting','Review authentication progress, discuss pending tasks and agree on follow-up actions.','2026-10-27 11:00:00','completed',1,1),
(3,'Engineering Work Handover','work_transfer','Review outstanding engineering tasks, decisions and technical documentation.','2026-10-29 15:00:00','completed',1,1);

INSERT IGNORE INTO meeting_participants (meeting_id,user_id,attendance_status,participant_role) VALUES
(1,1,'attended','Facilitator'),(1,2,'attended','Backend Developer'),(1,3,'attended','QA Engineer'),(1,4,'attended','Frontend Developer'),
(2,1,'attended','Facilitator'),(2,2,'attended','Backend Developer'),(2,3,'attended','QA Engineer'),(2,4,'attended','Frontend Developer'),
(3,1,'attended','Facilitator'),(3,2,'attended','Outgoing Owner'),(3,3,'attended','Quality Reviewer'),(3,4,'absent','Incoming Team Member');

INSERT IGNORE INTO meeting_notes (id,meeting_id,note_type,content,created_by) VALUES
(1,1,'discussion','The team discussed the authentication module. Rahul will implement the JWT-based login API by November 3, 2026. Priya will prepare QA test cases and test the API by November 5, 2026. Arjun will prepare the authentication dashboard wireframe by October 26, 2026. The team agreed to use JWT authentication for protected API endpoints.',1),
(2,2,'discussion','The team reviewed sprint progress. Rahul reported that the JWT login API implementation is still in progress and needs to be carried forward. Priya is preparing the API test cases. Arjun completed the authentication dashboard wireframe. The team requested updated API integration documentation from Rahul by November 4, 2026.',1),
(3,3,'discussion','The team reviewed outstanding engineering work and discussed the authentication module handover. The JWT login API remains in progress. Its implementation history and original deadline must be preserved. The QA test cases and API integration documentation remain outstanding. The team reviewed the internal JWT guidelines and API design standards.',1);

INSERT IGNORE INTO decisions (id,meeting_id,decision_text,rationale,decided_by) VALUES
(1,1,'Use JWT authentication for protected API endpoints.','The team selected token-based authentication for API access.',1),
(2,2,'Carry forward the unfinished JWT login API task.','The implementation was not completed during the original sprint.',1),
(3,3,'Preserve original action item identity and history during work handover.','This maintains continuity and prevents duplicate work records.',1);

INSERT IGNORE INTO action_items (id,source_meeting_id,current_meeting_id,title,description,owner_id,created_by,due_date,priority,status,outcome,completed_at,carry_forward_count) VALUES
(1,1,3,'Implement JWT Login API','Develop the login API and implement JWT-based authentication.',2,1,'2026-11-03','high','in_progress',NULL,NULL,1),
(2,1,3,'Prepare Authentication QA Test Cases','Prepare test cases to validate authentication and protected API access.',3,1,'2026-11-05','high','open',NULL,NULL,1),
(3,1,1,'Create Authentication Dashboard Wireframe','Prepare the initial dashboard wireframe for the authentication module.',4,1,'2026-10-26','medium','completed','Authentication dashboard wireframe completed.','2026-10-26 16:00:00',0),
(4,2,3,'Update API Integration Documentation','Update documentation explaining authentication API endpoints and integration requirements.',2,1,'2026-11-04','medium','open',NULL,NULL,1);

INSERT IGNORE INTO action_history (id,action_item_id,event_type,previous_status,new_status,previous_owner_id,new_owner_id,from_meeting_id,to_meeting_id,actor_id,details) VALUES
(1,1,'created',NULL,'open',NULL,2,NULL,1,1,'JWT login API action item created during sprint planning.'),
(2,1,'status_changed','open','in_progress',2,2,1,NULL,2,'Implementation started by Rahul.'),
(3,1,'carried_forward','in_progress','in_progress',2,2,1,2,1,'Unfinished JWT login API carried forward to the weekly project review.'),
(4,1,'carried_forward','in_progress','in_progress',2,2,2,3,1,'JWT login API carried forward to engineering handover.'),
(5,2,'created',NULL,'open',NULL,3,NULL,1,1,'QA test case preparation assigned to Priya.'),
(6,2,'carried_forward','open','open',3,3,1,3,1,'QA testing work remains outstanding.'),
(7,3,'created',NULL,'open',NULL,4,NULL,1,1,'Dashboard wireframe task assigned to Arjun.'),
(8,3,'status_changed','open','completed',4,4,1,NULL,4,'Dashboard wireframe completed.'),
(9,4,'created',NULL,'open',NULL,2,NULL,2,1,'API integration documentation task assigned to Rahul.'),
(10,4,'carried_forward','open','open',2,2,2,3,1,'Documentation task carried forward to engineering handover.');

INSERT IGNORE INTO knowledge_documents (id,title,document_type,content,tags,uploaded_by) VALUES
(1,'JWT Authentication Guidelines','guide','Internal guidance covering JWT token generation, validation, protected endpoints, token expiry and secure authentication practices.','JWT, authentication, API, security',2),
(2,'API Design Standards','policy','Internal API standards covering REST endpoint naming, HTTP methods, response formats, error handling and API documentation.','API, REST, design, standards',1),
(3,'Authentication QA Checklist','reference','Testing checklist covering login validation, invalid credentials, token expiry, unauthorized requests and protected endpoint access.','QA, testing, JWT, authentication',3),
(4,'Project Onboarding Guide','guide','A new team member should review recent meeting notes, open tasks, owners, decisions and linked project documents before taking over work.','onboarding, handover, project, knowledge',1);

INSERT IGNORE INTO knowledge_links (id,document_id,meeting_id,action_item_id,decision_id,relevance_note,linked_by) VALUES
(1,1,NULL,1,NULL,'Reference for implementing JWT authentication.',1),
(2,2,NULL,NULL,1,'Supports the decision to use standard API authentication endpoints.',1),
(3,3,NULL,2,NULL,'Reference for preparing authentication test cases.',1),
(4,2,3,NULL,NULL,'Reviewed during engineering work handover.',1);
