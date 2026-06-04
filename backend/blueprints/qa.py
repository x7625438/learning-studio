from __future__ import annotations

import base64
import json
import os
from typing import Any

from flask import Blueprint, Response, jsonify, request

import config
from auth import current_user_id, login_required
from database import json_dumps, json_loads, rows_to_dicts, transaction
from services.ai_service import sse, stream_chat
from services.learning_service import extract_knowledge, get_learning_context, log_interaction, new_id
from services.vector_service import vector_service
from services.search_service import format_search_results, search_web, should_search

bp = Blueprint('qa', __name__, url_prefix='/api/v1/qa')


SYSTEM_PROMPT = (
    '你是一个普通 AI 助手，但更擅长把学习问题讲清楚。'
    '直接回答用户问题；必要时给步骤、例子和易错点；不要强制追问或让用户先做选择。'
    '如果用户是在延续上一轮对话，请根据上下文理解”这个、它、上一题、继续”等指代。'
    '涉及数学公式时，使用 $...$ 包裹行内公式，$$...$$ 包裹块级公式（如 $x^2 + y^2 = z^2$、$$\int_0^\infty e^{-x} dx$$）。'
)


def classify_question(text: str) -> str:
    if any(word in text for word in ['证明', '求证', '推导']):
        return 'proof'
    if any(word in text for word in ['计算', '求解', '化简', '方程']):
        return 'calculation'
    if any(word in text for word in ['应用', '实际', '场景']):
        return 'application'
    return 'general'


def save_image(user_id: str, image_base64: str | None) -> str | None:
    if not image_base64:
        return None
    raw = image_base64.split(',', 1)[-1]
    data = base64.b64decode(raw)
    if len(data) > config.MAX_IMAGE_SIZE:
        raise ValueError('图片过大，请压缩到 10MB 以内后再上传')
    os.makedirs(config.UPLOAD_FOLDER, exist_ok=True)
    path = os.path.join(config.UPLOAD_FOLDER, f'{user_id}-{new_id()}.png')
    with open(path, 'wb') as file:
        file.write(data)
    return path


def normalize_chat_history(value: str | None) -> list[dict[str, Any]]:
    history = json_loads(value, [])
    if not isinstance(history, list):
        return []
    return [
        {
            'id': item.get('id') or new_id(),
            'role': 'assistant' if item.get('role') in {'assistant', 'ai'} else 'user',
            'content': str(item.get('content') or ''),
            'type': item.get('type') or 'text',
        }
        for item in history
        if str(item.get('content') or '').strip()
    ]


def messages_from_history(history: list[dict[str, Any]], similar: list[dict[str, Any]] | None = None, search_results: str | None = None, user_id: str | None = None) -> list[dict[str, str]]:
    messages = [{'role': 'user', 'content': f'系统指令：{SYSTEM_PROMPT}'}]

    # 添加学习档案上下文
    if user_id:
        learning_context = get_learning_context(user_id)
        if learning_context:
            messages.append({'role': 'user', 'content': learning_context})

    # 如果有搜索结果，添加到上下文中
    if search_results:
        messages.append({'role': 'user', 'content': search_results})

    for item in history[-12:]:
        messages.append(
            {
                'role': 'assistant' if item['role'] == 'assistant' else 'user',
                'content': item['content'],
            }
        )
    if similar:
        messages.append({'role': 'user', 'content': '相似历史问题，仅作为参考：' + json_dumps(similar)})
    return messages


def stream_content_from_sse(chunk: str) -> str:
    event = ''
    data = ''
    for line in chunk.splitlines():
        if line.startswith('event:'):
            event = line.split(':', 1)[1].strip()
        if line.startswith('data:'):
            data = line.split(':', 1)[1].strip()
    if event != 'stream' or not data:
        return ''
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return ''
    return str(payload.get('content') or '')


@bp.post('/ask')
@login_required
def ask():
    data = request.get_json(silent=True) or {}
    question = (data.get('question') or '').strip()
    if not question:
        return jsonify({'message': '问题不能为空', 'code': 'VALIDATION_ERROR'}), 400

    user_id = current_user_id()
    try:
        image_path = save_image(user_id, data.get('imageBase64'))
    except ValueError as exc:
        return jsonify({'message': str(exc), 'code': 'FILE_TOO_LARGE'}), 413

    requested_session_id = data.get('sessionId')
    similar = vector_service.find_similar_interactions(user_id, question)
    knowledge = extract_knowledge(question)

    # 判断是否需要搜索
    search_results_text = None
    if should_search(question):
        search_results = search_web(question, max_results=3)
        if search_results:
            search_results_text = format_search_results(search_results)

    with transaction() as conn:
        existing = None
        if requested_session_id:
            existing = conn.execute(
                'SELECT * FROM qa_sessions WHERE id = ? AND user_id = ?',
                (requested_session_id, user_id),
            ).fetchone()

        if existing:
            session_id = existing['id']
            history = normalize_chat_history(existing['chat_history'])
            root_question = existing['question']
            question_type = existing['question_type']
            round_count = int(existing['round_count'] or 0) + 1
            history.append({'id': new_id(), 'role': 'user', 'content': question, 'type': 'text'})
            conn.execute(
                """
                UPDATE qa_sessions
                SET chat_history = ?, round_count = ?, status = 'active', updated_at = datetime('now')
                WHERE id = ? AND user_id = ?
                """,
                (json_dumps(history), round_count, session_id, user_id),
            )
        else:
            session_id = new_id()
            root_question = question
            question_type = classify_question(question)
            round_count = 1
            history = [{'id': new_id(), 'role': 'user', 'content': question, 'type': 'text'}]
            conn.execute(
                """
                INSERT INTO qa_sessions
                (id, user_id, question, image_path, question_type, chat_history, round_count)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (session_id, user_id, root_question, image_path, question_type, json_dumps(history), round_count),
            )

    messages = messages_from_history(history, similar, search_results_text, user_id)
    final_payload = {
        'type': 'final',
        'sessionId': session_id,
        'knowledgePoints': knowledge,
        'similar': similar,
    }

    def generate():
        answer_text = ''
        for chunk in stream_chat(messages, final_payload, user_id=user_id):
            answer_text += stream_content_from_sse(chunk)
            yield chunk

        answer_text = answer_text.strip()
        assistant_message = {'id': new_id(), 'role': 'assistant', 'content': answer_text, 'type': 'text'}
        with transaction() as conn:
            row = conn.execute(
                'SELECT chat_history FROM qa_sessions WHERE id = ? AND user_id = ?',
                (session_id, user_id),
            ).fetchone()
            saved_history = normalize_chat_history(row['chat_history'] if row else None)
            saved_history.append(assistant_message)
            merged_knowledge = list(dict.fromkeys(extract_knowledge(root_question + '\n' + answer_text) + knowledge))
            conn.execute(
                """
                UPDATE qa_sessions
                SET status = 'completed',
                    chat_history = ?,
                    final_answer = ?,
                    knowledge_points = ?,
                    updated_at = datetime('now')
                WHERE id = ? AND user_id = ?
                """,
                (json_dumps(saved_history), answer_text, json_dumps(merged_knowledge), session_id, user_id),
            )
        log_interaction(user_id, 'qa', question, answer_text, session_id, knowledge_points=None)

    return Response(generate(), mimetype='text/event-stream')


@bp.post('/answer')
@login_required
def answer():
    return jsonify(
        {
            'message': '新版即时问答已改为普通 AI 对话，请直接调用 /api/v1/qa/ask。',
            'code': 'DEPRECATED_ENDPOINT',
        }
    ), 410


@bp.post('/<session_id>/final')
@login_required
def final_answer(session_id):
    user_id = current_user_id()
    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM qa_sessions WHERE id = ? AND user_id = ?',
            (session_id, user_id),
        ).fetchone()
    if not row:
        return jsonify({'message': '问答会话不存在', 'code': 'NOT_FOUND'}), 404

    history = normalize_chat_history(row['chat_history'])
    messages = messages_from_history(history, user_id=user_id)
    messages.append(
        {
            'role': 'user',
            'content': '请基于上面的完整对话整理一版最终答案，包含核心结论、步骤、例子和可复习知识点。',
        }
    )
    knowledge = extract_knowledge('\n'.join(item['content'] for item in history))
    final_payload = {'type': 'final', 'sessionId': session_id, 'knowledgePoints': knowledge}

    def generate():
        answer_text = ''
        for chunk in stream_chat(messages, final_payload, user_id=user_id):
            answer_text += stream_content_from_sse(chunk)
            yield chunk
        if answer_text.strip():
            log_interaction(user_id, 'qa', row['question'], answer_text, session_id, knowledge)

    return Response(generate(), mimetype='text/event-stream')


@bp.get('/history')
@login_required
def history():
    with transaction() as conn:
        rows = rows_to_dicts(
            conn.execute(
                'SELECT * FROM qa_sessions WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 50',
                (current_user_id(),),
            ).fetchall()
        )
    data = [
        {
            'id': item['id'],
            'question': item['question'],
            'questionType': item['question_type'],
            'status': item['status'],
            'roundCount': item['round_count'],
            'finalAnswer': item['final_answer'],
            'messages': normalize_chat_history(item.get('chat_history')),
            'knowledgePoints': json_loads(item['knowledge_points'], []),
            'favorited': bool(item['favorited']),
            'createdAt': item['created_at'],
            'updatedAt': item.get('updated_at'),
        }
        for item in rows
    ]
    return jsonify({'data': data})


@bp.post('/<session_id>/favorite')
@login_required
def favorite(session_id):
    with transaction() as conn:
        conn.execute(
            'UPDATE qa_sessions SET favorited = 1 WHERE id = ? AND user_id = ?',
            (session_id, current_user_id()),
        )
    return jsonify({'data': {'ok': True}})


@bp.delete('/<session_id>')
@login_required
def delete_session(session_id):
    with transaction() as conn:
        conn.execute(
            'DELETE FROM qa_sessions WHERE id = ? AND user_id = ?',
            (session_id, current_user_id()),
        )
    return jsonify({'data': {'ok': True}})
