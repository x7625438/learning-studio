from __future__ import annotations

from datetime import date, timedelta
from flask import Blueprint, Response, jsonify, request

import config
from auth import current_user_id, login_required
from database import json_dumps, json_loads, row_to_dict, rows_to_dicts, transaction
from services.ai_service import chat_completion_json, sse, stream_chat
from services.learning_service import get_learning_context, log_interaction, new_id
from services.search_service import format_search_results, search_web, should_search

bp = Blueprint('learning_path', __name__, url_prefix='/api/v1/learning-path')


def make_weeks(topic: str, weeks: int) -> list[dict]:
    return [
        {
            'weekNumber': index + 1,
            'title': f'{topic} · 第 {index + 1} 周',
            'topics': [f'{topic} 核心概念 {index + 1}', f'{topic} 练习主题 {index + 1}'],
            'exercises': ['完成 5 道针对性练习', '用费曼法讲解一个概念'],
            'reviewTopics': ['复盘本周薄弱点'],
            'status': 'pending' if index else 'in_progress',
            'completedAt': None,
        }
        for index in range(max(1, min(24, weeks)))
    ]


def make_ai_weeks(topic: str, current_level: str, goal: str, hours_per_week: int, target_weeks: int, user_id: str | None = None) -> list[dict]:
    target_weeks = max(1, min(24, target_weeks))
    fallback = {'weeks': make_weeks(topic, target_weeks)}

    # 获取学习档案上下文
    learning_context = ''
    if user_id:
        learning_context = get_learning_context(user_id)

    # 判断是否需要搜索最新信息
    search_context = ''
    if should_search(topic):
        search_results = search_web(f'{topic} 学习路线 最新趋势', max_results=3)
        if search_results:
            search_context = '\n\n' + format_search_results(search_results) + '\n请参考以上最新信息来规划学习路径。\n'

    prompt = f"""
{learning_context}

为用户生成 {target_weeks} 周学习路径。只返回 JSON，不要 markdown。

输入：主题={topic}；水平={current_level}；目的={goal}；每周={hours_per_week} 小时。
{search_context}
要求：
1. 根据用户的学习档案（学习目标、当前阶段、自我介绍、学习偏好）来定制路径
2. 如果用户有薄弱点，优先在前几周安排针对性的复习和强化
3. 参考用户最近的学习行为和知识点，确保路径的连贯性
4. 每周 topics 2-4 个具体知识点，exercises 2-4 个可执行任务，reviewTopics 1-3 个复盘点
5. 第一周 in_progress，其余 pending；不要占位文本
6. 根据用户的学习偏好调整教学方式（例如：用生活例子引入概念、循序渐进等）

格式：
{{
  "weeks": [
    {{
      "weekNumber": 1,
      "title": "20字内目标",
      "topics": ["具体知识点"],
      "exercises": ["可执行任务"],
      "reviewTopics": ["复盘点"],
      "status": "in_progress",
      "completedAt": null
    }}
  ]
}}
"""
    try:
        plan = chat_completion_json([{'role': 'user', 'content': prompt}], fallback=fallback, temperature=0.3, user_id=user_id)
    except Exception:
        plan = fallback
    weeks = normalize_ai_weeks(plan.get('weeks'), target_weeks)
    return weeks or make_weeks(topic, target_weeks)


def normalize_ai_weeks(raw_weeks, target_weeks: int) -> list[dict]:
    if not isinstance(raw_weeks, list):
        return []
    normalized: list[dict] = []
    for index, item in enumerate(raw_weeks[:target_weeks]):
        if not isinstance(item, dict):
            continue
        title = clean_text(item.get('title')) or f'第 {index + 1} 周学习目标'
        topics = clean_list(item.get('topics'))[:4]
        exercises = clean_list(item.get('exercises'))[:4]
        review_topics = clean_list(item.get('reviewTopics'))[:3]
        if not topics or not exercises:
            continue
        normalized.append(
            {
                'weekNumber': index + 1,
                'title': title,
                'topics': topics,
                'exercises': exercises,
                'reviewTopics': review_topics or ['复盘本周错题和薄弱点'],
                'status': 'in_progress' if index == 0 else 'pending',
                'completedAt': None,
            }
        )
    return normalized if len(normalized) == target_weeks else []


def clean_text(value) -> str:
    return str(value or '').strip()[:80]


def clean_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    cleaned = [clean_text(item) for item in value]
    return [item for item in cleaned if item]


@bp.post('/generate')
@login_required
def generate():
    user_id = current_user_id()
    data = request.get_json(silent=True) or {}
    topic = (data.get('topic') or '数学基础').strip()
    current_level = data.get('currentLevel') or 'beginner'
    goal = data.get('goal') or 'exam'
    hours_per_week = int(data.get('hoursPerWeek') or 6)
    target_weeks = int(data.get('targetWeeks') or 4)
    with transaction() as conn:
        active_count = conn.execute(
            "SELECT COUNT(*) AS count FROM learning_paths WHERE user_id = ? AND status = 'active'",
            (user_id,),
        ).fetchone()['count']
        if active_count >= config.MAX_ACTIVE_PATHS:
            return jsonify({'message': '最多同时保留 3 个活跃学习路径', 'code': 'LIMIT_EXCEEDED'}), 400
        path_id = new_id()
        weeks = make_ai_weeks(topic, current_level, goal, hours_per_week, target_weeks, user_id=user_id)
        conn.execute(
            """
            INSERT INTO learning_paths
            (id, user_id, topic, current_level, goal, hours_per_week, target_weeks, weeks_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (path_id, user_id, topic, current_level, goal, hours_per_week, len(weeks), json_dumps(weeks)),
        )

    # 记录到学习档案
    log_interaction(
        user_id,
        'learning_path',
        f'生成学习路径：{topic}，当前水平 {current_level}，目标 {goal}，每周 {hours_per_week} 小时，共 {target_weeks} 周',
        f'生成了 {len(weeks)} 周的学习计划',
        path_id,
        knowledge_points=[topic],
        should_update_weak_points=False,
    )

    return jsonify({'data': {'id': path_id, 'topic': topic, 'weeks': weeks, 'status': 'active'}}), 201


@bp.get('/current')
@login_required
def current():
    with transaction() as conn:
        row = row_to_dict(
            conn.execute(
                "SELECT * FROM learning_paths WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
                (current_user_id(),),
            ).fetchone()
        )
    if not row:
        return jsonify({'data': None})
    row['weeks'] = json_loads(row.pop('weeks_data'), [])
    return jsonify({'data': row})


@bp.put('/<path_id>')
@login_required
def update(path_id):
    data = request.get_json(silent=True) or {}
    with transaction() as conn:
        row = conn.execute('SELECT * FROM learning_paths WHERE id = ? AND user_id = ?', (path_id, current_user_id())).fetchone()
        if not row:
            return jsonify({'message': '学习路径不存在', 'code': 'NOT_FOUND'}), 404
        weeks = data.get('weeks') or json_loads(row['weeks_data'], [])
        conn.execute(
            'UPDATE learning_paths SET status = COALESCE(?, status), weeks_data = ?, updated_at = datetime("now") WHERE id = ?',
            (data.get('status'), json_dumps(weeks), path_id),
        )
    return jsonify({'data': {'ok': True}})


@bp.get('/<path_id>/week/<int:num>')
@login_required
def week(path_id, num):
    with transaction() as conn:
        row = conn.execute('SELECT * FROM learning_paths WHERE id = ? AND user_id = ?', (path_id, current_user_id())).fetchone()
    if not row:
        return jsonify({'message': '学习路径不存在', 'code': 'NOT_FOUND'}), 404
    weeks = json_loads(row['weeks_data'], [])
    item = next((week for week in weeks if week['weekNumber'] == num), None)
    return jsonify({'data': item})


@bp.post('/<path_id>/chat')
@login_required
def chat(path_id):
    """
    与 AI 对话调整学习路径
    """
    user_id = current_user_id()
    data = request.get_json(silent=True) or {}
    message = (data.get('message') or '').strip()

    if not message:
        return jsonify({'message': '消息不能为空', 'code': 'VALIDATION_ERROR'}), 400

    with transaction() as conn:
        row = conn.execute('SELECT * FROM learning_paths WHERE id = ? AND user_id = ?', (path_id, user_id)).fetchone()

    if not row:
        return jsonify({'message': '学习路径不存在', 'code': 'NOT_FOUND'}), 404

    # 获取当前路径信息
    topic = row['topic']
    current_level = row['current_level']
    goal = row['goal']
    hours_per_week = row['hours_per_week']
    target_weeks = row['target_weeks']
    weeks = json_loads(row['weeks_data'], [])

    # 获取历史对话
    with transaction() as conn:
        history_rows = rows_to_dicts(
            conn.execute(
                """
                SELECT user_input, ai_response FROM interaction_logs
                WHERE user_id = ? AND source_type = 'learning_path_chat' AND source_id = ?
                ORDER BY created_at DESC LIMIT 10
                """,
                (user_id, path_id),
            ).fetchall()
        )

    # 构建对话历史
    chat_history = []
    for h in reversed(history_rows):
        if h['user_input']:
            chat_history.append({'role': 'user', 'content': h['user_input']})
        if h['ai_response']:
            chat_history.append({'role': 'assistant', 'content': h['ai_response']})

    # 构建系统提示
    weeks_summary = '\n'.join([
        f"第{w['weekNumber']}周: {w['title']} - 主题: {', '.join(w['topics'][:2])}"
        for w in weeks[:5]
    ])

    system_prompt = f"""你是学习路径规划助手，正在帮助用户调整他们的学习计划。

当前路径信息：
- 学习主题：{topic}
- 当前水平：{current_level}
- 学习目的：{goal}
- 每周时长：{hours_per_week} 小时
- 计划周数：{target_weeks} 周

当前路径概览：
{weeks_summary}

你的职责：
1. 倾听用户的需求和困难（时间不够、内容太难、想加入某个主题等）
2. 提供具体的调整建议（调整周数、调整难度、重新安排顺序等）
3. 如果用户确认调整，给出修改后的具体周计划（JSON格式）

对话原则：
- 先理解用户的具体需求，不要急于给建议
- 建议要具体可执行，不要泛泛而谈
- 如果用户说"太难了"，问清楚是哪一周、哪个知识点难
- 如果用户想加内容，确认是替换还是延长周数
- 保持对话简洁，每次回复控制在150字以内

当用户明确要求修改路径时，在回复末尾用以下格式给出新的周计划：
```json
{{
  "action": "update_path",
  "weeks": [...]
}}
```
"""

    messages = [{'role': 'system', 'content': system_prompt}] + chat_history + [{'role': 'user', 'content': message}]

    def generate():
        chunks = []
        for chunk in stream_chat(messages, temperature=0.7, user_id=user_id):
            chunks.append(chunk)
            yield chunk

        # 提取 AI 回复
        ai_reply = ''
        for chunk in chunks:
            if 'data:' in chunk:
                try:
                    import json
                    data_str = chunk.split('data:', 1)[1].strip()
                    if data_str and data_str != '[DONE]':
                        chunk_data = json.loads(data_str)
                        if chunk_data.get('type') == 'text':
                            ai_reply += chunk_data.get('content', '')
                except:
                    pass

        # 保存对话记录
        with transaction() as conn:
            conn.execute(
                """
                INSERT INTO interaction_logs
                (id, user_id, source_type, source_id, user_input, ai_response, extracted_knowledge, summary)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id(),
                    user_id,
                    'learning_path_chat',
                    path_id,
                    message,
                    ai_reply,
                    json_dumps([topic]),
                    f'学习路径对话：{message[:50]}',
                ),
            )

    return Response(generate(), mimetype='text/event-stream')


@bp.delete('/<path_id>')
@login_required
def delete_path(path_id):
    user_id = current_user_id()
    with transaction() as conn:
        row = conn.execute(
            'SELECT id FROM learning_paths WHERE id = ? AND user_id = ?',
            (path_id, user_id),
        ).fetchone()
        if not row:
            return jsonify({'message': '学习路径不存在', 'code': 'NOT_FOUND'}), 404

        conn.execute('DELETE FROM learning_paths WHERE id = ? AND user_id = ?', (path_id, user_id))

    return jsonify({'data': {'ok': True}})
