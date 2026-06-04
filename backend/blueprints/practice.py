from __future__ import annotations

from datetime import date, datetime

from flask import Blueprint, current_app, jsonify, request

from auth import current_user_id, login_required
from database import json_dumps, json_loads, row_to_dict, rows_to_dicts, transaction
from services.learning_service import (
    build_practice_questions,
    fallback_practice_question,
    new_id,
    normalize_weak_point,
    today,
    update_study_record,
    upsert_weak_points,
)

bp = Blueprint('practice', __name__, url_prefix='/api/v1/practice')


def has_placeholder_text(value: str | None) -> bool:
    text = str(value or '')
    template_signals = ['复习方式', '自查问题', '看过这一页', '抄写三遍', '直接下一题']
    return '???' in text or text.count('?') >= 4 or any(signal in text for signal in template_signals)


def normalize_question(row: dict) -> dict:
    question = {
        'id': row['id'],
        'weakPointId': row.get('weak_point_id'),
        'knowledgeName': row['knowledge_name'],
        'questionText': row['question_text'],
        'choices': json_loads(row.get('choices'), []),
        'correctAnswer': row['correct_answer'],
        'hint': row.get('hint'),
        'explanation': row.get('explanation'),
        'bloomLevel': row.get('bloom_level'),
        'desirableDifficulty': row.get('desired_difficulty'),
        'adaptiveReason': row.get('adaptive_reason'),
        'sourceType': row.get('source_type') or 'weak_point',
        'diagramSvg': row.get('diagram_svg') or '',
    }
    user_facing_text = [
        question['questionText'],
        question['hint'],
        question['explanation'],
        *[choice.get('text') for choice in question['choices'] if isinstance(choice, dict)],
    ]
    if any(has_placeholder_text(text) for text in user_facing_text):
        question = fallback_practice_question(question['id'], {'id': question.get('weakPointId'), 'knowledge_name': question['knowledgeName']})
    return question


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None


def days_until(value: str | None) -> int:
    parsed = parse_date(value)
    if not parsed:
        return -3
    return (parsed - date.today()).days


def bloom_level_for(mastery_score: float, error_count: int, position: int) -> str:
    if mastery_score < 35:
        sequence = ['记忆', '理解', '理解', '应用']
    elif mastery_score < 60:
        sequence = ['理解', '应用', '分析', '应用']
    elif error_count >= 3:
        sequence = ['应用', '分析', '评价', '分析']
    else:
        sequence = ['应用', '分析', '评价', '创造']
    return sequence[position % len(sequence)]


def desirable_difficulty_for(mastery_score: float, due_days: int, wrong_count: int, position: int) -> str:
    if mastery_score < 35 or due_days <= -7:
        return '基础巩固' if position % 2 == 0 else '轻微变化'
    if wrong_count >= 2:
        return '错因辨析'
    if mastery_score >= 65:
        return '交错迁移'
    return '轻微变化'


def build_adaptive_sources(user_id: str, target_count: int) -> tuple[list[dict], dict]:
    with transaction() as conn:
        weak_points = rows_to_dicts(
            conn.execute(
                """
                SELECT * FROM weak_points
                WHERE user_id = ? AND ignored = 0
                  AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
                """,
                (user_id,),
            ).fetchall()
        )
        if not weak_points:
            weak_points = rows_to_dicts(
                conn.execute(
                    """
                    SELECT * FROM weak_points
                    WHERE user_id = ? AND ignored = 0
                    """,
                    (user_id,),
                ).fetchall()
            )
        wrong_questions = rows_to_dicts(
            conn.execute(
                """
                SELECT id, question_text, error_type, knowledge_points, mastery_level, review_count,
                       last_reviewed_at, next_review_at, created_at
                FROM wrong_questions
                WHERE user_id = ? AND status != 'archived'
                ORDER BY mastery_level ASC, created_at DESC
                LIMIT 80
                """,
                (user_id,),
            ).fetchall()
        )

    wrong_by_knowledge: dict[str, list[dict]] = {}
    for wrong_question in wrong_questions:
        for knowledge_name in json_loads(wrong_question.get('knowledge_points'), []):
            knowledge = str(knowledge_name or '').strip()
            if knowledge:
                wrong_by_knowledge.setdefault(knowledge, []).append(wrong_question)

    source_by_knowledge: dict[str, dict] = {}
    for weak_point in weak_points:
        knowledge = str(weak_point.get('knowledge_name') or '').strip()
        if not knowledge:
            continue
        source_by_knowledge[knowledge] = {
            **weak_point,
            'source_type': weak_point.get('source') or 'weak_point',
            'wrong_context': [
                {
                    'question': item.get('question_text'),
                    'errorType': item.get('error_type'),
                    'masteryLevel': item.get('mastery_level'),
                }
                for item in wrong_by_knowledge.get(knowledge, [])[:3]
            ],
        }

    for knowledge, questions in wrong_by_knowledge.items():
        if knowledge not in source_by_knowledge:
            worst_mastery = min(int(item.get('mastery_level') or 0) for item in questions)
            source_by_knowledge[knowledge] = {
                'id': None,
                'user_id': user_id,
                'knowledge_name': knowledge,
                'mastery_score': max(5, min(95, worst_mastery)),
                'error_count': len(questions),
                'correct_count': 0,
                'last_practiced_at': questions[0].get('last_reviewed_at'),
                'next_review_at': questions[0].get('next_review_at'),
                'review_interval': 1,
                'source': 'wrong_questions',
                'source_type': 'wrong_questions',
                'wrong_context': [
                    {
                        'question': item.get('question_text'),
                        'errorType': item.get('error_type'),
                        'masteryLevel': item.get('mastery_level'),
                    }
                    for item in questions[:3]
                ],
            }

    scored_sources = []
    for source in source_by_knowledge.values():
        mastery_score = float(source.get('mastery_score') or 50)
        error_count = int(source.get('error_count') or 0)
        correct_count = int(source.get('correct_count') or 0)
        review_interval = max(1, int(source.get('review_interval') or 1))
        due_days = days_until(source.get('next_review_at'))
        wrong_count = len(source.get('wrong_context') or [])
        fsrs_pressure = 45 if due_days <= 0 else max(0, 24 - due_days * 4)
        forgetting_risk = max(0, 70 - mastery_score)
        error_pressure = min(30, error_count * 5 + wrong_count * 6)
        stability_bonus = max(0, 10 - review_interval)
        correct_offset = min(18, correct_count * 3)
        source['adaptive_score'] = fsrs_pressure + forgetting_risk + error_pressure + stability_bonus - correct_offset
        source['due_days'] = due_days
        scored_sources.append(source)

    scored_sources.sort(key=lambda item: item.get('adaptive_score') or 0, reverse=True)
    if not scored_sources:
        return [], {
            'strategy': 'adaptive-paper',
            'focus': [],
            'bloomDistribution': {},
            'difficultyMix': {},
            'sourceMix': {},
        }

    selected = []
    for index in range(target_count):
        source = dict(scored_sources[index % len(scored_sources)])
        mastery_score = float(source.get('mastery_score') or 50)
        error_count = int(source.get('error_count') or 0)
        wrong_count = len(source.get('wrong_context') or [])
        due_days = int(source.get('due_days') or 0)
        source['bloom_level'] = bloom_level_for(mastery_score, error_count, index)
        source['desired_difficulty'] = desirable_difficulty_for(mastery_score, due_days, wrong_count, index)
        due_text = '已到复习窗口' if due_days <= 0 else f'{due_days} 天后到复习窗口'
        source['adaptive_reason'] = (
            f"FSRS: {due_text}；掌握度 {round(mastery_score)}；"
            f"错题关联 {wrong_count} 条；本题用于{source['desired_difficulty']}。"
        )
        selected.append(source)

    def count_by(key: str) -> dict:
        counts: dict[str, int] = {}
        for item in selected:
            value = item.get(key) or '未标注'
            counts[value] = counts.get(value, 0) + 1
        return counts

    meta = {
        'strategy': 'adaptive-paper',
        'focus': [
            {
                'knowledgeName': item.get('knowledge_name'),
                'masteryScore': round(float(item.get('mastery_score') or 0), 1),
                'dueDays': item.get('due_days'),
                'adaptiveScore': round(float(item.get('adaptive_score') or 0), 1),
                'reason': item.get('adaptive_reason'),
            }
            for item in selected[: min(6, len(selected))]
        ],
        'bloomDistribution': count_by('bloom_level'),
        'difficultyMix': count_by('desired_difficulty'),
        'sourceMix': count_by('source_type'),
    }
    return selected, meta


def load_today_task(user_id: str) -> dict:
    with transaction() as conn:
        task = conn.execute(
            'SELECT * FROM daily_practice_tasks WHERE user_id = ? AND date = ?',
            (user_id, today()),
        ).fetchone()
        if not task:
            return {'task': {'id': None, 'date': today(), 'target_count': 0, 'completed_count': 0}, 'questions': []}
        ids = json_loads(task['question_ids'], [])
        questions = []
        completed_count = 0
        if ids:
            placeholders = ','.join(['?'] * len(ids))
            submitted_ids = {
                row['question_id']
                for row in conn.execute(
                    f"""
                    SELECT DISTINCT question_id FROM practice_submissions
                    WHERE user_id = ? AND question_id IN ({placeholders})
                    """,
                    [user_id, *ids],
                ).fetchall()
            }
            completed_count = min(len(submitted_ids), len(ids))
            rows = rows_to_dicts(
                conn.execute(
                    f'SELECT * FROM practice_questions WHERE id IN ({placeholders})',
                    ids,
                ).fetchall()
            )
            by_id = {row['id']: row for row in rows}
            questions = [by_id[question_id] for question_id in ids if question_id not in submitted_ids and question_id in by_id]
        task_dict = row_to_dict(task)
        task_dict['completed_count'] = completed_count
        return {'task': task_dict, 'questions': questions}


def create_today_task(user_id: str, target_count: int) -> dict:
    target_count = max(1, min(50, target_count))
    selected_sources, paper_meta = build_adaptive_sources(user_id, target_count)

    if not selected_sources:
        return {
            'task': {'id': None, 'date': today(), 'target_count': target_count, 'completed_count': 0},
            'questions': [],
            'reason': '还没有可用薄弱点或错题。先完成一次问答、教材学习或上传错题后，再生成自适应试卷。',
            'paperMeta': paper_meta,
        }

    try:
        questions = build_practice_questions(user_id, selected_sources)
    except Exception as e:
        print(f'[ERROR] Failed to build practice questions: {e}')
        import traceback
        traceback.print_exc()
        raise

    task_id = new_id()
    with transaction() as conn:
        conn.execute('DELETE FROM daily_practice_tasks WHERE user_id = ? AND date = ?', (user_id, today()))
        conn.execute(
            """
            INSERT INTO daily_practice_tasks (id, user_id, date, target_count, question_ids)
            VALUES (?, ?, ?, ?, ?)
            """,
            (task_id, user_id, today(), target_count, json_dumps([question['id'] for question in questions])),
        )
    return {
        'task': {'id': task_id, 'date': today(), 'target_count': target_count, 'completed_count': 0},
        'questions': questions,
        'reason': None,
        'paperMeta': paper_meta,
    }


@bp.get('/today')
@login_required
def today_task():
    result = load_today_task(current_user_id())
    task = result['task']
    questions = [normalize_question(question) if 'question_text' in question else question for question in result['questions']]
    reason = None if questions else '今天还没有生成训练。先设定题目数量，再点击“生成今日训练”。'
    return jsonify(
        {
            'data': {
                'date': today(),
                'targetCount': task['target_count'],
                'completedCount': task['completed_count'],
                'questions': questions,
                'emptyReason': reason,
                'paperMeta': {},
            }
        }
    )


@bp.post('/generate')
@login_required
def generate():
    data = request.get_json(silent=True) or {}
    target_count = int(data.get('targetCount') or 5)
    try:
        result = create_today_task(current_user_id(), target_count)
        task = result['task']
        questions = [normalize_question(question) if 'question_text' in question else question for question in result['questions']]
        return jsonify(
            {
                'data': {
                    'date': today(),
                    'targetCount': task['target_count'],
                    'completedCount': task['completed_count'],
                    'questions': questions,
                    'emptyReason': result.get('reason'),
                    'paperMeta': result.get('paperMeta') or {},
                }
            }
        )
    except ValueError as e:
        return jsonify({'message': f'生成题目失败：{str(e)}', 'code': 'GENERATION_FAILED'}), 500
    except Exception as e:
        return jsonify({'message': f'生成训练时出错：{str(e)}', 'code': 'INTERNAL_ERROR'}), 500


def _add_to_wrong_questions(conn, user_id: str, question: dict, user_answer: str) -> None:
    """答错时自动将题目加入错题本"""
    from datetime import datetime, timedelta

    # 将 choices 转为 options 格式
    choices = json_loads(question.get('choices'), [])
    options = [f"{c.get('key', '')}. {c.get('text', '')}" for c in choices] if choices else []

    conn.execute(
        """INSERT INTO wrong_questions
           (id, user_id, question_text, options, subject, difficulty, user_answer, correct_answer,
            error_type, error_analysis, knowledge_points, ai_explanation, status, next_review_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            new_id(),
            user_id,
            question.get('question_text', ''),
            json_dumps(options),
            '数学',
            question.get('desired_difficulty') or '中等',
            user_answer,
            question.get('correct_answer', ''),
            '练习错误',
            f'在自适应练习中答错了这道题。你选择了 {user_answer}，正确答案是 {question.get("correct_answer", "")}。\n\n解析：{question.get("explanation", "")}',
            json_dumps([question.get('knowledge_name', '')]),
            question.get('explanation', ''),
            'pending',
            (datetime.now() + timedelta(days=1)).isoformat(),
            datetime.now().isoformat(),
        ),
    )


@bp.post('/submit')
@login_required
def submit():
    data = request.get_json(silent=True) or {}
    question_id = data.get('questionId')
    answer = data.get('answer') or ''
    user_id = current_user_id()
    with transaction() as conn:
        question = row_to_dict(
            conn.execute(
                'SELECT * FROM practice_questions WHERE id = ? AND user_id = ?',
                (question_id, user_id),
            ).fetchone()
        )
        existing = row_to_dict(
            conn.execute(
                'SELECT * FROM practice_submissions WHERE question_id = ? AND user_id = ? LIMIT 1',
                (question_id, user_id),
            ).fetchone()
        )
    if not question:
        return jsonify({'message': '题目不存在', 'code': 'NOT_FOUND'}), 404
    if existing:
        return jsonify(
            {
                'data': {
                    'correct': bool(existing['is_correct']),
                    'explanation': question['explanation'],
                    'nextQuestion': None,
                    'duplicate': True,
                }
            }
        )

    is_correct = answer == question['correct_answer'] or data.get('feeling') == 'remember'
    interaction = {
        'id': new_id(),
        'user_id': user_id,
        'source_type': 'practice',
        'source_id': question_id,
        'user_input': f"主动回忆作答：{question['question_text']} 用户答案：{answer or data.get('feeling') or '未填写'}",
        'ai_response': question['explanation'] or '',
        'extracted_knowledge': json_dumps([question['knowledge_name']]),
        'summary': f"主动回忆：{'答对' if is_correct else '答错'} {question['knowledge_name']}",
    }
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO practice_submissions
            (id, user_id, question_id, answer, feeling, is_correct, time_spent_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id(),
                user_id,
                question_id,
                answer,
                data.get('feeling'),
                1 if is_correct else 0,
                int(data.get('timeSpentSeconds') or 0),
            ),
        )
        conn.execute(
            'UPDATE daily_practice_tasks SET completed_count = completed_count + 1 WHERE user_id = ? AND date = ?',
            (user_id, today()),
        )
        conn.execute(
            """
            INSERT INTO interaction_logs
            (id, user_id, source_type, source_id, user_input, ai_response, extracted_knowledge, summary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                interaction['id'],
                interaction['user_id'],
                interaction['source_type'],
                interaction['source_id'],
                interaction['user_input'],
                interaction['ai_response'],
                interaction['extracted_knowledge'],
                interaction['summary'],
            ),
        )

        # 答错时自动加入错题本
        if not is_correct:
            _add_to_wrong_questions(conn, user_id, question, answer)

    upsert_weak_points(user_id, [question['knowledge_name']], source='practice', correct=is_correct)
    update_study_record(user_id, minutes=3, practice_delta=1, topics=[question['knowledge_name']])
    try:
        from services.knowledge_memory_service import auto_capture_from_interaction

        auto_capture_from_interaction(user_id, interaction)
    except Exception:
        current_app.logger.exception('Auto-capture from practice submission failed')

    return jsonify({'data': {'correct': is_correct, 'explanation': question['explanation'], 'nextQuestion': None}})


@bp.get('/report')
@login_required
def report():
    user_id = current_user_id()
    with transaction() as conn:
        rows = rows_to_dicts(
            conn.execute(
                "SELECT * FROM practice_submissions WHERE user_id = ? AND date(created_at) = date('now')",
                (user_id,),
            ).fetchall()
        )
        weak = rows_to_dicts(
            conn.execute(
                """
                SELECT * FROM weak_points
                WHERE user_id = ?
                  AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
                ORDER BY mastery_score ASC LIMIT 5
                """,
                (user_id,),
            ).fetchall()
        )
    total = len(rows)
    correct = sum(1 for row in rows if row['is_correct'])
    return jsonify(
        {
            'data': {
                'date': today(),
                'totalQuestions': total,
                'correctCount': correct,
                'wrongCount': total - correct,
                'fuzzyCount': sum(1 for row in rows if row.get('feeling') == 'fuzzy'),
                'score': round((correct / total) * 100, 1) if total else 0,
                'topWeakPoints': [normalize_weak_point(item) for item in weak],
                'suggestedReview': [normalize_weak_point(item) for item in weak[:3]],
            }
        }
    )


@bp.post('/extra')
@login_required
def generate_extra():
    """
    用户完成每日任务后，生成额外的练习题
    """
    user_id = current_user_id()
    data = request.get_json() or {}
    extra_count = min(20, max(1, data.get('count', 5)))  # 限制1-20题

    with transaction() as conn:
        # 获取今天已做过的题目对应的知识点
        done_today = rows_to_dicts(
            conn.execute(
                """
                SELECT DISTINCT pq.knowledge_name
                FROM practice_submissions ps
                JOIN practice_questions pq ON ps.question_id = pq.id
                WHERE ps.user_id = ? AND date(ps.created_at) = date('now')
                """,
                (user_id,),
            ).fetchall()
        )
        done_knowledge = {row['knowledge_name'] for row in done_today}

        # 优先选择今天答错的知识点
        wrong_today = rows_to_dicts(
            conn.execute(
                """
                SELECT DISTINCT pq.knowledge_name, wp.mastery_score
                FROM practice_submissions ps
                JOIN practice_questions pq ON ps.question_id = pq.id
                LEFT JOIN weak_points wp ON wp.user_id = ? AND wp.knowledge_name = pq.knowledge_name
                WHERE ps.user_id = ? AND ps.is_correct = 0 AND date(ps.created_at) = date('now')
                ORDER BY wp.mastery_score ASC
                """,
                (user_id, user_id),
            ).fetchall()
        )

        # 获取其他薄弱点
        other_weak = rows_to_dicts(
            conn.execute(
                """
                SELECT * FROM weak_points
                WHERE user_id = ? AND ignored = 0
                  AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
                ORDER BY mastery_score ASC LIMIT 50
                """,
                (user_id,),
            ).fetchall()
        )

    # 组合薄弱点：优先今天答错的，然后是其他薄弱点
    selected_weak_points = []
    seen_knowledge = set()

    # 先加入今天答错的
    for row in wrong_today:
        knowledge = row['knowledge_name']
        if knowledge not in seen_knowledge:
            # 找到对应的完整薄弱点记录
            matching = [wp for wp in other_weak if wp['knowledge_name'] == knowledge]
            if matching:
                selected_weak_points.append(matching[0])
                seen_knowledge.add(knowledge)
            if len(selected_weak_points) >= extra_count:
                break

    # 再加入其他薄弱点
    for wp in other_weak:
        if len(selected_weak_points) >= extra_count:
            break
        knowledge = wp['knowledge_name']
        if knowledge not in seen_knowledge:
            selected_weak_points.append(wp)
            seen_knowledge.add(knowledge)

    if not selected_weak_points:
        return jsonify({'data': {'questions': [], 'reason': '暂无可用的薄弱点生成额外练习'}}), 200

    # 如果薄弱点不够，循环使用
    if len(selected_weak_points) < extra_count:
        cycle_count = extra_count // len(selected_weak_points)
        remainder = extra_count % len(selected_weak_points)
        selected_weak_points = selected_weak_points * cycle_count + selected_weak_points[:remainder]

    try:
        questions = build_practice_questions(user_id, selected_weak_points[:extra_count])
        return jsonify({'data': {'questions': [normalize_question(q) for q in questions]}})
    except Exception as e:
        print(f'[ERROR] Failed to generate extra questions: {e}')
        import traceback
        traceback.print_exc()
        return jsonify({'message': '生成额外练习失败，请稍后重试', 'code': 'GENERATION_FAILED'}), 500
