from datetime import date

from database import json_dumps, rows_to_dicts, transaction
from extensions import scheduler, socketio


def emit_due_review_reminders() -> None:
    with transaction() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT user_id, id, knowledge_name FROM weak_points
                WHERE ignored = 0 AND next_review_at IS NOT NULL AND date(next_review_at) <= date('now')
                LIMIT 100
                """
            ).fetchall()
        )
    for row in rows:
        socketio.emit(
            'review_reminder',
            {
                'weakPointId': row['id'],
                'knowledgeName': row['knowledge_name'],
                'message': f'该复习「{row["knowledge_name"]}」了。',
            },
            room=f'user:{row["user_id"]}',
            namespace='/ws',
        )


def auto_generate_daily_practice_tasks() -> None:
    """
    每天凌晨2点自动为所有活跃用户生成当日练习任务
    """
    from services.learning_service import (
        build_practice_questions,
        calculate_daily_question_count,
        new_id,
    )

    today_str = date.today().isoformat()

    with transaction() as conn:
        # 获取最近7天有学习记录的活跃用户
        active_users = rows_to_dicts(
            conn.execute(
                """
                SELECT DISTINCT user_id FROM study_records
                WHERE date >= date('now', '-7 days')
                """
            ).fetchall()
        )

    print(f"[AUTO-TASK] Starting daily task generation for {len(active_users)} active users")

    for user_row in active_users:
        user_id = user_row['user_id']
        try:
            # 检查今天是否已有任务
            with transaction() as conn:
                existing = conn.execute(
                    'SELECT id FROM daily_practice_tasks WHERE user_id = ? AND date = ?',
                    (user_id, today_str),
                ).fetchone()

            if existing:
                print(f"[AUTO-TASK] User {user_id} already has task for today, skipping")
                continue

            # 智能计算题目数量
            target_count = calculate_daily_question_count(user_id)

            # 获取薄弱点
            with transaction() as conn:
                weak_points = rows_to_dicts(
                    conn.execute(
                        """
                        SELECT * FROM weak_points
                        WHERE user_id = ? AND ignored = 0
                          AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
                        ORDER BY mastery_score ASC LIMIT 100
                        """,
                        (user_id,),
                    ).fetchall()
                )

            if not weak_points:
                print(f"[AUTO-TASK] User {user_id} has no weak points, skipping")
                continue

            # 去重并选择薄弱点
            unique_weak_points = []
            seen_knowledge_names = set()
            for wp in weak_points:
                knowledge_name = str(wp.get('knowledge_name') or '').strip()
                if not knowledge_name or knowledge_name in seen_knowledge_names:
                    continue
                unique_weak_points.append(wp)
                seen_knowledge_names.add(knowledge_name)
                if len(unique_weak_points) >= target_count:
                    break

            if len(unique_weak_points) < target_count and len(unique_weak_points) > 0:
                cycle_count = target_count // len(unique_weak_points)
                remainder = target_count % len(unique_weak_points)
                expanded_weak_points = unique_weak_points * cycle_count + unique_weak_points[:remainder]
                unique_weak_points = expanded_weak_points

            # 生成题目
            questions = build_practice_questions(user_id, unique_weak_points)

            # 保存任务
            task_id = new_id()
            question_ids = [q['id'] for q in questions]
            with transaction() as conn:
                conn.execute(
                    """
                    INSERT INTO daily_practice_tasks (id, user_id, date, target_count, completed_count, question_ids)
                    VALUES (?, ?, ?, ?, 0, ?)
                    """,
                    (task_id, user_id, today_str, target_count, json_dumps(question_ids)),
                )

            print(f"[AUTO-TASK] Generated {len(questions)} questions for user {user_id}")

            # 发送通知
            socketio.emit(
                'daily_task_ready',
                {
                    'date': today_str,
                    'questionCount': len(questions),
                    'message': f'今日练习已准备好，共 {len(questions)} 道题目',
                },
                room=f'user:{user_id}',
                namespace='/ws',
            )

        except Exception as e:
            print(f"[AUTO-TASK] Failed to generate task for user {user_id}: {e}")
            import traceback
            traceback.print_exc()

    print(f"[AUTO-TASK] Daily task generation completed")


def auto_generate_weekly_practice() -> None:
    """
    每周日自动为所有活跃用户生成10道专项练习
    """
    from services.learning_service import new_id
    from services.ai_service import chat_completion_json
    from services.user_profile_service import get_user_profile_context
    import config

    with transaction() as conn:
        # 获取最近14天有学习记录的活跃用户
        active_users = rows_to_dicts(
            conn.execute(
                """
                SELECT DISTINCT user_id FROM study_records
                WHERE date >= date('now', '-14 days')
                """
            ).fetchall()
        )

    print(f"[WEEKLY-PRACTICE] Starting weekly practice generation for {len(active_users)} active users")

    for user_row in active_users:
        user_id = user_row['user_id']
        try:
            # 获取用户的错题，优先选择最近的、掌握度低的
            with transaction() as conn:
                rows = conn.execute(
                    '''SELECT id, question_text, options, subject, difficulty, error_type,
                              knowledge_points, correct_answer, mastery_level
                       FROM wrong_questions
                       WHERE user_id = ? AND status != 'archived'
                       ORDER BY mastery_level ASC, created_at DESC
                       LIMIT 10''',
                    (user_id,)
                ).fetchall()

            if not rows:
                print(f"[WEEKLY-PRACTICE] User {user_id} has no wrong questions, skipping")
                continue

            # 提取知识点和错误类型
            from database import json_loads
            knowledge_points = []
            error_types = []
            subjects = []
            for row in rows:
                kps = json_loads(row['knowledge_points'], [])
                knowledge_points.extend(kps)
                if row['error_type']:
                    error_types.append(row['error_type'])
                if row['subject']:
                    subjects.append(row['subject'])

            knowledge_points = list(set(knowledge_points))[:5]
            error_types = list(set(error_types))[:3]
            subjects = list(set(subjects))

            profile_context = get_user_profile_context(user_id)

            # AI生成专项练习题
            messages = [
                {'role': 'user', 'content': profile_context} if profile_context else None,
                {
                    'role': 'user',
                    'content': f'''请根据学生的错题情况，生成10道针对性的练习题。

学生的薄弱知识点：{', '.join(knowledge_points) if knowledge_points else '无'}
常见错误类型：{', '.join(error_types) if error_types else '无'}
科目：{', '.join(subjects) if subjects else '数学'}

要求：
1. 题目要针对学生的薄弱点，难度适中
2. 每道题必须是选择题，有4个选项（A、B、C、D）
3. 题目要有区分度，能检验学生是否真正掌握了知识点
4. 返回JSON格式

{{
  "questions": [
    {{
      "questionText": "题目内容",
      "options": ["A. 选项A", "B. 选项B", "C. 选项C", "D. 选项D"],
      "correctAnswer": "A",
      "explanation": "详细解析",
      "knowledgePoints": ["知识点1", "知识点2"],
      "difficulty": "中等"
    }}
  ]
}}

注意：
- questionText只包含题干，不包含选项
- options必须是4个选项的数组，格式为"字母. 内容"
- correctAnswer只写字母（A/B/C/D）
- explanation要详细说明解题思路
- 数学公式使用LaTeX格式：行内用\\(...\\)，块级用\\[...\\]'''
                }
            ]
            messages = [m for m in messages if m]

            ai_response = chat_completion_json(messages, temperature=0.7, user_id=user_id)
            questions = ai_response.get('questions', [])

            if not questions:
                print(f"[WEEKLY-PRACTICE] Failed to generate questions for user {user_id}")
                continue

            # 保存到数据库
            from datetime import datetime
            with transaction() as conn:
                for q in questions:
                    q_id = new_id()
                    conn.execute(
                        '''INSERT INTO practice_questions
                           (id, user_id, knowledge_name, question_text, choices, correct_answer, explanation, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                        (
                            q_id,
                            user_id,
                            ', '.join(q.get('knowledgePoints', [])),
                            q.get('questionText', ''),
                            json_dumps(q.get('options', [])),
                            q.get('correctAnswer', ''),
                            q.get('explanation', ''),
                            datetime.now().isoformat()
                        )
                    )

            print(f"[WEEKLY-PRACTICE] Generated {len(questions)} questions for user {user_id}")

            # 发送通知
            socketio.emit(
                'weekly_practice_ready',
                {
                    'questionCount': len(questions),
                    'message': f'本周专项练习已准备好，共 {len(questions)} 道题目',
                },
                room=f'user:{user_id}',
                namespace='/ws',
            )

        except Exception as e:
            print(f"[WEEKLY-PRACTICE] Failed to generate practice for user {user_id}: {e}")
            import traceback
            traceback.print_exc()

    print(f"[WEEKLY-PRACTICE] Weekly practice generation completed")


def emit_due_knowledge_reviews() -> None:
    """Emit WebSocket notifications for users with due knowledge memory reviews."""
    today_str = date.today().isoformat()
    with transaction() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT user_id, COUNT(*) as due_count FROM knowledge_memories
                WHERE archived = 0 AND next_review_at IS NOT NULL AND next_review_at <= ?
                GROUP BY user_id
                LIMIT 50
                """,
                (today_str,),
            ).fetchall()
        )
    for row in rows:
        socketio.emit(
            'knowledge_review_due',
            {
                'dueCount': row['due_count'],
                'message': f'你有 {row["due_count"]} 条知识记忆需要复习',
            },
            room=f'user:{row["user_id"]}',
            namespace='/ws',
        )


def auto_consolidate_memories() -> None:
    """Weekly job: auto-consolidate knowledge memories for active users."""
    with transaction() as conn:
        active_users = rows_to_dicts(
            conn.execute(
                """
                SELECT DISTINCT user_id FROM knowledge_memories
                WHERE archived = 0 AND is_consolidated = 0
                GROUP BY user_id HAVING COUNT(*) >= 5
                LIMIT 20
                """
            ).fetchall()
        )

    print(f"[AUTO-CONSOLIDATE] Checking {len(active_users)} users for memory consolidation")

    for user_row in active_users:
        user_id = user_row['user_id']
        try:
            from services.knowledge_memory_service import find_consolidation_candidates, consolidate_memories

            candidates = find_consolidation_candidates(user_id, top_k=10)
            for pair in candidates[:2]:  # Auto-merge at most 2 pairs per run
                m1_id = pair['memory1']['id']
                m2_id = pair['memory2']['id']
                result = consolidate_memories(user_id, [m1_id, m2_id])
                if result:
                    print(f"[AUTO-CONSOLIDATE] Merged {m1_id[:8]}+{m2_id[:8]} for user {user_id}")
        except Exception as e:
            print(f"[AUTO-CONSOLIDATE] Failed for user {user_id}: {e}")


def register_jobs() -> None:
    if scheduler.get_job('review-reminders'):
        return
    scheduler.add_job(emit_due_review_reminders, 'interval', minutes=30, id='review-reminders')

    # 每3小时检查知识记忆复习提醒
    scheduler.add_job(
        emit_due_knowledge_reviews, 'interval', hours=3, id='knowledge-review-reminders'
    )

    # 每周日凌晨3点自动整合知识记忆
    scheduler.add_job(
        auto_consolidate_memories,
        'cron',
        day_of_week='sun',
        hour=3,
        minute=7,
        id='auto-consolidate-memories',
    )

    # 每周日上午9点自动生成专项练习
    scheduler.add_job(
        auto_generate_weekly_practice,
        'cron',
        day_of_week='sun',
        hour=9,
        minute=0,
        id='auto-weekly-practice',
    )
