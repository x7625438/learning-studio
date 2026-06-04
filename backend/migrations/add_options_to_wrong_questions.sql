-- 为 wrong_questions 表添加 options 字段
-- 执行方式: sqlite3 backend/learning.db < backend/migrations/add_options_to_wrong_questions.sql

ALTER TABLE wrong_questions ADD COLUMN options TEXT DEFAULT '[]';
