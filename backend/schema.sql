CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_profile_document (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    version INTEGER DEFAULT 1,
    last_updated_by TEXT,
    last_updated_source TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wrong_questions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    image_path TEXT,
    question_text TEXT NOT NULL,
    options TEXT DEFAULT '[]',
    subject TEXT,
    difficulty TEXT,
    user_answer TEXT,
    correct_answer TEXT,
    error_type TEXT,
    error_analysis TEXT,
    knowledge_points TEXT DEFAULT '[]',
    ai_explanation TEXT,
    status TEXT DEFAULT 'pending',
    mastery_level INTEGER DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    last_reviewed_at TEXT,
    next_review_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS similar_questions (
    id TEXT PRIMARY KEY,
    wrong_question_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    diagram_svg TEXT DEFAULT '',
    answer TEXT,
    explanation TEXT DEFAULT '',
    knowledge_points TEXT DEFAULT '[]',
    difficulty TEXT,
    user_answer TEXT,
    is_correct INTEGER DEFAULT 0,
    answered_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(wrong_question_id) REFERENCES wrong_questions(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan_type TEXT DEFAULT 'weekly',
    target_count INTEGER DEFAULT 5,
    knowledge_points TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    last_executed_at TEXT,
    next_execution_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_profile (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    goal TEXT,
    current_stage TEXT,
    self_introduction TEXT,
    learning_preferences TEXT,
    total_study_hours REAL DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    last_study_at TEXT,
    weekly_study_hours_target REAL DEFAULT 30,
    daily_practice_count_target INTEGER DEFAULT 20,
    emotion_enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interaction_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    user_input TEXT NOT NULL,
    ai_response TEXT,
    extracted_knowledge TEXT DEFAULT '[]',
    summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS weak_points (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    knowledge_name TEXT NOT NULL,
    mastery_score REAL DEFAULT 50,
    error_count INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    last_practiced_at TEXT,
    next_review_at TEXT,
    review_interval INTEGER DEFAULT 1,
    source TEXT,
    ignored INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, knowledge_name),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qa_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    question TEXT NOT NULL,
    image_path TEXT,
    question_type TEXT DEFAULT 'concept',
    chat_history TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    round_count INTEGER DEFAULT 0,
    final_answer TEXT,
    knowledge_points TEXT DEFAULT '[]',
    favorited INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS textbooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT,
    file_path TEXT,
    file_size INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 1,
    status TEXT DEFAULT 'ready',
    sections TEXT DEFAULT '[]',
    analysis TEXT DEFAULT '{}',
    glossary TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS practice_questions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    weak_point_id TEXT,
    knowledge_name TEXT NOT NULL,
    question_text TEXT NOT NULL,
    choices TEXT DEFAULT '[]',
    correct_answer TEXT NOT NULL,
    hint TEXT,
    explanation TEXT,
    bloom_level TEXT,
    desired_difficulty TEXT,
    adaptive_reason TEXT,
    source_type TEXT DEFAULT 'weak_point',
    diagram_svg TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(weak_point_id) REFERENCES weak_points(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS practice_submissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    answer TEXT,
    feeling TEXT,
    is_correct INTEGER DEFAULT 0,
    time_spent_seconds INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(question_id) REFERENCES practice_questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_practice_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    target_count INTEGER DEFAULT 10,
    completed_count INTEGER DEFAULT 0,
    question_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, date),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS study_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    study_minutes INTEGER DEFAULT 0,
    study_seconds INTEGER DEFAULT 0,
    practice_count INTEGER DEFAULT 0,
    topics_studied TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, date),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS milestone_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    path_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    target_date TEXT,
    achieved_at TEXT,
    progress REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feynman_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    concept TEXT NOT NULL,
    concept_intro TEXT,
    explanations TEXT DEFAULT '[]',
    questions TEXT DEFAULT '[]',
    understanding_score REAL DEFAULT 0,
    weak_points TEXT DEFAULT '[]',
    report TEXT,
    status TEXT DEFAULT 'active',
    round_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tutoring_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    problem_text TEXT NOT NULL DEFAULT '',
    problem_image_path TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    knowledge_points TEXT DEFAULT '[]',
    difficulty TEXT DEFAULT 'medium',
    grade_level TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    current_step INTEGER DEFAULT 0,
    total_steps INTEGER DEFAULT 0,
    hints_given TEXT DEFAULT '[]',
    dialogue TEXT DEFAULT '[]',
    solved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_paths (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    current_level TEXT,
    goal TEXT,
    hours_per_week INTEGER,
    target_weeks INTEGER,
    status TEXT DEFAULT 'active',
    weeks_data TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS emotion_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger_detail TEXT,
    emotion_state TEXT,
    response_action TEXT,
    message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS buddy_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    quick_replies TEXT DEFAULT '[]',
    response_action TEXT,
    message_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, message_date),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS writing_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    current_version INTEGER DEFAULT 1,
    report TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS writing_versions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    text TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, version),
    FOREIGN KEY(session_id) REFERENCES writing_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS writing_feedback (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    anchor_text TEXT,
    feedback_text TEXT NOT NULL,
    suggestion TEXT,
    type TEXT DEFAULT 'clarity',
    position_start INTEGER DEFAULT 0,
    position_end INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(session_id) REFERENCES writing_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(document_id, version),
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_graphs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    summary TEXT DEFAULT '',
    nodes TEXT DEFAULT '[]',
    edges TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_graph_jobs (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    message TEXT DEFAULT '',
    code TEXT,
    graph TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pet_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    role TEXT NOT NULL,
    context TEXT DEFAULT '{}',
    tool_calls TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pet_user_actions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_data TEXT DEFAULT '{}',
    page TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pet_user_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    memory_content TEXT NOT NULL,
    memory_type TEXT DEFAULT 'general',
    importance INTEGER DEFAULT 5,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rubric_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    exam_type TEXT NOT NULL DEFAULT '自定义',
    dimensions TEXT NOT NULL DEFAULT '[]',
    total_score REAL DEFAULT 100,
    is_preset INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS essay_grading_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    essay_text TEXT NOT NULL DEFAULT '',
    rubric_id TEXT,
    rubric_snapshot TEXT NOT NULL DEFAULT '{}',
    exam_type TEXT DEFAULT '自定义',
    total_score REAL,
    dimension_scores TEXT DEFAULT '[]',
    overall_feedback TEXT DEFAULT '',
    strengths TEXT DEFAULT '[]',
    weaknesses TEXT DEFAULT '[]',
    suggestions TEXT DEFAULT '[]',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(rubric_id) REFERENCES rubric_templates(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS knowledge_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    summary TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    topic TEXT DEFAULT '',
    memory_type TEXT DEFAULT 'concept',
    tags TEXT DEFAULT '[]',
    source_type TEXT DEFAULT 'manual',
    source_id TEXT,
    mastery_level REAL DEFAULT 0,
    easiness_factor REAL DEFAULT 2.5,
    interval_days INTEGER DEFAULT 0,
    repetitions INTEGER DEFAULT 0,
    next_review_at TEXT,
    last_reviewed_at TEXT,
    review_count INTEGER DEFAULT 0,
    importance INTEGER DEFAULT 5,
    interaction_count INTEGER DEFAULT 0,
    consolidated_from TEXT DEFAULT '[]',
    consolidated_at TEXT,
    is_consolidated INTEGER DEFAULT 0,
    has_embedding INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_memory_reviews (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    quality INTEGER NOT NULL,
    response_time_seconds INTEGER DEFAULT 0,
    ease_before REAL,
    ease_after REAL,
    interval_before INTEGER,
    interval_after INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(memory_id) REFERENCES knowledge_memories(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_memory_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_memory_id TEXT NOT NULL,
    target_memory_id TEXT NOT NULL,
    relation_type TEXT NOT NULL DEFAULT 'related',
    strength REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(source_memory_id) REFERENCES knowledge_memories(id) ON DELETE CASCADE,
    FOREIGN KEY(target_memory_id) REFERENCES knowledge_memories(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(source_memory_id, target_memory_id, relation_type)
);
