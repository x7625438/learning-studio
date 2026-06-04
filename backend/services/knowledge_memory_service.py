"""Knowledge Memory Service — personal learning memory library core.

Provides CRUD, hybrid search, stats, and embedding management for
user knowledge_memories. Also exposes RAG-style context retrieval so
other AI services can inject relevant past knowledge into prompts.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from database import get_db, json_dumps, json_loads, row_to_dict, rows_to_dicts
from services.vector_service import vector_service


def new_id() -> str:
    return uuid.uuid4().hex[:16]


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def normalize_memory(row: dict[str, Any]) -> dict[str, Any]:
    """Convert a snake_case DB row into camelCase JSON response."""
    return {
        'id': row['id'],
        'userId': row['user_id'],
        'title': row['title'],
        'content': row['content'],
        'summary': row.get('summary', ''),
        'subject': row.get('subject', ''),
        'topic': row.get('topic', ''),
        'memoryType': row.get('memory_type', 'concept'),
        'tags': json_loads(row.get('tags'), default=[]),
        'sourceType': row.get('source_type', 'manual'),
        'sourceId': row.get('source_id'),
        'masteryLevel': row.get('mastery_level', 0),
        'easinessFactor': row.get('easiness_factor', 2.5),
        'intervalDays': row.get('interval_days', 0),
        'repetitions': row.get('repetitions', 0),
        'nextReviewAt': row.get('next_review_at'),
        'lastReviewedAt': row.get('last_reviewed_at'),
        'reviewCount': row.get('review_count', 0),
        'importance': row.get('importance', 5),
        'interactionCount': row.get('interaction_count', 0),
        'isConsolidated': bool(row.get('is_consolidated', 0)),
        'archived': bool(row.get('archived', 0)),
        'createdAt': row.get('created_at'),
        'updatedAt': row.get('updated_at'),
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def create_memory(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Create a new knowledge memory entry and embed it."""
    memory_id = new_id()
    title = (data.get('title') or '').strip()
    content = (data.get('content') or '').strip()
    if not title or not content:
        raise ValueError('Title and content are required')

    now = datetime.utcnow().isoformat()
    first_review_at = date.today().isoformat()

    conn = get_db()
    try:
        conn.execute(
            """
            INSERT INTO knowledge_memories (
                id, user_id, title, content, summary, subject, topic,
                memory_type, tags, source_type, source_id,
                importance, next_review_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                memory_id, user_id, title, content,
                (data.get('summary') or '').strip(),
                (data.get('subject') or '').strip(),
                (data.get('topic') or '').strip(),
                data.get('memoryType') or data.get('memory_type') or 'concept',
                json_dumps(data.get('tags') or []),
                data.get('sourceType') or data.get('source_type') or 'manual',
                data.get('sourceId') or data.get('source_id'),
                data.get('importance', 5),
                first_review_at, now, now,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    # Embed in vector store
    _embed_memory(memory_id, user_id, title, content, data.get('subject', ''))

    return get_memory(memory_id, user_id)


def update_memory(memory_id: str, user_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Update an existing memory. Only provided fields are changed."""
    existing = _get_memory_row(memory_id, user_id)
    if not existing:
        return None

    updates: dict[str, Any] = {}
    for json_key, col in [
        ('title', 'title'), ('content', 'content'), ('summary', 'summary'),
        ('subject', 'subject'), ('topic', 'topic'),
    ]:
        if json_key in data:
            updates[col] = (data[json_key] or '').strip()
    if 'memoryType' in data:
        updates['memory_type'] = data['memoryType']
    if 'memory_type' in data:
        updates['memory_type'] = data['memory_type']
    if 'tags' in data:
        updates['tags'] = json_dumps(data['tags'])
    if 'importance' in data:
        updates['importance'] = data['importance']
    if 'archived' in data:
        updates['archived'] = 1 if data['archived'] else 0

    if not updates:
        return get_memory(memory_id, user_id)

    updates['updated_at'] = datetime.utcnow().isoformat()
    set_clause = ', '.join(f'{k} = ?' for k in updates)
    values = list(updates.values()) + [memory_id, user_id]

    conn = get_db()
    try:
        conn.execute(f'UPDATE knowledge_memories SET {set_clause} WHERE id = ? AND user_id = ?', values)
        conn.commit()
    finally:
        conn.close()

    # Re-embed if title or content changed
    if 'title' in updates or 'content' in updates:
        updated = _get_memory_row(memory_id, user_id)
        if updated:
            _embed_memory(memory_id, user_id, updated['title'], updated['content'], updated.get('subject', ''))

    return get_memory(memory_id, user_id)


def delete_memory(memory_id: str, user_id: str) -> bool:
    """Soft-delete (archive) a memory."""
    conn = get_db()
    try:
        cur = conn.execute(
            'UPDATE knowledge_memories SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?',
            (datetime.utcnow().isoformat(), memory_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def restore_memory(memory_id: str, user_id: str) -> bool:
    """Unarchive a memory."""
    conn = get_db()
    try:
        cur = conn.execute(
            'UPDATE knowledge_memories SET archived = 0, updated_at = ? WHERE id = ? AND user_id = ?',
            (datetime.utcnow().isoformat(), memory_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_memory(memory_id: str, user_id: str) -> dict[str, Any] | None:
    """Get a single memory with review history."""
    row = _get_memory_row(memory_id, user_id)
    if not row:
        return None
    result = normalize_memory(row)

    # Attach review history
    conn = get_db()
    try:
        reviews = conn.execute(
            'SELECT * FROM knowledge_memory_reviews WHERE memory_id = ? ORDER BY created_at DESC LIMIT 20',
            (memory_id,),
        ).fetchall()
        result['reviewHistory'] = [
            {
                'id': r['id'],
                'quality': r['quality'],
                'responseTimeSeconds': r['response_time_seconds'],
                'easeBefore': r['ease_before'],
                'easeAfter': r['ease_after'],
                'intervalBefore': r['interval_before'],
                'intervalAfter': r['interval_after'],
                'createdAt': r['created_at'],
            }
            for r in reviews
        ]
        return result
    finally:
        conn.close()


def _get_memory_row(memory_id: str, user_id: str) -> dict[str, Any] | None:
    conn = get_db()
    try:
        row = conn.execute(
            'SELECT * FROM knowledge_memories WHERE id = ? AND user_id = ?',
            (memory_id, user_id),
        ).fetchone()
        return row_to_dict(row)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# List & search
# ---------------------------------------------------------------------------

def list_memories(
    user_id: str,
    *,
    page: int = 1,
    page_size: int = 20,
    subject: str | None = None,
    topic: str | None = None,
    memory_type: str | None = None,
    query: str | None = None,
    sort_by: str = 'updated_at',
    sort_order: str = 'desc',
    include_archived: bool = False,
) -> dict[str, Any]:
    """Paginated list with optional filters."""
    conditions = ['user_id = ?']
    params: list[Any] = [user_id]

    if not include_archived:
        conditions.append('archived = 0')
        conditions.append('is_consolidated = 0')
    if subject:
        conditions.append('subject = ?')
        params.append(subject)
    if topic:
        conditions.append('topic = ?')
        params.append(topic)
    if memory_type:
        conditions.append('memory_type = ?')
        params.append(memory_type)
    if query:
        conditions.append('(title LIKE ? OR content LIKE ? OR summary LIKE ?)')
        like = f'%{query}%'
        params.extend([like, like, like])

    where = ' AND '.join(conditions)

    allowed_sort = {'updated_at', 'created_at', 'title', 'importance', 'mastery_level', 'next_review_at'}
    if sort_by not in allowed_sort:
        sort_by = 'updated_at'
    order = 'DESC' if sort_order.lower() == 'desc' else 'ASC'

    conn = get_db()
    try:
        total = conn.execute(
            f'SELECT COUNT(*) as cnt FROM knowledge_memories WHERE {where}', params
        ).fetchone()['cnt']

        offset = (page - 1) * page_size
        rows = conn.execute(
            f'SELECT * FROM knowledge_memories WHERE {where} ORDER BY {sort_by} {order} LIMIT ? OFFSET ?',
            params + [page_size, offset],
        ).fetchall()
        items = [normalize_memory(row_to_dict(r)) for r in rows]
        return {'items': items, 'total': total, 'page': page, 'pageSize': page_size}
    finally:
        conn.close()


def search_memories(
    user_id: str,
    query: str,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """Hybrid search: ChromaDB vector results merged with SQLite keyword results."""
    if not query.strip():
        return []

    # 1. Vector search
    vector_results = vector_service.search_knowledge_memories(user_id, query, top_k=top_k)
    vector_ids = {r['id'] for r in vector_results}

    # 2. Keyword fallback (deduplicated against vector results)
    conn = get_db()
    try:
        like = f'%{query}%'
        keyword_rows = conn.execute(
            """SELECT * FROM knowledge_memories
               WHERE user_id = ? AND archived = 0
                 AND is_consolidated = 0
                 AND (title LIKE ? OR content LIKE ? OR summary LIKE ?)
               LIMIT ?""",
            (user_id, like, like, like, top_k),
        ).fetchall()
    finally:
        conn.close()

    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    # Vector results first (higher quality)
    for vr in vector_results:
        if vr['id'] not in seen:
            memory = get_memory(vr['id'], user_id)
            if memory:
                memory['_distance'] = vr.get('distance')
                memory['_source'] = 'vector'
                results.append(memory)
                seen.add(vr['id'])

    # Keyword results next
    for row in keyword_rows:
        rdict = row_to_dict(row)
        if rdict and rdict['id'] not in seen:
            memory = normalize_memory(rdict)
            memory['_source'] = 'keyword'
            results.append(memory)
            seen.add(rdict['id'])

    return results[:top_k]


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def get_stats(user_id: str) -> dict[str, Any]:
    """Dashboard stats for knowledge memory."""
    conn = get_db()
    try:
        total = conn.execute(
            'SELECT COUNT(*) as cnt FROM knowledge_memories WHERE user_id = ? AND archived = 0 AND is_consolidated = 0',
            (user_id,),
        ).fetchone()['cnt']

        today_str = date.today().isoformat()
        due_today = conn.execute(
            'SELECT COUNT(*) as cnt FROM knowledge_memories WHERE user_id = ? AND archived = 0 AND is_consolidated = 0 AND next_review_at <= ?',
            (user_id, today_str),
        ).fetchone()['cnt']

        avg_mastery = conn.execute(
            'SELECT COALESCE(AVG(mastery_level), 0) as avg_m FROM knowledge_memories WHERE user_id = ? AND archived = 0 AND is_consolidated = 0',
            (user_id,),
        ).fetchone()['avg_m']

        by_subject_rows = conn.execute(
            """SELECT subject, COUNT(*) as cnt
               FROM knowledge_memories
               WHERE user_id = ? AND archived = 0 AND is_consolidated = 0 AND subject != ''
               GROUP BY subject ORDER BY cnt DESC""",
            (user_id,),
        ).fetchall()
        by_subject = {r['subject']: r['cnt'] for r in by_subject_rows}

        by_type_rows = conn.execute(
            """SELECT memory_type, COUNT(*) as cnt
               FROM knowledge_memories
               WHERE user_id = ? AND archived = 0 AND is_consolidated = 0
               GROUP BY memory_type ORDER BY cnt DESC""",
            (user_id,),
        ).fetchall()
        by_type = {r['memory_type']: r['cnt'] for r in by_type_rows}

        return {
            'total': total,
            'dueToday': due_today,
            'averageMastery': round(avg_mastery, 1),
            'bySubject': by_subject,
            'byType': by_type,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------

def _embed_memory(memory_id: str, user_id: str, title: str, content: str, subject: str) -> None:
    """Create/update vector embedding for a knowledge memory."""
    text = f'{title}\n{content}'[:2000]
    metadata: dict[str, Any] = {
        'user_id': user_id,
        'title': title,
        'subject': subject or '',
    }
    vector_service.add_knowledge_memory(memory_id, text, metadata)

    # Mark as embedded
    conn = get_db()
    try:
        conn.execute(
            'UPDATE knowledge_memories SET has_embedding = 1 WHERE id = ?', (memory_id,)
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Reindex
# ---------------------------------------------------------------------------

def reindex_all_memories(user_id: str) -> dict[str, Any]:
    """Rebuild all ChromaDB embeddings for a user."""
    conn = get_db()
    try:
        rows = conn.execute(
            'SELECT * FROM knowledge_memories WHERE user_id = ? AND archived = 0 AND is_consolidated = 0',
            (user_id,),
        ).fetchall()
    finally:
        conn.close()

    count = 0
    for row in rows:
        r = row_to_dict(row)
        if r:
            _embed_memory(r['id'], user_id, r['title'], r['content'], r.get('subject', ''))
            count += 1

    return {'indexed': count, 'total': len(rows)}


# ---------------------------------------------------------------------------
# RAG context retrieval
# ---------------------------------------------------------------------------

def get_knowledge_context(user_id: str, query: str, top_k: int = 5) -> str:
    """Retrieve relevant knowledge memories and format as a Chinese context block."""
    results = search_memories(user_id, query, top_k=top_k)
    if not results:
        return ''

    lines = ['【你的知识库中与当前问题相关的内容】']
    for i, mem in enumerate(results, 1):
        mastery = mem.get('masteryLevel', 0)
        summary = mem.get('summary') or (mem.get('content', '')[:120] + '...')
        lines.append(
            f'{i}. [{mem["title"]}] (掌握度 {mastery:.0f}%): {summary}'
        )
    return '\n'.join(lines)


def inject_knowledge_context(messages: list[dict[str, Any]], user_id: str, query: str) -> list[dict[str, Any]]:
    """Prepend relevant knowledge memories to AI message list."""
    context = get_knowledge_context(user_id, query, top_k=5)
    if not context:
        return messages
    return [{'role': 'user', 'content': f'系统知识库上下文：\n{context}'}] + messages


# ---------------------------------------------------------------------------
# Auto-capture from interactions
# ---------------------------------------------------------------------------

def auto_capture_from_interaction(user_id: str, interaction: dict[str, Any]) -> list[dict[str, Any]]:
    """AI-driven: extract knowledge chunks from a single interaction log.

    Uses the AI to analyze user_input + ai_response from an interaction and
    extract discrete knowledge nuggets. Deduplicates against existing memories
    via ChromaDB before creating.
    """
    user_input = str(interaction.get('user_input') or '')[:800]
    ai_response = str(interaction.get('ai_response') or '')[:800]
    source_type = interaction.get('source_type', 'qa')
    interaction_id = interaction.get('id', '')

    if not user_input or len(user_input) < 6:
        return []

    if interaction_id:
        conn = get_db()
        try:
            existing = conn.execute(
                """SELECT id FROM knowledge_memories
                   WHERE user_id = ? AND source_id = ? AND source_type = ? AND archived = 0
                   LIMIT 1""",
                (user_id, interaction_id, f'auto-{source_type}'),
            ).fetchone()
        finally:
            conn.close()
        if existing:
            return []

    # Skip obvious non-learning chatter
    chatter_signals = ['你好', '在吗', '谢谢', 'hello', 'hi', '你是谁', '你叫什么']
    normalized = (user_input or '').strip().lower()
    if any(s in normalized for s in chatter_signals) and len(normalized) < 30:
        return []

    prompt = f"""分析这段学习交互，提取用户学到或理解的**独立知识点**。每条知识应是一个自包含的"知识卡片"。

用户问题: {user_input}
AI回答摘要: {ai_response}
来源模块: {source_type}

对每个独立知识点（最多3条），返回:
- title: 简洁标签（中文，最多40字）
- content: 知识点的清晰解释（markdown，100-500字）
- summary: 一句话核心要点（中文）
- subject: 学科（数学/英语/物理/化学/生物/历史/地理/综合）
- memoryType: 类型（concept/fact/insight/skill）
- importance: 重要性1-10（越基础越重要）

如果没有明确的**新**知识被学到，返回空数组。

只返回JSON: {{"extractions": [...]}}"""

    from services.ai_service import chat_completion_json

    try:
        result = chat_completion_json(
            [{'role': 'user', 'content': prompt}],
            fallback={'extractions': []},
            temperature=0.3,
        )
    except Exception:
        return []

    extractions = result.get('extractions') or []
    if not isinstance(extractions, list) or not extractions:
        return []

    created: list[dict[str, Any]] = []
    for ext in extractions[:3]:
        title = str(ext.get('title') or '').strip()
        content = str(ext.get('content') or '').strip()
        if not title or not content:
            continue

        # Dedup: check vector similarity with existing memories
        existing = vector_service.search_knowledge_memories(user_id, title, top_k=1)
        if existing and existing[0].get('distance', 1) < 0.3:
            # Near-duplicate — bump interaction count instead
            dup_id = existing[0]['id']
            _bump_interaction_count(dup_id)
            continue

        try:
            memory = create_memory(
                user_id,
                {
                    'title': title,
                    'content': content,
                    'summary': str(ext.get('summary') or '').strip(),
                    'subject': str(ext.get('subject') or '').strip(),
                    'memoryType': str(ext.get('memoryType') or 'concept').strip(),
                    'importance': int(ext.get('importance', 5)),
                    'sourceType': f'auto-{source_type}',
                    'sourceId': interaction_id,
                },
            )
            created.append(memory)
        except ValueError:
            continue

    return created


def _bump_interaction_count(memory_id: str) -> None:
    """Increment interaction_count for an existing memory (used during dedup)."""
    conn = get_db()
    try:
        conn.execute(
            'UPDATE knowledge_memories SET interaction_count = interaction_count + 1, updated_at = ? WHERE id = ?',
            (datetime.utcnow().isoformat(), memory_id),
        )
        conn.commit()
    finally:
        conn.close()


def auto_capture_batch(user_id: str, limit: int = 20) -> dict[str, Any]:
    """Batch auto-capture from recent interactions for a user."""
    from database import get_db as _db, row_to_dict as _row_to_dict

    conn = _db()
    try:
        rows = conn.execute(
            """SELECT * FROM interaction_logs
               WHERE user_id = ? AND summary NOT LIKE '非学习对话%'
               ORDER BY created_at DESC LIMIT ?""",
            (user_id, limit),
        ).fetchall()
    finally:
        conn.close()

    total_captured = 0
    for row in rows:
        interaction = _row_to_dict(row)
        if interaction:
            created = auto_capture_from_interaction(user_id, interaction)
            total_captured += len(created)

    return {'captured': total_captured, 'scanned': len(rows)}


# ---------------------------------------------------------------------------
# SM-2 Spaced Repetition Algorithm
# ---------------------------------------------------------------------------

def calculate_sm2(quality: int, memory: dict[str, Any]) -> dict[str, Any]:
    """Pure SM-2 algorithm. quality: 0-5 integer scale.

    0 = complete blackout, 3 = recalled with difficulty,
    4 = recalled with hesitation, 5 = perfect effortless recall.

    Returns dict with new easiness_factor, interval_days, repetitions,
    mastery_level (0-100), and next_review_at.
    """
    ef = float(memory.get('easiness_factor', 2.5))
    interval = int(memory.get('interval_days', 0))
    reps = int(memory.get('repetitions', 0))

    if quality >= 3:
        if reps == 0:
            new_interval = 1
        elif reps == 1:
            new_interval = 6
        else:
            new_interval = round(interval * ef)
        new_reps = reps + 1
    else:
        new_reps = 0
        new_interval = 1

    # Update easiness factor (SM-2 formula)
    new_ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    new_ef = max(1.3, new_ef)

    # Map EF to mastery_level: EF range 1.3 ~ 2.6+  =>  0 ~ 100
    mastery = min(100, max(0, (new_ef - 1.3) / 1.3 * 100))

    today_str = date.today().isoformat()
    next_review = (date.today() + timedelta(days=new_interval)).isoformat()

    return {
        'easiness_factor': round(new_ef, 3),
        'interval_days': new_interval,
        'repetitions': new_reps,
        'mastery_level': round(mastery, 1),
        'next_review_at': next_review,
        'last_reviewed_at': today_str,
    }


def record_review(
    memory_id: str,
    user_id: str,
    quality: int,
    response_time_seconds: int = 0,
) -> dict[str, Any] | None:
    """Submit a review grade and update SM-2 fields on the memory."""
    memory = _get_memory_row(memory_id, user_id)
    if not memory:
        return None

    ease_before = memory.get('easiness_factor', 2.5)
    interval_before = memory.get('interval_days', 0)

    sm2 = calculate_sm2(quality, memory)

    review_id = new_id()
    now = datetime.utcnow().isoformat()

    conn = get_db()
    try:
        conn.execute(
            """
            INSERT INTO knowledge_memory_reviews
                (id, memory_id, user_id, quality, response_time_seconds,
                 ease_before, ease_after, interval_before, interval_after, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                review_id, memory_id, user_id, quality, response_time_seconds,
                ease_before, sm2['easiness_factor'],
                interval_before, sm2['interval_days'],
                now,
            ),
        )
        conn.execute(
            """
            UPDATE knowledge_memories SET
                easiness_factor = ?, interval_days = ?, repetitions = ?,
                mastery_level = ?, next_review_at = ?, last_reviewed_at = ?,
                review_count = review_count + 1, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (
                sm2['easiness_factor'], sm2['interval_days'], sm2['repetitions'],
                sm2['mastery_level'], sm2['next_review_at'], sm2['last_reviewed_at'],
                now, memory_id, user_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return get_memory(memory_id, user_id)


def get_due_reviews(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """Get memories due for spaced repetition review, ordered by urgency."""
    today_str = date.today().isoformat()
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT * FROM knowledge_memories
            WHERE user_id = ? AND archived = 0 AND is_consolidated = 0
              AND next_review_at IS NOT NULL AND next_review_at <= ?
            ORDER BY mastery_level ASC, next_review_at ASC
            LIMIT ?
            """,
            (user_id, today_str, limit),
        ).fetchall()
        items = [normalize_memory(row_to_dict(r)) for r in rows]
        for item in items:
            if item['nextReviewAt']:
                days_overdue = (
                    date.today()
                    - datetime.strptime(item['nextReviewAt'][:10], '%Y-%m-%d').date()
                ).days
                item['_daysOverdue'] = max(0, days_overdue)
        return items
    finally:
        conn.close()


def get_review_queue_stats(user_id: str) -> dict[str, Any]:
    """Stats for the review queue."""
    today_str = date.today().isoformat()
    conn = get_db()
    try:
        due_today = conn.execute(
            """SELECT COUNT(*) as cnt FROM knowledge_memories
               WHERE user_id = ? AND archived = 0 AND is_consolidated = 0
                 AND next_review_at IS NOT NULL AND next_review_at <= ?""",
            (user_id, today_str),
        ).fetchone()['cnt']

        overdue = conn.execute(
            """SELECT COUNT(*) as cnt FROM knowledge_memories
               WHERE user_id = ? AND archived = 0 AND is_consolidated = 0
                 AND next_review_at IS NOT NULL AND next_review_at < ?""",
            (user_id, today_str),
        ).fetchone()['cnt']

        avg_ef = conn.execute(
            """SELECT COALESCE(AVG(easiness_factor), 2.5) as avg_ef FROM knowledge_memories
               WHERE user_id = ? AND archived = 0 AND is_consolidated = 0""",
            (user_id,),
        ).fetchone()['avg_ef']

        return {
            'dueToday': due_today,
            'overdue': overdue,
            'averageEasinessFactor': round(avg_ef, 3),
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Memory Consolidation
# ---------------------------------------------------------------------------

def find_consolidation_candidates(user_id: str, top_k: int = 10) -> list[dict[str, Any]]:
    """Use AI to find pairs of knowledge memories that should be merged."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT * FROM knowledge_memories
               WHERE user_id = ? AND archived = 0 AND is_consolidated = 0
               ORDER BY updated_at DESC LIMIT ?""",
            (user_id, min(top_k * 3, 100)),
        ).fetchall()
    finally:
        conn.close()

    if len(rows) < 2:
        return []

    memories = [normalize_memory(row_to_dict(r)) for r in rows]

    # Build a compact representation for AI analysis
    memory_list = []
    for m in memories:
        memory_list.append(
            f'[{m["id"][:8]}]{m["title"]} ({m["subject"]}|{m["memoryType"]}|掌握{m["masteryLevel"]:.0f}%): {m.get("summary") or m["content"][:80]}'
        )

    if len(memory_list) < 2:
        return []

    prompt = f"""分析以下知识记忆列表，找出应该合并的相关记忆对。
每对最多返回 2 组。只合并明显是同一知识点、或者其中一个包含另一个的内容的记忆。

记忆列表：
{chr(10).join(memory_list)}

返回 JSON：
{{"pairs": [
  {{"id1": "记忆ID前缀", "id2": "记忆ID前缀", "reason": "为什么应该合并（中文，20字以内）"}}
]}}

如果没有任何需要合并的记忆，返回 {{"pairs": []}}"""

    from services.ai_service import chat_completion_json

    try:
        result = chat_completion_json(
            [{'role': 'user', 'content': prompt}],
            fallback={'pairs': []},
            temperature=0.2,
        )
    except Exception:
        return []

    pairs = result.get('pairs') or []
    if not isinstance(pairs, list):
        return []

    candidates: list[dict[str, Any]] = []
    for pair in pairs[:3]:
        id1_prefix = str(pair.get('id1') or '')
        id2_prefix = str(pair.get('id2') or '')
        m1 = _find_memory_by_prefix(memories, id1_prefix)
        m2 = _find_memory_by_prefix(memories, id2_prefix)
        if m1 and m2 and m1['id'] != m2['id']:
            candidates.append({
                'memory1': m1,
                'memory2': m2,
                'reason': str(pair.get('reason', '内容相关'))[:40],
            })

    return candidates[:3]


def _find_memory_by_prefix(memories: list[dict[str, Any]], prefix: str) -> dict[str, Any] | None:
    """Find a memory whose id starts with the given prefix."""
    if not prefix:
        return None
    for m in memories:
        if m['id'].startswith(prefix):
            return m
    return None


def consolidate_memories(
    user_id: str,
    memory_ids: list[str],
    new_title: str = '',
    new_content: str = '',
) -> dict[str, Any] | None:
    """Merge N knowledge memories into one consolidated memory."""
    if len(memory_ids) < 2:
        return None

    conn = get_db()
    try:
        rows = []
        for mid in memory_ids:
            row = conn.execute(
                'SELECT * FROM knowledge_memories WHERE id = ? AND user_id = ? AND archived = 0 AND is_consolidated = 0',
                (mid, user_id),
            ).fetchone()
            if row:
                rows.append(row_to_dict(row))
    finally:
        conn.close()

    if len(rows) < 2:
        return None

    # Auto-generate title and content if not provided
    if not new_title:
        new_title = ' | '.join(r['title'] for r in rows)[:120]
    if not new_content:
        parts = []
        for r in rows:
            parts.append(f'## {r["title"]}\n\n{r["content"]}')
        new_content = '\n\n---\n\n'.join(parts)[:5000]

    # Compute aggregate stats
    avg_mastery = sum(r.get('mastery_level', 0) for r in rows) / len(rows)
    max_importance = max(r.get('importance', 5) for r in rows)
    total_interactions = sum(r.get('interaction_count', 0) for r in rows)
    subjects = list({r.get('subject', '') for r in rows if r.get('subject')})
    all_tags = []
    for r in rows:
        tags = json_loads(r.get('tags'), default=[])
        all_tags.extend(tags)
    unique_tags = list(dict.fromkeys(all_tags))[:10]

    now = datetime.utcnow().isoformat()
    consolidated_id = new_id()

    conn = get_db()
    try:
        conn.execute(
            """
            INSERT INTO knowledge_memories (
                id, user_id, title, content, summary, subject, topic, memory_type,
                tags, source_type, mastery_level, easiness_factor,
                importance, interaction_count,
                consolidated_from, consolidated_at, is_consolidated,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                consolidated_id, user_id, new_title, new_content,
                f'整合了 {len(rows)} 条相关知识',
                ', '.join(subjects[:3]), '', 'concept',
                json_dumps(unique_tags), 'consolidation',
                round(avg_mastery, 1), 2.5,
                max_importance, total_interactions,
                json_dumps([r['id'] for r in rows]), now, now, now,
            ),
        )

        # Mark originals as consolidated
        for r in rows:
            conn.execute(
                'UPDATE knowledge_memories SET is_consolidated = 1, updated_at = ? WHERE id = ?',
                (now, r['id']),
            )

        conn.commit()
    finally:
        conn.close()

    _embed_memory(consolidated_id, user_id, new_title, new_content, ', '.join(subjects[:3]))

    return get_memory(consolidated_id, user_id)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_memories(user_id: str) -> dict[str, Any]:
    """Export all knowledge memories for a user as a structured JSON."""
    conn = get_db()
    try:
        rows = conn.execute(
            'SELECT * FROM knowledge_memories WHERE user_id = ? ORDER BY created_at DESC',
            (user_id,),
        ).fetchall()
    finally:
        conn.close()

    memories = [normalize_memory(row_to_dict(r)) for r in rows]
    stats = get_stats(user_id)

    return {
        'exportedAt': datetime.utcnow().isoformat(),
        'userId': user_id,
        'total': len(memories),
        'stats': stats,
        'memories': memories,
    }


# ---------------------------------------------------------------------------
# Cross-module: sync from weak points
# ---------------------------------------------------------------------------

def sync_from_weak_point(user_id: str, knowledge_name: str, mastery_score: float) -> dict[str, Any] | None:
    """Create or update a knowledge memory from a weak point that's being mastered."""
    conn = get_db()
    try:
        existing = conn.execute(
            """SELECT * FROM knowledge_memories
               WHERE user_id = ? AND archived = 0 AND title LIKE ?""",
            (user_id, f'%{knowledge_name}%'),
        ).fetchone()
    finally:
        conn.close()

    if existing:
        row = row_to_dict(existing)
        if row:
            _bump_interaction_count(row['id'])
            return get_memory(row['id'], user_id)
        return None

    try:
        return create_memory(
            user_id,
            {
                'title': knowledge_name,
                'content': f'通过练习掌握的知识点：{knowledge_name}\n\n当前掌握度：{mastery_score:.0f}%',
                'summary': f'已掌握 {knowledge_name}（掌握度 {mastery_score:.0f}%）',
                'subject': '综合',
                'memoryType': 'concept',
                'importance': 7,
                'sourceType': 'auto-practice',
            },
        )
    except ValueError:
        return None
