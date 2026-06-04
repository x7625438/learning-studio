from datetime import date, timedelta
from flask import Blueprint, jsonify, request

from auth import current_user_id, login_required
from database import json_dumps, rows_to_dicts, transaction
from services.learning_service import new_id, update_study_record

bp = Blueprint('calendar', __name__, url_prefix='/api/v1')


@bp.get('/calendar/monthly')
@login_required
def monthly():
    year = int(request.args.get('year', date.today().year))
    month = int(request.args.get('month', date.today().month))
    start = date(year, month, 1)
    end = date(year + (month // 12), month % 12 + 1, 1)
    user_id = current_user_id()
    with transaction() as conn:
        rows = rows_to_dicts(
            conn.execute(
                'SELECT * FROM study_records WHERE user_id = ? AND date >= ? AND date < ?',
                (user_id, start.isoformat(), end.isoformat()),
            ).fetchall()
        )
    by_date = {row['date']: row for row in rows}
    cells = []
    current = start
    while current < end:
        row = by_date.get(current.isoformat())
        seconds = row['study_seconds'] if row else 0
        minutes = seconds // 60
        intensity = min(3, max(1, seconds // 1800)) if seconds else 0
        cells.append({
            'date': current.isoformat(),
            'studyMinutes': minutes,
            'studySeconds': seconds,
            'intensity': intensity,
        })
        current += timedelta(days=1)
    return jsonify({'data': cells})


@bp.get('/calendar/weekly')
@login_required
def weekly():
    today = date.today()
    start = today - timedelta(days=today.weekday())
    end = start + timedelta(days=6)
    with transaction() as conn:
        rows = rows_to_dicts(
            conn.execute(
                'SELECT * FROM study_records WHERE user_id = ? AND date >= ? AND date <= ?',
                (current_user_id(), start.isoformat(), end.isoformat()),
            ).fetchall()
        )
    total_seconds = sum(row['study_seconds'] for row in rows)
    total = total_seconds // 60
    practice = sum(row['practice_count'] for row in rows)
    return jsonify({'data': {
        'weekStart': start.isoformat(),
        'weekEnd': end.isoformat(),
        'totalStudyMinutes': total,
        'totalStudySeconds': total_seconds,
        'targetStudyMinutes': 1800,
        'practiceCount': practice,
        'targetPracticeCount': 100,
        'focusDays': sum(1 for row in rows if row['study_seconds'] > 0),
        'targetFocusDays': 5,
        'achievements': [],
    }})


@bp.post('/calendar/timer/finish')
@login_required
def finish_timer():
    data = request.get_json(silent=True) or {}
    raw_seconds = data.get('seconds')
    seconds = int(raw_seconds) if raw_seconds is not None else int(data.get('minutes') or 0) * 60
    seconds = max(1, min(720 * 60, seconds))
    minutes = seconds // 60
    topic = data.get('topic') or '手动学习计时'
    user_id = current_user_id()
    duration_text = f'{minutes} 分钟' if seconds % 60 == 0 else f'{seconds} 秒'
    user_input = f'学习计时 {duration_text}：{topic}'
    update_study_record(user_id, seconds=seconds, practice_delta=0, topics=[topic])
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
                'calendar',
                None,
                user_input,
                '',
                json_dumps([topic]),
                f'学习计时：{topic}',
            ),
        )
    return jsonify({'data': {'ok': True, 'minutes': minutes, 'seconds': seconds, 'topic': topic}})


@bp.get('/milestones')
@login_required
def milestones():
    with transaction() as conn:
        rows = rows_to_dicts(
            conn.execute('SELECT * FROM milestone_records WHERE user_id = ? ORDER BY created_at DESC', (current_user_id(),)).fetchall()
        )
    return jsonify({'data': rows})


@bp.put('/milestones/<milestone_id>')
@login_required
def update_milestone(milestone_id):
    data = request.get_json(silent=True) or {}
    with transaction() as conn:
        conn.execute(
            'UPDATE milestone_records SET title = COALESCE(?, title), description = COALESCE(?, description), progress = COALESCE(?, progress), target_date = COALESCE(?, target_date) WHERE id = ? AND user_id = ?',
            (data.get('title'), data.get('description'), data.get('progress'), data.get('targetDate'), milestone_id, current_user_id()),
        )
    return jsonify({'data': {'ok': True}})


@bp.post('/milestones/<milestone_id>/achieve')
@login_required
def achieve(milestone_id):
    with transaction() as conn:
        conn.execute(
            "UPDATE milestone_records SET status = 'achieved', progress = 100, achieved_at = datetime('now') WHERE id = ? AND user_id = ?",
            (milestone_id, current_user_id()),
        )
    return jsonify({'data': {'ok': True}})
