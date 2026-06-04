from __future__ import annotations

import base64
import json
import os

from flask import Blueprint, Response, jsonify, request

import config
from auth import current_user_id, login_required
from database import json_dumps, json_loads, row_to_dict, rows_to_dicts, transaction
from services.ai_service import (
    AIServiceError,
    chat_completion,
    chat_completion_json,
    sse,
    stream_chat,
)
from services.learning_service import (
    extract_knowledge,
    get_learning_context,
    log_interaction,
    new_id,
    upsert_weak_points,
)
from services.user_profile_service import get_user_profile_context

bp = Blueprint('tutoring', __name__, url_prefix='/api/v1/tutoring')


# ---- helpers ----

def save_tutoring_image(user_id: str, image_base64: str | None) -> str | None:
    """Decode a base64 data-URL image and persist it to the upload folder."""
    if not image_base64:
        return None
    raw = image_base64.split(',', 1)[-1]
    data = base64.b64decode(raw)
    if len(data) > config.MAX_IMAGE_SIZE:
        raise ValueError('图片过大，请压缩到 10MB 以内后再上传')
    os.makedirs(config.UPLOAD_FOLDER, exist_ok=True)
    path = os.path.join(config.UPLOAD_FOLDER, f'tutoring-{user_id}-{new_id()}.png')
    with open(path, 'wb') as f:
        f.write(data)
    return path


def get_user_grade_level(user_id: str) -> str:
    """Read the user's current stage (学段) from the learning profile."""
    try:
        with transaction() as conn:
            row = conn.execute(
                'SELECT current_stage FROM learning_profile WHERE user_id = ?',
                (user_id,),
            ).fetchone()
        return (row['current_stage'] or '').strip() if row else ''
    except Exception:
        return ''


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


# ---- routes ----

@bp.post('/start')
@login_required
def start():
    data = request.get_json(silent=True) or {}
    problem_text = (data.get('problemText') or '').strip()
    image_base64 = data.get('imageBase64')

    if not problem_text and not image_base64:
        return jsonify({'message': '请输入题目文字或上传题目图片', 'code': 'VALIDATION_ERROR'}), 400

    user_id = current_user_id()
    session_id = new_id()

    # Save image if provided
    image_path = ''
    if image_base64:
        try:
            image_path = save_tutoring_image(user_id, image_base64) or ''
        except ValueError as exc:
            return jsonify({'message': str(exc), 'code': 'FILE_TOO_LARGE'}), 413

    # Read user's grade level for 适纲
    grade_level = get_user_grade_level(user_id)

    # Analyze the problem
    if image_base64 and not problem_text:
        # Image-only: use vision model to extract problem text & metadata
        try:
            mime_type = 'image/png'
            analysis = chat_completion_json(
                [
                    {
                        'role': 'user',
                        'content': [
                            {
                                'type': 'image_url',
                                'image_url': {'url': f'data:{mime_type};base64,{image_base64.split("," , 1)[-1]}'},
                            },
                            {
                                'type': 'text',
                                'text': (
                                    '请识别图片中的题目，提取信息并返回JSON：\n'
                                    '{\n'
                                    '  "questionText": "题干完整内容",\n'
                                    '  "subject": "学科（数学/物理/化学/英语/语文等）",\n'
                                    '  "difficulty": "简单/中等/困难",\n'
                                    '  "knowledgePoints": ["知识点1", "知识点2"],\n'
                                    '  "gradeLevel": "适合的学段（如小学/初中/高中/大学）"\n'
                                    '}\n'
                                    '只返回JSON，不要markdown代码块。'
                                ),
                            },
                        ],
                    }
                ],
                temperature=0.3,
                model=config.VISION_MODEL,
                user_id=user_id,
            )
            problem_text = str(analysis.get('questionText') or '').strip()
            subject = str(analysis.get('subject') or '')
            difficulty = str(analysis.get('difficulty') or 'medium')
            knowledge_points = analysis.get('knowledgePoints', [])
            if not grade_level:
                grade_level = str(analysis.get('gradeLevel') or '')
        except Exception:
            # If vision model fails, fall back with empty analysis and let text model handle in greeting
            subject = ''
            difficulty = 'medium'
            knowledge_points = []
            if not problem_text:
                return jsonify({'message': '题目图片识别失败，请手动输入题目文字', 'code': 'AI_ERROR'}), 502

    if problem_text and (not knowledge_points if 'knowledge_points' in dir() else True):
        # Analyze via text model
        try:
            analysis = chat_completion_json(
                [
                    {
                        'role': 'user',
                        'content': (
                            '分析以下题目，返回JSON：\n'
                            '{\n'
                            '  "subject": "学科",\n'
                            '  "difficulty": "简单/中等/困难",\n'
                            '  "knowledgePoints": ["知识点1", "知识点2"],\n'
                            '  "gradeLevel": "适合的学段"\n'
                            '}\n\n'
                            f'题目：{problem_text[:2000]}\n\n'
                            '只返回JSON，不要markdown代码块。'
                        ),
                    }
                ],
                temperature=0.3,
                user_id=user_id,
            )
            subject = str(analysis.get('subject') or '')
            difficulty = str(analysis.get('difficulty') or 'medium')
            knowledge_points = analysis.get('knowledgePoints', [])
            if not grade_level:
                grade_level = str(analysis.get('gradeLevel') or '')
        except Exception:
            subject = ''
            difficulty = 'medium'
            knowledge_points = []

    if not isinstance(knowledge_points, list):
        knowledge_points = []

    # Generate the opening greeting (first guiding question)
    greeting_prompt = (
        f'你是一位{grade_level + "的" if grade_level else ""}启发式讲题导师。下面这道题是一个学生来请教的，'
        f'你需要通过提问引导学生自己发现解题思路，永远不直接给答案或解题步骤。\n\n'
        f'题目：{problem_text}\n'
        f'学科：{subject or "未知"}\n'
        f'难度：{difficulty}\n'
        f'知识点：{", ".join(knowledge_points) if knowledge_points else "待确认"}\n'
        + (f'学生学段：{grade_level}\n' if grade_level else '') +
        '\n'
        '现在，作为讲题导师，请用一个简短的问句开场。你的目标是：\n'
        '1. 先确认学生是否理解了题意，或者问TA读题后的第一反应\n'
        '2. 语气要亲切、鼓励，像一位耐心的家教老师\n'
        '3. 控制在80字以内\n'
        '4. 不要说"让我来讲解"或"我们一起来看看答案"\n'
        '5. 数学公式使用 $...$（行内）和 $$...$$（块级）包裹，如 $x^2$、$$\\int_0^1 x dx$$\n'
        '\n'
        '请直接输出你的开场引导语，不要加任何前缀或引号。'
    )

    try:
        greeting = chat_completion(
            [{'role': 'user', 'content': greeting_prompt}],
            temperature=0.7,
            user_id=user_id,
        ).strip()
    except Exception:
        greeting = f'你好！看到这道{"数学" if not subject else subject}题，你第一反应是什么？能用自己的话说说题目在问什么吗？'

    # Create session
    dialogue = [
        {'role': 'tutor', 'content': greeting, 'step': 0, 'timestamp': None},
    ]
    with transaction() as conn:
        conn.execute(
            '''INSERT INTO tutoring_sessions
               (id, user_id, problem_text, problem_image_path, subject, knowledge_points,
                difficulty, grade_level, dialogue)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                session_id,
                user_id,
                problem_text,
                image_path,
                subject,
                json_dumps(knowledge_points),
                difficulty,
                grade_level,
                json_dumps(dialogue),
            ),
        )

    return jsonify({
        'data': {
            'sessionId': session_id,
            'problemAnalysis': {
                'subject': subject,
                'knowledgePoints': knowledge_points,
                'difficulty': difficulty,
                'gradeLevel': grade_level,
            },
            'greeting': greeting,
        }
    }), 201


@bp.post('/<session_id>/respond')
@login_required
def respond(session_id):
    data = request.get_json(silent=True) or {}
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({'message': '请输入你的回答', 'code': 'VALIDATION_ERROR'}), 400

    user_id = current_user_id()
    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM tutoring_sessions WHERE id = ? AND user_id = ?',
            (session_id, user_id),
        ).fetchone()
    if not row:
        return jsonify({'message': '讲题会话不存在', 'code': 'NOT_FOUND'}), 404

    dialogue = json_loads(row['dialogue'], [])
    knowledge_points = json_loads(row['knowledge_points'], [])
    hints_given = json_loads(row['hints_given'], [])
    current_step = row['current_step']
    total_steps = row['total_steps']

    # Append student message to dialogue
    dialogue.append({'role': 'student', 'content': message, 'step': current_step, 'timestamp': None})

    def generate():
        nonlocal dialogue, current_step, total_steps, hints_given

        # Build tutoring messages
        msgs = build_tutoring_messages(
            problem_text=row['problem_text'],
            subject=row['subject'],
            difficulty=row['difficulty'],
            grade_level=row['grade_level'],
            knowledge_points=knowledge_points,
            dialogue=dialogue,
            hints_given=hints_given,
            current_step=current_step,
            total_steps=total_steps,
            user_id=user_id,
        )

        chunks: list[str] = []
        final_data: dict = {}
        solved = row['solved']

        try:
            for chunk in stream_chat(
                msgs,
                final_payload=None,
                temperature=0.65,
                user_id=user_id,
            ):
                event, payload = parse_sse_chunk(chunk)
                if event == 'stream' and payload.get('type') == 'text':
                    chunks.append(str(payload.get('content') or ''))
                if event == 'final':
                    final_data = payload
                yield chunk
        except Exception:
            yield sse('error', {'type': 'error', 'message': 'AI 服务暂时不可用'})
            return

        ai_reply = ''.join(chunks).strip()
        if not ai_reply:
            ai_reply = '没关系，我们换个角度想想——你能从题目中找到哪些已知条件？'

        # Determine if the problem was solved
        if final_data.get('solved'):
            solved = 1
        elif _detect_solved(ai_reply):
            solved = 1

        # Increment step
        current_step += 1

        # Extract any hints in the AI reply
        hint_keywords = ['提示', '小提示', '想一想', '提醒', '回顾', '回忆']
        if any(kw in ai_reply for kw in hint_keywords):
            hints_given.append({'step': current_step, 'hint': ai_reply[:120]})

        dialogue.append({'role': 'tutor', 'content': ai_reply, 'step': current_step, 'timestamp': None})

        # Update session
        with transaction() as conn:
            conn.execute(
                '''UPDATE tutoring_sessions
                   SET dialogue = ?, current_step = ?, hints_given = ?, solved = ?,
                       status = ?, updated_at = datetime('now')
                   WHERE id = ?''',
                (
                    json_dumps(dialogue),
                    current_step,
                    json_dumps(hints_given),
                    solved,
                    'completed' if solved else 'active',
                    session_id,
                ),
            )

        # Log interaction
        log_interaction(user_id, 'tutoring', message, ai_reply, session_id, knowledge_points)

        # If solved, update weak points (student demonstrated understanding)
        if solved and knowledge_points:
            try:
                upsert_weak_points(user_id, knowledge_points, source='tutoring', correct=True)
            except Exception:
                pass

    return Response(generate(), mimetype='text/event-stream')


def build_tutoring_messages(
    problem_text: str,
    subject: str,
    difficulty: str,
    grade_level: str,
    knowledge_points: list[str],
    dialogue: list[dict],
    hints_given: list[dict],
    current_step: int,
    total_steps: int,
    user_id: str | None = None,
) -> list[dict[str, str]]:
    # Build dialogue history (last 8 turns)
    history_lines: list[str] = []
    for item in dialogue[-8:]:
        role_label = '学生' if item.get('role') == 'student' else '导师'
        history_lines.append(f'{role_label}：{item.get("content", "")}')

    grade_line = f'学生学段/年级：{grade_level}\n请使用适合该学段学生的语言、例子和引导方式。' if grade_level else ''
    subject_line = f'学科：{subject}' if subject else ''
    difficulty_line = f'难度：{difficulty}' if difficulty else ''
    knowledge_line = f'涉及知识点：{", ".join(knowledge_points)}' if knowledge_points else ''
    hints_line = ''
    if hints_given:
        hints_line = f'已给过的提示（不要再重复）：\n' + '\n'.join(
            f'  - {h.get("hint", "")}' for h in hints_given[-3:]
        )

    body = f'''你是启发式讲题导师。你的目标是通过苏格拉底式的提问，引导学生自己发现解题思路和方法。

核心原则：
1. 永远不直接给出答案或完整的解题步骤
2. 通过提问引导学生自己思考、推理、发现
3. 学生卡住时，给出最小、最模糊的提示，逐步递进
4. 学生答错时，不要说"你错了"，而是请TA解释推理过程，让TA自己发现矛盾
5. 根据学生的学段/年级调整语言难度和例子
6. 解题成功后，简要总结关键思路和方法论

引导策略：
- 第一步：确认学生对题目的理解——"这道题在问什么？"
- 第二步：探询已有思路——"你看到这道题，第一反应是什么？"
- 第三步：针对卡点引导——"如果已知X，能推出Y吗？""这个条件和什么知识点有关？"
- 逐步提示梯度：概念提醒 → 方法暗示 → 具体线索（但永远不给完整答案）
- 学生如果思路正确，说"对的！接下来呢？"然后继续引导下一步

禁止行为：
❌ 不要说"答案是..."
❌ 不要说"正确解法是..."
❌ 不要给出完整的分步解答
❌ 不要直接纠正——用提问让学生自己发现
❌ 不要连续给多个提示，每次最多一个

回复要求：
- 像一位亲切耐心的家教老师
- 口语化表达，不要太正式
- 每次回复聚焦一个问题或一个提示
- 如果学生已经解出来了，简要总结并表扬

{grade_line}
{subject_line}
{difficulty_line}
{knowledge_line}
{hints_line}

题目：
{problem_text}

对话历史：
{chr(10).join(history_lines) if history_lines else '暂无'}

现在，根据学生最新的回答，给出你的引导（一个问题或一个提示）。
数学公式使用 $...$（行内）和 $$...$$（块级）包裹，如 $x^2$、$$\\frac{{a}}{{b}}$$。'''

    messages = [{'role': 'user', 'content': '启发式讲题导师'}]

    if user_id:
        profile_context = get_user_profile_context(user_id)
        if profile_context:
            messages.append({'role': 'user', 'content': profile_context})

    if user_id:
        learning_context = get_learning_context(user_id)
        if learning_context:
            messages.append({'role': 'user', 'content': learning_context})

    messages.append({'role': 'user', 'content': body})
    return messages


def _detect_solved(text: str) -> bool:
    """Heuristic: check if the AI's reply indicates the problem has been solved."""
    solved_markers = [
        '你做出来了', '恭喜你', '你解出来了', '你找到了正确答案',
        '你成功', '你的思路完全正确', '你已经掌握了', '总结一下',
        '关键思路', '你已经理解', '完美', '非常好，你做',
    ]
    return any(marker in text for marker in solved_markers)


# ---- list / detail / delete ----

@bp.get('/<session_id>')
@login_required
def get_session(session_id):
    user_id = current_user_id()
    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM tutoring_sessions WHERE id = ? AND user_id = ?',
            (session_id, user_id),
        ).fetchone()
    if not row:
        return jsonify({'message': '讲题会话不存在', 'code': 'NOT_FOUND'}), 404

    return jsonify({'data': _format_session(row)})


@bp.get('/', strict_slashes=False)
@login_required
def list_sessions():
    user_id = current_user_id()
    status_filter = request.args.get('status', '')
    limit = min(int(request.args.get('limit', '50')), 100)
    offset = max(int(request.args.get('offset', '0')), 0)

    with transaction() as conn:
        if status_filter:
            rows = conn.execute(
                'SELECT * FROM tutoring_sessions WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
                (user_id, status_filter, limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM tutoring_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
                (user_id, limit, offset),
            ).fetchall()

    return jsonify({'data': [_format_session_list_item(r) for r in rows]})


@bp.delete('/<session_id>')
@login_required
def delete_session(session_id):
    user_id = current_user_id()
    with transaction() as conn:
        result = conn.execute(
            'DELETE FROM tutoring_sessions WHERE id = ? AND user_id = ?',
            (session_id, user_id),
        )
        if result.rowcount == 0:
            return jsonify({'message': '讲题会话不存在', 'code': 'NOT_FOUND'}), 404
    return jsonify({'message': '删除成功'}), 200


# ---- response formatters ----

def _format_session(row) -> dict:
    return {
        'id': row['id'],
        'problemText': row['problem_text'],
        'problemImagePath': row['problem_image_path'] or None,
        'subject': row['subject'],
        'knowledgePoints': json_loads(row['knowledge_points'], []),
        'difficulty': row['difficulty'],
        'gradeLevel': row['grade_level'],
        'status': row['status'],
        'currentStep': row['current_step'],
        'totalSteps': row['total_steps'],
        'hintsGiven': json_loads(row['hints_given'], []),
        'dialogue': json_loads(row['dialogue'], []),
        'solved': bool(row['solved']),
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
    }


def _format_session_list_item(row) -> dict:
    problem_text = row['problem_text']
    if len(problem_text) > 60:
        problem_text = problem_text[:60].rstrip() + '...'
    return {
        'id': row['id'],
        'problemText': problem_text,
        'subject': row['subject'],
        'difficulty': row['difficulty'],
        'status': row['status'],
        'solved': bool(row['solved']),
        'currentStep': row['current_step'],
        'totalSteps': row['total_steps'],
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
    }
