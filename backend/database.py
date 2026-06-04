from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Iterable

import config


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_db() -> None:
    os.makedirs(config.UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(config.VECTOR_STORE_PATH, exist_ok=True)
    schema_path = os.path.join(config.BASE_DIR, 'schema.sql')
    with open(schema_path, 'r', encoding='utf-8') as f:
        schema = f.read()
    with get_db() as conn:
        conn.executescript(schema)
        ensure_learning_profile_personalization_columns(conn)
        ensure_study_seconds_column(conn)
        ensure_knowledge_graph_summary_column(conn)
        ensure_knowledge_graph_jobs_table(conn)
        ensure_similar_question_diagram_column(conn)
        ensure_similar_question_explanation_column(conn)
        ensure_similar_question_knowledge_points_column(conn)
        ensure_practice_question_adaptive_columns(conn)
        try:
            ensure_essay_grading_tables(conn)
        except Exception:
            pass  # best-effort: schema.sql already creates the tables
        ensure_knowledge_memories_tables(conn)


def ensure_learning_profile_personalization_columns(conn: sqlite3.Connection) -> None:
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(learning_profile)').fetchall()}
    if 'self_introduction' not in columns:
        conn.execute('ALTER TABLE learning_profile ADD COLUMN self_introduction TEXT')
    if 'learning_preferences' not in columns:
        conn.execute('ALTER TABLE learning_profile ADD COLUMN learning_preferences TEXT')


def ensure_study_seconds_column(conn: sqlite3.Connection) -> None:
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(study_records)').fetchall()}
    if 'study_seconds' in columns:
        return
    conn.execute('ALTER TABLE study_records ADD COLUMN study_seconds INTEGER DEFAULT 0')
    conn.execute('UPDATE study_records SET study_seconds = COALESCE(study_minutes, 0) * 60')


def ensure_knowledge_graph_summary_column(conn: sqlite3.Connection) -> None:
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(knowledge_graphs)').fetchall()}
    if 'summary' in columns:
        return
    conn.execute("ALTER TABLE knowledge_graphs ADD COLUMN summary TEXT DEFAULT ''")


def ensure_knowledge_graph_jobs_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
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
        )
        """
    )


def ensure_similar_question_diagram_column(conn: sqlite3.Connection) -> None:
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(similar_questions)').fetchall()}
    if 'diagram_svg' in columns:
        return
    conn.execute("ALTER TABLE similar_questions ADD COLUMN diagram_svg TEXT DEFAULT ''")


def ensure_similar_question_explanation_column(conn: sqlite3.Connection) -> None:
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(similar_questions)').fetchall()}
    if 'explanation' in columns:
        return
    conn.execute("ALTER TABLE similar_questions ADD COLUMN explanation TEXT DEFAULT ''")


def ensure_similar_question_knowledge_points_column(conn: sqlite3.Connection) -> None:
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(similar_questions)').fetchall()}
    if 'knowledge_points' in columns:
        return
    conn.execute("ALTER TABLE similar_questions ADD COLUMN knowledge_points TEXT DEFAULT '[]'")


def ensure_practice_question_adaptive_columns(conn: sqlite3.Connection) -> None:
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(practice_questions)').fetchall()}
    additions = {
        'bloom_level': "ALTER TABLE practice_questions ADD COLUMN bloom_level TEXT",
        'desired_difficulty': "ALTER TABLE practice_questions ADD COLUMN desired_difficulty TEXT",
        'adaptive_reason': "ALTER TABLE practice_questions ADD COLUMN adaptive_reason TEXT",
        'source_type': "ALTER TABLE practice_questions ADD COLUMN source_type TEXT DEFAULT 'weak_point'",
    }
    for column, statement in additions.items():
        if column not in columns:
            conn.execute(statement)


@contextmanager
def transaction() -> Iterable[sqlite3.Connection]:
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(row) for row in rows if row is not None]


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def ensure_essay_grading_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
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
        )
        """
    )
    conn.execute(
        """
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
        )
        """
    )
    # Insert / update preset rubrics
    new_preset_ids = {'rubric-primary-chinese', 'rubric-primary-english', 'rubric-middle-chinese',
                       'rubric-middle-english', 'rubric-high-chinese', 'rubric-high-english'}
    existing_new = conn.execute(
        "SELECT COUNT(*) as cnt FROM rubric_templates WHERE is_preset = 1 AND id IN ({})".format(
            ','.join(['?'] * len(new_preset_ids))
        ),
        tuple(new_preset_ids),
    ).fetchone()
    if existing_new['cnt'] < len(new_preset_ids):
        # Remove old presets (cascades to set rubric_id=NULL on existing sessions)
        conn.execute("DELETE FROM rubric_templates WHERE is_preset = 1 AND id NOT IN ({})".format(
            ','.join(['?'] * len(new_preset_ids))
        ), tuple(new_preset_ids))
        # Insert new presets (INSERT OR IGNORE to skip any that already exist)
        presets = [
            (
                'rubric-primary-chinese',
                '小学语文作文评分标准',
                '小学',
                json_dumps([
                    {'name': '内容完整', 'maxScore': 12, 'description': '是否把事情的起因、经过、结果写清楚，内容是否具体'},
                    {'name': '语言通顺', 'maxScore': 10, 'description': '语句是否通顺，用词是否恰当，能否用上积累的好词好句'},
                    {'name': '结构清晰', 'maxScore': 5, 'description': '段落是否分明，是否有开头和结尾，叙述顺序是否清楚'},
                    {'name': '书写规范', 'maxScore': 3, 'description': '标点符号是否正确，字迹是否工整，格式是否规范'},
                ]),
                30,
            ),
            (
                'rubric-primary-english',
                '小学英语作文评分标准',
                '小学',
                json_dumps([
                    {'name': '内容要点', 'maxScore': 6, 'description': '是否写出题目要求的要点，意思是否清楚'},
                    {'name': '语言准确', 'maxScore': 5, 'description': '基本单词拼写和简单语法是否正确'},
                    {'name': '书写规范', 'maxScore': 4, 'description': '字母大小写、标点和格式是否正确'},
                ]),
                15,
            ),
            (
                'rubric-middle-chinese',
                '初中语文作文评分标准',
                '初中',
                json_dumps([
                    {'name': '内容立意', 'maxScore': 15, 'description': '中心是否明确，内容是否充实，选材是否恰当，思想是否积极向上'},
                    {'name': '结构层次', 'maxScore': 12, 'description': '结构是否完整，层次是否清楚，过渡是否自然'},
                    {'name': '语言表达', 'maxScore': 13, 'description': '语言是否流畅，表达是否准确生动，修辞手法运用是否恰当'},
                    {'name': '卷面书写', 'maxScore': 10, 'description': '字迹是否工整，卷面是否整洁，标点格式是否正确'},
                ]),
                50,
            ),
            (
                'rubric-middle-english',
                '初中英语作文评分标准',
                '初中',
                json_dumps([
                    {'name': '内容完整', 'maxScore': 8, 'description': '是否包含所有内容要点，能否适当发挥'},
                    {'name': '语言准确', 'maxScore': 6, 'description': '语法结构是否正确，词汇使用是否恰当多样'},
                    {'name': '结构连贯', 'maxScore': 4, 'description': '段落衔接是否自然，逻辑是否连贯'},
                    {'name': '书写工整', 'maxScore': 2, 'description': '拼写是否正确，标点和大小写是否规范'},
                ]),
                20,
            ),
            (
                'rubric-high-chinese',
                '高中语文作文评分标准',
                '高中',
                json_dumps([
                    {'name': '内容立意', 'maxScore': 20, 'description': '立意是否深刻新颖，内容是否充实丰富，思想是否健康向上'},
                    {'name': '结构逻辑', 'maxScore': 15, 'description': '结构是否完整清晰，层次是否分明，逻辑是否严密'},
                    {'name': '语言表达', 'maxScore': 15, 'description': '语言是否流畅生动，表达是否准确得体，修辞是否恰当'},
                    {'name': '论证充分', 'maxScore': 10, 'description': '论据是否典型有力，论证是否充分深入，分析是否透彻'},
                ]),
                60,
            ),
            (
                'rubric-high-english',
                '高中英语作文评分标准',
                '高中',
                json_dumps([
                    {'name': '内容要点', 'maxScore': 10, 'description': '是否覆盖所有内容要点，表达是否清楚，能否适当发挥'},
                    {'name': '语言准确', 'maxScore': 8, 'description': '语法结构是否正确多样，词汇使用是否丰富恰当'},
                    {'name': '结构连贯', 'maxScore': 4, 'description': '段落衔接是否自然，逻辑是否连贯，过渡是否流畅'},
                    {'name': '书写规范', 'maxScore': 3, 'description': '拼写是否正确，标点大小写是否规范，格式是否整洁'},
                ]),
                25,
            ),
        ]
        conn.executemany(
            'INSERT OR IGNORE INTO rubric_templates (id, name, exam_type, dimensions, total_score, is_preset) '
            'VALUES (?, ?, ?, ?, ?, 1)',
            presets,
        )


def ensure_knowledge_memories_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
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
        )
        """
    )
    conn.execute(
        """
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
        )
        """
    )
    conn.execute(
        """
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
        )
        """
    )


def json_loads(value: str | None, default: Any = None) -> Any:
    if value in (None, ''):
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default
