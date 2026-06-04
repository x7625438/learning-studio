from flask import Blueprint, jsonify, request

from auth import current_user_id, login_required
from database import json_loads, row_to_dict, rows_to_dicts, transaction
from services.learning_service import ensure_profile, normalize_profile, normalize_weak_point

bp = Blueprint('profile', __name__, url_prefix='/api/v1/profile')


@bp.get('')
@login_required
def get_profile():
    user_id = current_user_id()
    profile = ensure_profile(user_id)
    with transaction() as conn:
        weak_rows = conn.execute(
            """
            SELECT * FROM weak_points
            WHERE user_id = ? AND ignored = 0
              AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
            ORDER BY mastery_score ASC, updated_at DESC
            LIMIT 5
            """,
            (user_id,),
        ).fetchall()
        history_rows = conn.execute(
            """
            SELECT source_type,
                   MAX(created_at) AS created_at,
                   COUNT(*) AS count,
                   GROUP_CONCAT(summary, '；') AS summaries,
                   GROUP_CONCAT(extracted_knowledge, '|') AS knowledge_groups
            FROM interaction_logs
            WHERE user_id = ?
              AND extracted_knowledge IS NOT NULL
              AND extracted_knowledge <> '[]'
              AND summary NOT LIKE '非学习对话%'
            GROUP BY source_type, date(created_at), source_id
            ORDER BY created_at DESC
            LIMIT 5
            """,
            (user_id,),
        ).fetchall()
        today_row = conn.execute(
            "SELECT study_minutes, study_seconds, practice_count FROM study_records WHERE user_id = ? AND date = date('now')",
            (user_id,),
        ).fetchone()
        total_row = conn.execute(
            'SELECT COALESCE(SUM(study_seconds), 0) AS total_seconds FROM study_records WHERE user_id = ?',
            (user_id,),
        ).fetchone()
    profile['totalStudyHours'] = (total_row['total_seconds'] if total_row else 0) / 3600
    return jsonify(
        {
            'data': {
                'profile': profile,
                'weakPoints': [normalize_weak_point(item) for item in rows_to_dicts(weak_rows)],
                'recentHistory': [normalize_history_group(item) for item in rows_to_dicts(history_rows)],
                'today': {
                    'studyMinutes': today_row['study_minutes'] if today_row else 0,
                    'studySeconds': today_row['study_seconds'] if today_row else 0,
                    'practiceCount': today_row['practice_count'] if today_row else 0,
                },
            }
        }
    )


def normalize_history_group(item: dict) -> dict:
    knowledge: list[str] = []
    for group in (item.get('knowledge_groups') or '').split('|'):
        for point in json_loads(group, []):
            if point not in knowledge:
                knowledge.append(point)
    label_map = {
        'qa': '即时问答',
        'textbook': '教材对话',
        'paper': '论文解读',
        'practice': '主动回忆',
        'calendar': '学习计时',
        'feynman': '费曼学习',
        'learning_path': '学习路径',
    }
    label = label_map.get(item['source_type'], item['source_type'])
    topic = '、'.join(knowledge[:3]) if knowledge else '一次学习活动'
    count = item.get('count') or 1
    return {
        'id': f'{item["source_type"]}-{item["created_at"]}',
        'sourceType': item['source_type'],
        'summary': f'{label}：围绕 {topic} 记录了 {count} 次学习动作',
        'createdAt': item['created_at'],
        'knowledgePoints': knowledge,
    }


@bp.put('')
@login_required
def update_profile():
    user_id = current_user_id()
    ensure_profile(user_id)
    data = request.get_json(silent=True) or {}
    allowed = {
        'goal': 'goal',
        'currentStage': 'current_stage',
        'selfIntroduction': 'self_introduction',
        'learningPreferences': 'learning_preferences',
        'weeklyStudyHoursTarget': 'weekly_study_hours_target',
        'dailyPracticeCountTarget': 'daily_practice_count_target',
        'emotionEnabled': 'emotion_enabled',
    }
    updates = []
    values = []
    for key, column in allowed.items():
        if key in data:
            updates.append(f'{column} = ?')
            values.append(1 if key == 'emotionEnabled' and data[key] else data[key])
    if not updates:
        return jsonify({'message': '没有可更新字段', 'code': 'NO_CHANGES'}), 400
    values.append(user_id)
    with transaction() as conn:
        conn.execute(
            f"UPDATE learning_profile SET {', '.join(updates)}, updated_at = datetime('now') WHERE user_id = ?",
            values,
        )
        row = conn.execute('SELECT * FROM learning_profile WHERE user_id = ?', (user_id,)).fetchone()
    return jsonify({'data': normalize_profile(row_to_dict(row))})


@bp.get('/weak-points')
@login_required
def profile_weak_points():
    with transaction() as conn:
        rows = conn.execute(
            'SELECT * FROM weak_points WHERE user_id = ? AND ignored = 0 ORDER BY mastery_score ASC',
            (current_user_id(),),
        ).fetchall()
    return jsonify({'data': [normalize_weak_point(item) for item in rows_to_dicts(rows)], 'total': len(rows)})


@bp.get('/history')
@login_required
def profile_history():
    page = max(1, int(request.args.get('page', 1)))
    page_size = min(100, max(1, int(request.args.get('pageSize', 20))))
    offset = (page - 1) * page_size
    user_id = current_user_id()
    with transaction() as conn:
        total = conn.execute(
            'SELECT COUNT(*) AS count FROM interaction_logs WHERE user_id = ?',
            (user_id,),
        ).fetchone()['count']
        rows = conn.execute(
            'SELECT * FROM interaction_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
            (user_id, page_size, offset),
        ).fetchall()
    data = [
        {
            'id': item['id'],
            'sourceType': item['source_type'],
            'sourceId': item['source_id'],
            'summary': item['summary'],
            'knowledgePoints': json_loads(item['extracted_knowledge'], []),
            'createdAt': item['created_at'],
        }
        for item in rows_to_dicts(rows)
    ]
    return jsonify({'data': data, 'total': total, 'page': page, 'pageSize': page_size})


@bp.get('/export')
@login_required
def export_profile():
    user_id = current_user_id()
    with transaction() as conn:
        profile = normalize_profile(
            row_to_dict(conn.execute('SELECT * FROM learning_profile WHERE user_id = ?', (user_id,)).fetchone())
        )
        weak_points = [
            normalize_weak_point(item)
            for item in rows_to_dicts(conn.execute('SELECT * FROM weak_points WHERE user_id = ?', (user_id,)).fetchall())
        ]
        history = rows_to_dicts(
            conn.execute(
                'SELECT * FROM interaction_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000',
                (user_id,),
            ).fetchall()
        )
    return jsonify({'data': {'profile': profile, 'weakPoints': weak_points, 'history': history}})
