from __future__ import annotations

import json

from flask import Blueprint, Response, jsonify, request

import config
from auth import current_user_id, login_required
from database import json_dumps, json_loads, row_to_dict, rows_to_dicts, transaction
from services.ai_service import compact_prompt, sse, stream_chat
from services.learning_service import extract_knowledge, get_learning_context, log_interaction, new_id, upsert_weak_points
from services.user_profile_service import get_user_profile_context

bp = Blueprint('feynman', __name__, url_prefix='/api/v1/feynman')


@bp.post('/start')
@login_required
def start():
    data = request.get_json(silent=True) or {}
    concept = (data.get('concept') or '').strip()
    if not concept:
        return jsonify({'message': '概念不能为空', 'code': 'VALIDATION_ERROR'}), 400
    session_id = new_id()
    intro = f'请尝试像教一个完全没学过的人一样解释「{concept}」。重点说清：它是什么、为什么重要、什么时候用。'
    with transaction() as conn:
        conn.execute(
            'INSERT INTO feynman_sessions (id, user_id, concept, concept_intro) VALUES (?, ?, ?, ?)',
            (session_id, current_user_id(), concept, intro),
        )
    return jsonify({'data': {'id': session_id, 'concept': concept, 'conceptIntro': intro, 'status': 'active', 'roundCount': 0}}), 201


@bp.post('/<session_id>/explain')
@login_required
def explain(session_id):
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or data.get('explanation') or '').strip()
    if not text:
        return jsonify({'message': '解释不能为空', 'code': 'VALIDATION_ERROR'}), 400
    user_id = current_user_id()
    with transaction() as conn:
        row = conn.execute('SELECT * FROM feynman_sessions WHERE id = ? AND user_id = ?', (session_id, user_id)).fetchone()
    if not row:
        return jsonify({'message': '费曼会话不存在', 'code': 'NOT_FOUND'}), 404
    explanations = json_loads(row['explanations'], [])
    questions = json_loads(row['questions'], [])
    round_count = row['round_count'] + 1
    explanations.append({'order': round_count, 'text': text, 'createdAt': None})
    weak = extract_knowledge(text if len(text) < 40 else row['concept'])
    if round_count >= config.MAX_FEYNMAN_ROUNDS:
        score = min(100, 50 + len(text) // 8)
        report = {
            'understandingScore': score,
            'lectureMinutes': max(1, round_count * 2),
            'followUpRounds': round_count,
            'weakAreas': weak,
            'suggestion': '把解释压缩成三句话，并为每句话配一个例子。',
        }
        status = 'completed'
        ai_question = '会话已达到上限，已生成报告。'
    else:
        score = min(95, 35 + len(text) // 10 + round_count * 5)
        status = 'active'
        ai_question = ''
        report = None
    with transaction() as conn:
        conn.execute(
            """
            UPDATE feynman_sessions
            SET explanations = ?, questions = ?, understanding_score = ?, weak_points = ?, report = ?, status = ?, round_count = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (json_dumps(explanations), json_dumps(questions), score, json_dumps(weak), json_dumps(report) if report else row['report'], status, round_count, session_id),
        )

    def generate():
        if report:
            log_interaction(user_id, 'feynman', text, ai_question, session_id, weak)
            yield sse('question', {'type': 'question', 'question': ai_question, 'order': round_count, 'understandingScore': score, 'status': status})
            yield sse('final', {'type': 'final', 'report': report})
            yield sse('done', {'type': 'done'})
            return

        chunks: list[str] = []
        for chunk in stream_chat(
            build_feynman_messages(row['concept'], row['concept_intro'], explanations, questions, text, user_id),
            temperature=0.65,
            user_id=user_id,
        ):
            event, payload = parse_sse_chunk(chunk)
            if event == 'stream' and payload.get('type') == 'text':
                chunks.append(str(payload.get('content') or ''))
            yield chunk
        ai_reply = ''.join(chunks).strip()
        if ai_reply:
            questions.append({'order': round_count, 'question': ai_reply, 'isAnswered': False, 'createdAt': None})
            with transaction() as conn:
                conn.execute(
                    """
                    UPDATE feynman_sessions
                    SET questions = ?, updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (json_dumps(questions), session_id),
                )
        log_interaction(user_id, 'feynman', text, ai_reply, session_id, weak)

    return Response(generate(), mimetype='text/event-stream')


def build_feynman_messages(
    concept: str,
    concept_intro: str | None,
    explanations: list[dict],
    questions: list[dict],
    latest_text: str,
    user_id: str | None = None,
) -> list[dict[str, str]]:
    history_lines: list[str] = []
    for item in questions[-4:]:
        history_lines.append(f'AI追问：{item.get("question", "")}')
    for item in explanations[-4:]:
        history_lines.append(f'学生解释：{item.get("text", "")}')

    body = f"""
你是费曼学习法的引导者。你的角色是倾听学生的解释，然后通过提问帮助他们发现自己理解中的漏洞。

核心原则：
1. 你不是老师，不要讲解知识点，不要给答案
2. 你是提问者，通过追问让学生自己发现问题
3. 找出学生解释中最模糊、最不清楚、最容易让外行困惑的地方
4. 用"我不太懂"、"能举个例子吗"、"这两个有什么区别"这样的口吻

提问策略：
- 如果学生用了专业术语但没解释 → 问"这个词是什么意思？能用大白话说吗？"
- 如果学生的解释太抽象 → 问"能举个生活中的例子吗？"
- 如果学生跳过了步骤 → 问"从A到B是怎么推出来的？"
- 如果学生的类比不恰当 → 问"这个比喻在什么情况下不成立？"
- 如果学生解释太短 → 问"为什么会这样？背后的原因是什么？"

禁止行为：
❌ 不要说"让我来解释一下..."
❌ 不要说"其实这个概念是..."
❌ 不要直接纠正学生的错误
❌ 不要给出完整的知识点讲解
❌ 不要列举多个问题，只问一个最关键的

回复要求：
- 只问一个问题，像真人对话一样自然
- 控制在50字以内
- 用口语化的表达，不要太正式
- 涉及数学公式时使用 $...$（行内）和 $$...$$（块级）包裹，如 $x^2$

概念：{concept}
开场任务：{concept_intro or ''}
对话历史：
{chr(10).join(history_lines) or '暂无'}

学生刚才的解释：
{latest_text}

现在，作为一个"不太懂"的听众，针对学生刚才的解释，提出一个能让他发现问题的追问。
"""
    messages = [{'role': 'user', 'content': '费曼学习法引导者'}]

    # 添加用户档案上下文
    if user_id:
        profile_context = get_user_profile_context(user_id)
        if profile_context:
            messages.append({'role': 'user', 'content': profile_context})

    # 添加学习档案上下文
    if user_id:
        learning_context = get_learning_context(user_id)
        if learning_context:
            messages.append({'role': 'user', 'content': learning_context})

    messages.append({'role': 'user', 'content': body})
    return messages


def parse_sse_chunk(chunk: str) -> tuple[str, dict]:
    event = 'message'
    data = {}
    for line in chunk.replace('\r', '').split('\n'):
        if line.startswith('event:'):
            event = line.removeprefix('event:').strip()
        if line.startswith('data:'):
            try:
                data = json.loads(line.removeprefix('data:').strip())
            except json.JSONDecodeError:
                data = {}
    return event, data


@bp.get('/<session_id>/report')
@login_required
def report(session_id):
    with transaction() as conn:
        row = row_to_dict(conn.execute('SELECT * FROM feynman_sessions WHERE id = ? AND user_id = ?', (session_id, current_user_id())).fetchone())
    if not row:
        return jsonify({'message': '费曼会话不存在', 'code': 'NOT_FOUND'}), 404
    return jsonify({'data': {
        'id': row['id'],
        'concept': row['concept'],
        'understandingScore': row['understanding_score'],
        'weakPoints': json_loads(row['weak_points'], []),
        'report': json_loads(row['report'], None),
        'status': row['status'],
    }})


@bp.get('/history')
@login_required
def history():
    with transaction() as conn:
        rows = rows_to_dicts(conn.execute('SELECT * FROM feynman_sessions WHERE user_id = ? ORDER BY created_at DESC', (current_user_id(),)).fetchall())
    return jsonify({'data': rows})


@bp.delete('/<session_id>')
@login_required
def delete_session(session_id):
    with transaction() as conn:
        result = conn.execute('DELETE FROM feynman_sessions WHERE id = ? AND user_id = ?', (session_id, current_user_id()))
        if result.rowcount == 0:
            return jsonify({'message': '费曼会话不存在', 'code': 'NOT_FOUND'}), 404
    return jsonify({'message': '删除成功'}), 200
