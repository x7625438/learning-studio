from __future__ import annotations

from typing import Any

from database import json_loads, row_to_dict, rows_to_dicts, transaction


def build_learning_context(user_id: str | None, limit: int = 8) -> str:
    if not user_id:
        return ''

    with transaction() as conn:
        profile = row_to_dict(
            conn.execute('SELECT * FROM learning_profile WHERE user_id = ?', (user_id,)).fetchone()
        )
        weak_points = rows_to_dicts(
            conn.execute(
                """
                SELECT knowledge_name, mastery_score, error_count, correct_count, source
                FROM weak_points
                WHERE user_id = ? AND ignored = 0
                ORDER BY mastery_score ASC, updated_at DESC
                LIMIT 6
                """,
                (user_id,),
            ).fetchall()
        )
        history = rows_to_dicts(
            conn.execute(
                """
                SELECT source_type, summary, extracted_knowledge, created_at
                FROM interaction_logs
                WHERE user_id = ?
                  AND summary IS NOT NULL
                  AND summary NOT LIKE '非学习对话%'
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        )
        today = row_to_dict(
            conn.execute(
                """
                SELECT study_seconds, practice_count
                FROM study_records
                WHERE user_id = ? AND date = date('now')
                """,
                (user_id,),
            ).fetchone()
        )

    if not profile:
        return ''

    lines = ['用户长期学习画像：']
    add_line(lines, '学习目标', profile.get('goal'))
    add_line(lines, '当前阶段', profile.get('current_stage'))
    add_line(lines, '自我介绍', profile.get('self_introduction'), max_len=500)
    add_line(lines, '希望的学习方式', profile.get('learning_preferences'), max_len=500)
    if today:
        seconds = int(today.get('study_seconds') or 0)
        practice_count = int(today.get('practice_count') or 0)
        lines.append(f'- 今日状态：已学习 {round(seconds / 60, 1)} 分钟，练习 {practice_count} 题。')
    if weak_points:
        weak_text = '；'.join(
            f"{item['knowledge_name']}（掌握度 {round(float(item.get('mastery_score') or 0))}，错 {item.get('error_count') or 0}）"
            for item in weak_points
        )
        lines.append(f'- 当前薄弱点：{weak_text}')
    if history:
        lines.append('- 最近在系统里的学习行为：')
        for item in history:
            knowledge = json_loads(item.get('extracted_knowledge'), [])
            suffix = f"｜知识点：{'、'.join(knowledge[:4])}" if knowledge else ''
            lines.append(f"  - {source_label(item.get('source_type'))}：{item.get('summary') or '学习活动'}{suffix}")

    lines.append('使用方式：回答时默认把上面信息当作背景，贴合用户当前阶段和偏好的学习方式；不要机械复述画像，除非用户询问。')
    return '\n'.join(lines)


def with_learning_context(messages: list[dict[str, Any]], user_id: str | None) -> list[dict[str, Any]]:
    context = build_learning_context(user_id)
    if not context:
        return messages
    return [{'role': 'user', 'content': f'系统长期上下文：\n{context}'}] + messages


def with_knowledge_context(messages: list[dict[str, Any]], user_id: str | None) -> list[dict[str, Any]]:
    """Retrieve relevant knowledge memories and inject them before the messages."""
    if not user_id:
        return messages

    # Extract the user's query from the last non-system user message
    query = _extract_query(messages)
    if not query:
        return messages

    from services.knowledge_memory_service import inject_knowledge_context

    return inject_knowledge_context(messages, user_id, query)


def _extract_query(messages: list[dict[str, Any]]) -> str:
    """Extract the user's actual question from the message list, skipping system
    instructions injected as user messages."""
    for msg in reversed(messages):
        role = msg.get('role', '')
        content = str(msg.get('content', '')).strip()
        if role == 'user' and content and not content.startswith('系统'):
            return content[:500]
    return ''


def add_line(lines: list[str], label: str, value: Any, max_len: int = 240) -> None:
    text = str(value or '').strip()
    if text:
        lines.append(f'- {label}：{text[:max_len]}')


def source_label(source_type: str | None) -> str:
    labels = {
        'qa': '即时问答',
        'textbook': '教材对话',
        'paper': '论文解读',
        'practice': '主动回忆',
        'calendar': '学习计时',
        'feynman': '费曼学习',
        'learning_path': '学习路径',
        'knowledge_graph': '知识图谱',
        'tutoring': '启发讲题',
    }
    return labels.get(source_type or '', source_type or '学习活动')
