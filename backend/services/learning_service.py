from __future__ import annotations

import re
from queue import Queue
from threading import Thread
from datetime import date, datetime, timedelta
from typing import Any
from uuid import uuid4

from database import json_dumps, json_loads, row_to_dict, rows_to_dicts, transaction
from extensions import socketio
from services.ai_service import chat_completion_json
from services.vector_service import vector_service


def new_id() -> str:
    return str(uuid4())


def today() -> str:
    return date.today().isoformat()


def ensure_profile(user_id: str) -> dict[str, Any]:
    with transaction() as conn:
        row = conn.execute('SELECT * FROM learning_profile WHERE user_id = ?', (user_id,)).fetchone()
        if row is None:
            conn.execute(
                'INSERT INTO learning_profile (id, user_id, goal, current_stage) VALUES (?, ?, NULL, NULL)',
                (new_id(), user_id),
            )
            row = conn.execute('SELECT * FROM learning_profile WHERE user_id = ?', (user_id,)).fetchone()
    return normalize_profile(row_to_dict(row))


def normalize_profile(profile: dict[str, Any] | None) -> dict[str, Any]:
    if not profile:
        return {}
    return {
        'id': profile['id'],
        'userId': profile['user_id'],
        'goal': profile.get('goal'),
        'currentStage': profile.get('current_stage'),
        'selfIntroduction': profile.get('self_introduction'),
        'learningPreferences': profile.get('learning_preferences'),
        'totalStudyHours': profile.get('total_study_hours') or 0,
        'streakDays': profile.get('streak_days') or 0,
        'lastStudyAt': profile.get('last_study_at'),
        'weeklyStudyHoursTarget': profile.get('weekly_study_hours_target') or 30,
        'dailyPracticeCountTarget': profile.get('daily_practice_count_target') or 20,
        'emotionEnabled': bool(profile.get('emotion_enabled')),
        'createdAt': profile.get('created_at'),
        'updatedAt': profile.get('updated_at'),
    }


def normalize_weak_point(item: dict[str, Any] | None) -> dict[str, Any]:
    if not item:
        return {}
    score = float(item.get('mastery_score') or 0)
    priority = 'high' if score < 40 else 'medium' if score < 70 else 'low'
    return {
        'id': item['id'],
        'userId': item['user_id'],
        'knowledgeName': item['knowledge_name'],
        'masteryScore': round(score, 1),
        'errorCount': item.get('error_count') or 0,
        'correctCount': item.get('correct_count') or 0,
        'priority': priority,
        'lastPracticedAt': item.get('last_practiced_at'),
        'nextReviewAt': item.get('next_review_at'),
        'reviewInterval': item.get('review_interval') or 1,
        'source': item.get('source') or 'qa',
        'ignored': bool(item.get('ignored')),
        'createdAt': item.get('created_at'),
        'updatedAt': item.get('updated_at'),
    }


def extract_knowledge(text: str) -> list[str]:
    known_topics = [
        '泰勒展开',
        '极限计算',
        '洛必达法则',
        '多元函数积分',
        '概率分布',
        '线性代数',
        '导数',
        '积分',
        '函数',
        '证明方法',
        '英语阅读',
        '论文摘要',
        '写作逻辑',
    ]
    found = [topic for topic in known_topics if topic in text]
    if found:
        return found[:4]

    words = re.findall(r'[\u4e00-\u9fff]{2,10}', text)
    stop_words = {
        '什么',
        '这个',
        '这段',
        '内容',
        '核心',
        '是什么',
        '核心是什么',
        '这段内容',
        '这段内容的',
        '请解释',
        '请说明',
        '为什么',
        '怎么做',
        '可以',
        '需要',
        '学习',
        '知识点',
        '答案',
        '材料',
        '文件',
        '上传',
        '入学申请表',
        '申请表格',
        '表格',
        '问题',
        '用户',
        '系统',
    }
    cleaned: list[str] = []
    for word in words:
        if word in stop_words:
            continue
        if any(stop in word for stop in ['这段内容', '是什么', '请问', '问题']):
            continue
        if len(word) < 2:
            continue
        cleaned.append(word)
    return list(dict.fromkeys(cleaned))[:3]


NON_LEARNING_PATTERNS = [
    '你是谁',
    '你叫什么',
    '介绍一下你',
    'hello',
    'hi',
    '你好',
    '在吗',
    '谢谢',
]

WEAKNESS_PATTERNS = [
    '不会',
    '不懂',
    '没懂',
    '看不懂',
    '错了',
    '答错',
    '为什么错',
    '哪里错',
    '薄弱',
    '卡住',
    '搞不清',
    '分不清',
    '记不住',
]


def is_non_learning_input(text: str) -> bool:
    normalized = re.sub(r'\s+', '', (text or '').lower())
    if not normalized:
        return True
    if len(normalized) <= 12 and any(pattern in normalized for pattern in NON_LEARNING_PATTERNS):
        return True
    return False


def has_weakness_evidence(text: str, source_type: str) -> bool:
    if source_type in {'practice', 'feynman'}:
        return True
    normalized = re.sub(r'\s+', '', text or '')
    return any(pattern in normalized for pattern in WEAKNESS_PATTERNS)


def normalize_topic_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    cleaned: list[str] = []
    blocked = {'什么', '你是谁', '问题', '内容', '核心', '学习', '用户', '助手'}
    for value in values:
        topic = str(value).strip(' ：:，,。.?？')
        if len(topic) < 2 or topic in blocked:
            continue
        if any(noise in topic for noise in ['你是谁', '这段内容', '核心是什么']):
            continue
        cleaned.append(topic[:24])
    return list(dict.fromkeys(cleaned))[:5]


def analyze_learning_interaction(
    source_type: str,
    user_input: str,
    ai_response: str,
    suggested_knowledge: list[str] | None = None,
) -> dict[str, Any]:
    suggested_knowledge = normalize_topic_list(suggested_knowledge or extract_knowledge(f'{user_input}\n{ai_response}'))
    if is_non_learning_input(user_input):
        return {
            'isLearning': False,
            'summary': '非学习对话：未写入学习记录',
            'knowledgePoints': [],
            'weakPointCandidates': [],
            'weaknessEvidence': False,
        }

    fallback = {
        'isLearning': bool(suggested_knowledge or source_type != 'qa'),
        'summary': summarize_interaction(source_type, user_input, suggested_knowledge),
        'knowledgePoints': suggested_knowledge,
        'weakPointCandidates': suggested_knowledge if has_weakness_evidence(user_input, source_type) else [],
        'weaknessEvidence': has_weakness_evidence(user_input, source_type),
    }

    prompt = f"""
请分析这次用户行为是否应该进入学习档案，并提炼学习摘要。
要求：
1. 闲聊、身份询问、问候、纯操作性问题不算学习行为。
2. “函数是什么”这类普通概念提问可以算最近学习，但不能直接算薄弱点。
3. 只有用户明确表示不会/不懂/答错/卡住，或练习、费曼解释暴露错误时，才给 weakPointCandidates。
4. summary 用一句中文概括学习动作，不要复述原问题，格式类似“即时问答：了解函数的基本概念”。

sourceType: {source_type}
userInput: {user_input[:1200]}
aiResponseSummary: {ai_response[:1200]}
suggestedKnowledge: {json_dumps(suggested_knowledge)}

只返回 JSON：
{{
  "isLearning": true,
  "summary": "一句话摘要",
  "knowledgePoints": ["知识点"],
  "weaknessEvidence": false,
  "weakPointCandidates": []
}}
"""
    try:
        analysis = chat_completion_json([{'role': 'user', 'content': prompt}], fallback=fallback, temperature=0.2)
    except Exception:
        analysis = fallback

    knowledge = normalize_topic_list(analysis.get('knowledgePoints')) or suggested_knowledge
    weak_points = normalize_topic_list(analysis.get('weakPointCandidates'))
    return {
        'isLearning': bool(analysis.get('isLearning')) and bool(knowledge or source_type != 'qa'),
        'summary': str(analysis.get('summary') or fallback['summary']).strip()[:120],
        'knowledgePoints': knowledge,
        'weakPointCandidates': weak_points,
        'weaknessEvidence': bool(analysis.get('weaknessEvidence')) and bool(weak_points),
    }


def summarize_interaction(source_type: str, user_input: str, knowledge: list[str]) -> str:
    labels = {
        'qa': '即时问答',
        'textbook': '教材对话',
        'paper': '论文解读',
        'practice': '主动回忆',
        'calendar': '学习计时',
        'feynman': '费曼学习',
        'learning_path': '学习路径',
        'knowledge_graph': '知识图谱',
    }
    label = labels.get(source_type, source_type)
    topic = '、'.join(knowledge[:3]) if knowledge else user_input.strip()[:30]
    return f'{label}：{topic}'


def update_study_record(
    user_id: str,
    minutes: int = 5,
    practice_delta: int = 0,
    topics: list[str] | None = None,
    seconds: int | None = None,
) -> None:
    topics = topics or []
    total_seconds = max(0, int(seconds if seconds is not None else minutes * 60))
    whole_minutes = total_seconds // 60
    with transaction() as conn:
        existing = conn.execute(
            'SELECT * FROM study_records WHERE user_id = ? AND date = ?',
            (user_id, today()),
        ).fetchone()
        if existing:
            current_topics = json_loads(existing['topics_studied'], [])
            merged = list(dict.fromkeys(current_topics + topics))
            conn.execute(
                """
                UPDATE study_records
                SET study_minutes = study_minutes + ?,
                    study_seconds = study_seconds + ?,
                    practice_count = practice_count + ?,
                    topics_studied = ?,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (whole_minutes, total_seconds, practice_delta, json_dumps(merged), existing['id']),
            )
        else:
            conn.execute(
                """
                INSERT INTO study_records (id, user_id, date, study_minutes, study_seconds, practice_count, topics_studied)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (new_id(), user_id, today(), whole_minutes, total_seconds, practice_delta, json_dumps(topics)),
            )
        conn.execute(
            """
            UPDATE learning_profile
            SET total_study_hours = total_study_hours + ?,
                streak_days = CASE
                    WHEN last_study_at IS NULL OR date(last_study_at) < date('now') THEN streak_days + 1
                    ELSE streak_days
                END,
                last_study_at = datetime('now'),
                updated_at = datetime('now')
            WHERE user_id = ?
            """,
            (total_seconds / 3600, user_id),
        )


def log_interaction(
    user_id: str,
    source_type: str,
    user_input: str,
    ai_response: str = '',
    source_id: str | None = None,
    knowledge_points: list[str] | None = None,
    should_update_weak_points: bool = True,
) -> dict[str, Any]:
    ensure_profile(user_id)
    analysis = analyze_learning_interaction(source_type, user_input, ai_response, knowledge_points)
    knowledge = analysis['knowledgePoints']
    interaction_id = new_id()
    summary = analysis['summary']
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO interaction_logs
            (id, user_id, source_type, source_id, user_input, ai_response, extracted_knowledge, summary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (interaction_id, user_id, source_type, source_id, user_input, ai_response, json_dumps(knowledge), summary),
        )
    vector_service.add_interaction(
        interaction_id,
        user_input,
        {
            'user_id': user_id,
            'source_type': source_type,
            'knowledge_points': ','.join(knowledge),
            'created_at': datetime.now().isoformat(timespec='seconds'),
        },
    )
    if analysis['isLearning']:
        if should_update_weak_points and analysis['weaknessEvidence']:
            upsert_weak_points(user_id, analysis['weakPointCandidates'], source=source_type, correct=False)
        update_study_record(user_id, topics=knowledge)
        emit_profile_update(user_id)

        # Auto-capture knowledge from this interaction (best-effort, async)
        _try_auto_capture(user_id, {
            'id': interaction_id,
            'source_type': source_type,
            'user_input': user_input,
            'ai_response': ai_response,
        })

    return {
        'id': interaction_id,
        'isLearning': analysis['isLearning'],
        'summary': summary,
        'knowledgePoints': knowledge,
        'weakPointCandidates': analysis['weakPointCandidates'],
    }


def _try_auto_capture(user_id: str, interaction: dict[str, Any]) -> None:
    """Fire-and-forget auto-capture in a daemon thread."""
    try:
        from services.knowledge_memory_service import auto_capture_from_interaction
        Thread(
            target=lambda: auto_capture_from_interaction(user_id, interaction),
            daemon=True,
        ).start()
    except Exception:
        pass  # best-effort; never block the main response


def upsert_weak_points(
    user_id: str,
    knowledge_points: list[str],
    source: str = 'qa',
    correct: bool | None = None,
) -> None:
    filtered = [point for point in dict.fromkeys(knowledge_points) if point and len(point) >= 2 and point not in {'什么', '这段内容', '核心是什么'}]
    if not filtered:
        return

    # 根据答题结果调整掌握度分数
    # 答对：+15分，答错：-20分
    delta = 0 if correct is None else (15 if correct else -20)
    review_days = 3 if correct else 1
    next_review = (date.today() + timedelta(days=review_days)).isoformat()

    with transaction() as conn:
        for knowledge in filtered:
            row = conn.execute(
                'SELECT * FROM weak_points WHERE user_id = ? AND knowledge_name = ?',
                (user_id, knowledge),
            ).fetchone()
            if row:
                new_score = max(0, min(100, float(row['mastery_score']) + delta))
                new_correct_count = row['correct_count'] + (1 if correct is True else 0)
                new_error_count = row['error_count'] + (1 if correct is False else 0)

                # 自动删除薄弱点的条件：
                # 1. 掌握度达到80分以上
                # 2. 连续答对5题（最近5次答题中没有答错）
                # 3. 总答对题数 >= 5
                should_remove = (
                    new_score >= 80
                    and new_correct_count >= 5
                    and new_error_count == 0
                )

                if should_remove:
                    print(f"[AUTO-CLEANUP] Removing mastered weak point: {knowledge} (score: {new_score}, correct: {new_correct_count})")
                    conn.execute('DELETE FROM weak_points WHERE id = ?', (row['id'],))
                    # Sync mastered weak point → knowledge memory
                    try:
                        from services.knowledge_memory_service import sync_from_weak_point
                        sync_from_weak_point(user_id, knowledge, new_score)
                    except Exception:
                        pass
                else:
                    # 如果答错了，重置连续答对计数（通过将 error_count 设为非0来标记）
                    conn.execute(
                        """
                        UPDATE weak_points
                        SET mastery_score = ?,
                            error_count = ?,
                            correct_count = ?,
                            last_practiced_at = datetime('now'),
                            next_review_at = ?,
                            review_interval = ?,
                            source = ?,
                            updated_at = datetime('now')
                        WHERE id = ?
                        """,
                        (
                            new_score,
                            new_error_count,
                            new_correct_count,
                            next_review,
                            review_days,
                            source,
                            row['id'],
                        ),
                    )
            else:
                conn.execute(
                    """
                    INSERT INTO weak_points
                    (id, user_id, knowledge_name, mastery_score, error_count, correct_count, next_review_at, review_interval, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_id(),
                        user_id,
                        knowledge,
                        35 if correct is False else 55,
                        1 if correct is False else 0,
                        1 if correct is True else 0,
                        next_review,
                        review_days,
                        source,
                    ),
                )


def emit_profile_update(user_id: str) -> None:
    with transaction() as conn:
        weak_points = rows_to_dicts(
            conn.execute(
                """
                SELECT * FROM weak_points
                WHERE user_id = ? AND ignored = 0
                  AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
                ORDER BY mastery_score ASC LIMIT 8
                """,
                (user_id,),
            ).fetchall()
        )
        profile = row_to_dict(conn.execute('SELECT * FROM learning_profile WHERE user_id = ?', (user_id,)).fetchone())
    socketio.emit(
        'profile_updated',
        {
            'weakPoints': [normalize_weak_point(item) for item in weak_points],
            'todayStudyMinutes': get_today_minutes(user_id),
            'streakDays': profile.get('streak_days') if profile else 0,
        },
        room=f'user:{user_id}',
        namespace='/ws',
    )


def get_today_minutes(user_id: str) -> int:
    with transaction() as conn:
        row = conn.execute(
            'SELECT study_minutes FROM study_records WHERE user_id = ? AND date = ?',
            (user_id, today()),
        ).fetchone()
    return int(row['study_minutes']) if row else 0


def get_recent_practice_context(user_id: str, weak_point: dict[str, Any]) -> list[str]:
    knowledge = weak_point['knowledge_name']
    with transaction() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT source_type, user_input, summary
                FROM interaction_logs
                WHERE user_id = ?
                  AND (
                    extracted_knowledge LIKE ?
                    OR user_input LIKE ?
                    OR ai_response LIKE ?
                  )
                ORDER BY created_at DESC
                LIMIT 3
                """,
                (user_id, f'%{knowledge}%', f'%{knowledge}%', f'%{knowledge}%'),
            ).fetchall()
        )
    return [
        f"{row.get('source_type')}: {str(row.get('summary') or row.get('user_input') or '').strip()[:50]}"
        for row in rows
        if str(row.get('summary') or row.get('user_input') or '').strip()
    ]


def is_meta_practice_template(question_text: str, choices: list[dict[str, str]]) -> bool:
    normalized_question = re.sub(r'\s+', '', question_text or '')
    normalized_choices = re.sub(r'\s+', '', ' '.join(item.get('text') or '' for item in choices))
    combined = normalized_question + normalized_choices
    blocked_signals = [
        '复习方式',
        '自查问题',
        '看过这一页',
        '抄写三遍',
        '只看答案',
        '直接下一题',
        '是否真正理解',
    ]
    return any(signal in combined for signal in blocked_signals)


def normalize_generated_choices(raw_choices: Any) -> list[dict[str, str]]:
    if not isinstance(raw_choices, list):
        return []
    normalized: list[dict[str, str]] = []
    default_keys = ['A', 'B', 'C', 'D']
    for index, item in enumerate(raw_choices[:4]):
        if isinstance(item, dict):
            text = str(item.get('text') or '').strip()
            key = str(item.get('key') or default_keys[index]).strip().upper()[:1] or default_keys[index]
        else:
            text = str(item).strip()
            key = default_keys[index]
        if text:
            normalized.append({'key': key, 'text': text[:80]})
    return normalized


def build_generated_question(question_id: str, weak_point: dict[str, Any], generated: dict[str, Any]) -> dict[str, Any] | None:
    from services.geometry_service import normalize_diagram_svg, render_canonical_geometry_svg, looks_like_geometry_question

    choices = normalize_generated_choices(generated.get('choices'))
    correct_answer = str(generated.get('correctAnswer') or '').strip().upper()[:1]
    question_text = str(generated.get('questionText') or '').strip()[:220]
    hint = str(generated.get('hint') or '').strip()[:120]
    explanation = str(generated.get('explanation') or '').strip()[:220]
    valid_keys = {item['key'] for item in choices}
    if len(choices) != 4 or correct_answer not in valid_keys or not question_text:
        return None
    if is_meta_practice_template(question_text, choices):
        return None

    diagram_svg = ''
    if looks_like_geometry_question(question_text):
        diagram_svg = render_canonical_geometry_svg(question_text)
        if not diagram_svg:
            ai_svg = normalize_diagram_svg(generated.get('diagramSvg', ''))
            if ai_svg:
                diagram_svg = ai_svg

    return {
        'id': question_id,
        'weakPointId': weak_point['id'],
        'knowledgeName': weak_point['knowledge_name'],
        'questionText': question_text,
        'choices': choices,
        'correctAnswer': correct_answer,
        'hint': hint,
        'explanation': explanation,
        'bloomLevel': weak_point.get('bloom_level'),
        'desirableDifficulty': weak_point.get('desired_difficulty'),
        'adaptiveReason': weak_point.get('adaptive_reason'),
        'sourceType': weak_point.get('source_type') or weak_point.get('source'),
        'diagramSvg': diagram_svg,
    }


def fallback_practice_question(question_id: str, weak_point: dict[str, Any]) -> dict[str, Any]:
    knowledge = str(weak_point.get('knowledge_name') or '这个知识点').strip()
    return {
        'id': question_id,
        'weakPointId': weak_point.get('id'),
        'knowledgeName': knowledge,
        'questionText': f'关于{knowledge}，下面哪一项最能体现它的核心理解？',
        'choices': [
            {'key': 'A', 'text': f'能说清{knowledge}的定义、适用条件和一个例子'},
            {'key': 'B', 'text': '只记住题目答案，不理解步骤来源'},
            {'key': 'C', 'text': '遇到相似题时完全依赖提示'},
            {'key': 'D', 'text': '跳过概念，只机械套用公式'},
        ],
        'correctAnswer': 'A',
        'hint': f'先想{knowledge}解决什么问题，再想什么时候可以用。',
        'explanation': f'真正掌握{knowledge}，需要能解释定义、条件，并迁移到新例子中。',
        'bloomLevel': weak_point.get('bloom_level') or '理解',
        'desirableDifficulty': weak_point.get('desired_difficulty') or '基础巩固',
        'adaptiveReason': weak_point.get('adaptive_reason') or f'{knowledge} 是当前需要巩固的薄弱点。',
        'sourceType': weak_point.get('source_type') or weak_point.get('source'),
    }


def build_practice_question(user_id: str, weak_point: dict[str, Any], seed: str = '') -> dict[str, Any]:
    question_id = new_id()
    knowledge = weak_point['knowledge_name']
    recent_context = get_recent_practice_context(user_id, weak_point)
    bloom_level = weak_point.get('bloom_level') or '理解'
    desired_difficulty = weak_point.get('desired_difficulty') or '基础巩固'
    adaptive_reason = weak_point.get('adaptive_reason') or f'{knowledge} 是当前需要巩固的薄弱点。'
    wrong_context = weak_point.get('wrong_context') or []
    question_kind = {
        '记忆': 'concept',
        '理解': 'concept',
        '应用': 'transfer',
        '分析': 'misconception',
        '评价': 'misconception',
        '创造': 'transfer',
    }.get(bloom_level, 'transfer')

    prompt = f"""
Generate exactly one multiple-choice adaptive exam question in Chinese based on the user's weak point and wrong-question history.

Requirements:
1. Base the question on the weak point `{knowledge}`.
2. Use `recent_context` to understand what the learner recently struggled with and create a targeted question.
3. Follow Bloom's taxonomy level `{bloom_level}`:
   - 记忆: recall definitions, formulas, or conditions
   - 理解: explain meaning, identify examples, compare conditions
   - 应用: solve a concrete exercise using the concept
   - 分析: diagnose an error, compare methods, or separate conditions
   - 评价: choose the best method and justify constraints
   - 创造: combine concepts in a new but concise scenario
4. Apply desirable difficulty `{desired_difficulty}`:
   - 基础巩固: direct and confidence-building
   - 轻微变化: change surface features from previous wrong questions
   - 交错迁移: mix this weak point with a nearby concept
   - 错因辨析: include a distractor that matches a previous mistake
5. `kind` can be:
   - concept: ask for core definition, condition, or meaning
   - misconception: test a common mistake or confusing point
   - transfer: give a short calculational or applied example
6. Make the question feel like a real exam item, not a generic template.
7. Return exactly 4 concise options with exactly 1 correct answer.
8. Keep `hint` and `explanation` short, practical, and in Chinese.
9. For math expressions, wrap them in $...$ for inline LaTeX or $$...$$ for block LaTeX (e.g., $\\sqrt{{2}}$, $x^2$, $\\frac{{1}}{{2}}$, $$\\int_0^1 x dx$$).
10. IMPORTANT: Do NOT use template phrases like "复习方式", "自查问题", "看过这一页", "抄写三遍", "直接下一题". Create real subject-specific questions.
11. If this is a geometry question (involving triangles, quadrilaterals, circles, points, line segments, or angles), you MUST include a complete inline SVG diagram in `diagramSvg`. The SVG must:
    - Have a white/cream background (fill="#fffaf0")
    - Use dark grey strokes (#3f3f46) with 2-3px width
    - Clearly label ALL points mentioned in the question (A, B, C, D, etc.)
    - Only draw points, segments, and angles that appear in the question — do not add extra elements
    - Set a reasonable viewBox (e.g., "0 0 320 240")
    - Be a complete `<svg>...</svg>` string, NOT wrapped in markdown code blocks
    - NOT contain any <script> tags or event handlers
    If this is NOT a geometry question, set `diagramSvg` to an empty string "".
12. Return valid JSON only.

knowledge: {knowledge}
kind: {question_kind}
bloom_level: {bloom_level}
desirable_difficulty: {desired_difficulty}
adaptive_reason: {adaptive_reason}
recent_context: {json_dumps(recent_context)}
wrong_question_context: {json_dumps(wrong_context)}

Return format:
{{
  "questionText": "question in Chinese (use $...$ or $$...$$ for math)",
  "choices": [
    {{"key": "A", "text": "choice A (use $...$ for math)"}},
    {{"key": "B", "text": "choice B"}},
    {{"key": "C", "text": "choice C"}},
    {{"key": "D", "text": "choice D"}}
  ],
  "correctAnswer": "A",
  "hint": "hint in Chinese (use $...$ for math)",
  "explanation": "explanation in Chinese (use $...$ for math)",
  "diagramSvg": "<svg>...</svg> or empty string"
}}
"""

    generated_queue: Queue = Queue(maxsize=1)

    def _generate() -> None:
        try:
            result = chat_completion_json([{'role': 'user', 'content': prompt}], temperature=0.4, user_id=user_id)
        except Exception as e:
            result = {'error': str(e)}
        try:
            generated_queue.put_nowait(result)
        except Exception:
            pass

    worker = Thread(target=_generate, daemon=True)
    worker.start()
    try:
        generated = generated_queue.get(timeout=45)
    except Exception:
        generated = {}

    if 'error' in generated:
        question = fallback_practice_question(question_id, weak_point)
    else:
        question = build_generated_question(question_id, weak_point, generated)
        if not question:
            question = fallback_practice_question(question_id, weak_point)

    with transaction() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO practice_questions
            (id, user_id, weak_point_id, knowledge_name, question_text, choices, correct_answer, hint, explanation,
             bloom_level, desired_difficulty, adaptive_reason, source_type, diagram_svg)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                question_id,
                user_id,
                weak_point.get('id'),
                knowledge,
                question['questionText'],
                json_dumps(question['choices']),
                question['correctAnswer'],
                question['hint'],
                question['explanation'],
                question.get('bloomLevel'),
                question.get('desirableDifficulty'),
                question.get('adaptiveReason'),
                question.get('sourceType') or 'weak_point',
                question.get('diagramSvg') or '',
            ),
        )
    return question


def build_practice_questions(user_id: str, weak_points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    questions = []
    failed_weak_points = []
    target_count = len(weak_points)

    print(f"[DEBUG] Starting to generate {target_count} questions from {len(set(wp['knowledge_name'] for wp in weak_points))} unique weak points")

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(build_practice_question, user_id, wp, str(idx)): (wp, idx) for idx, wp in enumerate(weak_points)}
        for future in as_completed(futures):
            try:
                questions.append(future.result())
                print(f"[DEBUG] Successfully generated question {len(questions)}/{target_count}")
            except Exception as e:
                weak_point, idx = futures[future]
                failed_weak_points.append((weak_point, idx))
                print(f"[ERROR] Failed to generate question for {weak_point['knowledge_name']} (index {idx}): {e}")
                import traceback
                traceback.print_exc()

    if len(questions) < target_count and failed_weak_points:
        print(f"[DEBUG] Retrying {len(failed_weak_points)} failed weak points...")
        with ThreadPoolExecutor(max_workers=3) as executor:
            retry_futures = {executor.submit(build_practice_question, user_id, wp, f'retry_{idx}'): (wp, idx) for wp, idx in failed_weak_points}
            for future in as_completed(retry_futures):
                try:
                    questions.append(future.result())
                    print(f"[DEBUG] Retry success! Now have {len(questions)}/{target_count} questions")
                except Exception as e:
                    weak_point, idx = retry_futures[future]
                    print(f"[ERROR] Retry failed for {weak_point['knowledge_name']} (index {idx}): {e}")

    print(f"[DEBUG] Final result: {len(questions)}/{target_count} questions generated")

    if not questions:
        raise ValueError(f'Failed to generate any questions after retries.')

    return questions


def calculate_daily_question_count(user_id: str) -> int:
    """
    智能计算每日应出题数量
    基于：
    1. 用户学习档案中的每日目标
    2. 薄弱点数量和严重程度
    3. 最近7天的答题表现
    """
    with transaction() as conn:
        # 获取用户学习档案
        profile = conn.execute('SELECT * FROM learning_profile WHERE user_id = ?', (user_id,)).fetchone()
        if not profile:
            return 10  # 默认值

        target = profile.get('daily_practice_count_target') or 20

        # 获取薄弱点统计
        weak_points = rows_to_dicts(
            conn.execute(
                """
                SELECT mastery_score, error_count, correct_count
                FROM weak_points
                WHERE user_id = ? AND ignored = 0
                  AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
                """,
                (user_id,),
            ).fetchall()
        )

        if not weak_points:
            return max(5, target // 2)  # 没有薄弱点时减少题量

        # 计算高优先级薄弱点数量（掌握度<40）
        high_priority_count = sum(1 for wp in weak_points if wp['mastery_score'] < 40)
        medium_priority_count = sum(1 for wp in weak_points if 40 <= wp['mastery_score'] < 70)

        # 获取最近7天的答题统计
        seven_days_ago = (date.today() - timedelta(days=7)).isoformat()
        recent_stats = conn.execute(
            """
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct
            FROM practice_submissions
            WHERE user_id = ? AND created_at >= ?
            """,
            (user_id, seven_days_ago),
        ).fetchone()

        total_recent = recent_stats['total'] if recent_stats else 0
        correct_recent = recent_stats['correct'] if recent_stats else 0
        accuracy = (correct_recent / total_recent * 100) if total_recent > 0 else 50

        # 智能调整题量
        adjusted_count = target

        # 根据薄弱点严重程度调整
        if high_priority_count >= 10:
            adjusted_count = int(target * 1.3)  # 增加30%
        elif high_priority_count >= 5:
            adjusted_count = int(target * 1.15)  # 增加15%

        # 根据最近准确率调整
        if accuracy < 50 and total_recent >= 10:
            adjusted_count = int(adjusted_count * 0.85)  # 准确率低时减少题量，避免挫败感
        elif accuracy > 80 and total_recent >= 20:
            adjusted_count = int(adjusted_count * 1.1)  # 准确率高时适当增加

        # 限制范围
        adjusted_count = max(5, min(50, adjusted_count))

        print(f"[AUTO-CALC] User {user_id}: target={target}, weak_points={len(weak_points)}, "
              f"high_priority={high_priority_count}, accuracy={accuracy:.1f}%, final={adjusted_count}")

        return adjusted_count


def get_learning_context(user_id: str) -> str:
    """
    获取用户的学习档案上下文，用于 AI 生成时提供个性化信息。
    返回格式化的字符串，包含学习目标、薄弱点、最近学习历史等。
    """
    with transaction() as conn:
        # 获取学习档案
        profile_row = conn.execute(
            'SELECT * FROM learning_profile WHERE user_id = ?',
            (user_id,),
        ).fetchone()

        if not profile_row:
            return ''

        profile = row_to_dict(profile_row)

        # 获取前5个薄弱点
        weak_rows = conn.execute(
            """
            SELECT knowledge_name, mastery_score, error_count, correct_count
            FROM weak_points
            WHERE user_id = ? AND ignored = 0
              AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
            ORDER BY mastery_score ASC, updated_at DESC
            LIMIT 5
            """,
            (user_id,),
        ).fetchall()

        # 获取最近5次学习活动
        history_rows = conn.execute(
            """
            SELECT source_type, summary, extracted_knowledge, created_at
            FROM interaction_logs
            WHERE user_id = ?
              AND extracted_knowledge IS NOT NULL
              AND extracted_knowledge <> '[]'
              AND summary NOT LIKE '非学习对话%'
            ORDER BY created_at DESC
            LIMIT 5
            """,
            (user_id,),
        ).fetchall()

    # 构建上下文字符串
    context_parts = ['【用户学习档案】']

    # 学习目标和阶段
    if profile.get('goal'):
        context_parts.append(f"学习目标：{profile['goal']}")
    if profile.get('current_stage'):
        context_parts.append(f"当前阶段：{profile['current_stage']}")
    if profile.get('self_introduction'):
        context_parts.append(f"自我介绍：{profile['self_introduction']}")
    if profile.get('learning_preferences'):
        context_parts.append(f"学习偏好：{profile['learning_preferences']}")

    # 薄弱点
    if weak_rows:
        weak_list = []
        for row in weak_rows:
            score = round(float(row['mastery_score'] or 0), 1)
            weak_list.append(f"{row['knowledge_name']}(掌握度{score}%)")
        context_parts.append(f"当前薄弱点：{' | '.join(weak_list)}")

    # 最近学习历史
    if history_rows:
        history_list = []
        for row in history_rows:
            knowledge = json_loads(row['extracted_knowledge'], [])
            if knowledge:
                history_list.append(f"{row['summary']} - {', '.join(knowledge[:2])}")
            else:
                history_list.append(row['summary'])
        context_parts.append(f"最近学习：{' | '.join(history_list[:3])}")

    return '\n'.join(context_parts) + '\n\n请根据以上学习档案，为用户提供个性化的内容。'
