from flask import Blueprint, jsonify, request

from auth import current_user_id, login_required
from database import row_to_dict, rows_to_dicts, transaction
from services.learning_service import build_practice_question, normalize_weak_point, update_study_record, upsert_weak_points

bp = Blueprint('weak_points', __name__, url_prefix='/api/v1/weak-points')


@bp.get('')
@login_required
def list_weak_points():
    with transaction() as conn:
        rows = conn.execute(
            """
            SELECT * FROM weak_points
            WHERE user_id = ? AND ignored = 0
              AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
            ORDER BY mastery_score ASC, updated_at DESC
            """,
            (current_user_id(),),
        ).fetchall()
    data = [normalize_weak_point(item) for item in rows_to_dicts(rows)]
    return jsonify({'data': data, 'total': len(data)})


@bp.get('/recommend')
@login_required
def recommend_practice():
    user_id = current_user_id()
    with transaction() as conn:
        weak_rows = rows_to_dicts(
            conn.execute(
                """
                SELECT * FROM weak_points
                WHERE user_id = ? AND ignored = 0
                  AND NOT (source = 'qa' AND error_count = 0 AND correct_count = 0)
                ORDER BY mastery_score ASC LIMIT 5
                """,
                (user_id,),
            ).fetchall()
        )
    if not weak_rows:
        return jsonify(
            {
                'data': {
                    'date': request.args.get('date'),
                    'targetCount': 0,
                    'completedCount': 0,
                    'questions': [],
                    'emptyReason': '还没有可用薄弱点，请先进行一次问答、阅读、写作反馈或训练。',
                }
            }
        )
    questions = [build_practice_question(user_id, item) for item in weak_rows[:3]]
    return jsonify({'data': {'date': request.args.get('date'), 'targetCount': len(questions), 'completedCount': 0, 'questions': questions}})


@bp.get('/<weak_point_id>')
@login_required
def detail(weak_point_id):
    user_id = current_user_id()
    with transaction() as conn:
        row = conn.execute('SELECT * FROM weak_points WHERE id = ? AND user_id = ?', (weak_point_id, user_id)).fetchone()
        if not row:
            return jsonify({'message': '薄弱点不存在', 'code': 'NOT_FOUND'}), 404
        interactions = rows_to_dicts(
            conn.execute(
                """
                SELECT id, user_input, summary, created_at FROM interaction_logs
                WHERE user_id = ? AND extracted_knowledge LIKE ?
                ORDER BY created_at DESC LIMIT 10
                """,
                (user_id, f'%{row["knowledge_name"]}%'),
            ).fetchall()
        )
    data = normalize_weak_point(row_to_dict(row))
    data['relatedInteractions'] = [
        {'id': item['id'], 'userInput': item['user_input'], 'summary': item['summary'], 'createdAt': item['created_at']}
        for item in interactions
    ]
    data['relatedQuestions'] = []
    return jsonify({'data': data})


@bp.post('/<weak_point_id>/practice')
@login_required
def practice_weak_point(weak_point_id):
    data = request.get_json(silent=True) or {}
    user_id = current_user_id()
    with transaction() as conn:
        row = conn.execute('SELECT * FROM weak_points WHERE id = ? AND user_id = ?', (weak_point_id, user_id)).fetchone()
    if not row:
        return jsonify({'message': '薄弱点不存在', 'code': 'NOT_FOUND'}), 404
    correct = bool(data.get('isCorrect', data.get('answer') in ('A', '正确', '对')))
    upsert_weak_points(user_id, [row['knowledge_name']], source='practice', correct=correct)
    update_study_record(user_id, minutes=3, practice_delta=1, topics=[row['knowledge_name']])
    with transaction() as conn:
        updated = row_to_dict(conn.execute('SELECT * FROM weak_points WHERE id = ?', (weak_point_id,)).fetchone())
    return jsonify({'data': {'correct': correct, 'weakPoint': normalize_weak_point(updated)}})


@bp.post('/<weak_point_id>/ignore')
@login_required
def ignore_weak_point(weak_point_id):
    with transaction() as conn:
        conn.execute(
            "UPDATE weak_points SET ignored = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
            (weak_point_id, current_user_id()),
        )
    return jsonify({'data': {'ok': True}})


@bp.delete('/<weak_point_id>')
@login_required
def delete_weak_point(weak_point_id):
    with transaction() as conn:
        conn.execute(
            'DELETE FROM weak_points WHERE id = ? AND user_id = ?',
            (weak_point_id, current_user_id()),
        )
    return jsonify({'data': {'ok': True}})
