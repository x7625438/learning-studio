"""
Essay grading blueprint — rubric-based subjective question / essay evaluation.
"""
from __future__ import annotations

import traceback
from uuid import uuid4

from flask import Blueprint, Response, jsonify, request

import config
from auth import current_user_id, login_required
from database import json_dumps, json_loads, row_to_dict, rows_to_dicts, transaction
from services.ai_service import chat_completion_json, sse
from services.essay_grading_service import (
    PRESET_RUBRICS,
    build_grading_prompt,
    normalize_grading_response,
    validate_dimensions,
)
from services.learning_service import log_interaction, new_id, upsert_weak_points
from services.user_profile_service import get_user_profile_context

bp = Blueprint('essay_grading', __name__, url_prefix='/api/v1/essay-grading')


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_rubric(row: dict) -> dict:
    """Convert a rubric_templates DB row to camelCase response."""
    return {
        'id': row['id'],
        'userId': row.get('user_id'),
        'name': row['name'],
        'examType': row['exam_type'],
        'dimensions': json_loads(row['dimensions'], []),
        'totalScore': row['total_score'],
        'isPreset': bool(row['is_preset']),
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
    }


def _format_session(row: dict) -> dict:
    """Convert an essay_grading_sessions DB row to camelCase response."""
    return {
        'id': row['id'],
        'title': row['title'],
        'essayText': row['essay_text'],
        'rubricId': row.get('rubric_id'),
        'rubricSnapshot': json_loads(row['rubric_snapshot'], {}),
        'examType': row['exam_type'],
        'totalScore': row['total_score'],
        'dimensionScores': json_loads(row['dimension_scores'], []),
        'overallFeedback': row['overall_feedback'],
        'strengths': json_loads(row['strengths'], []),
        'weaknesses': json_loads(row['weaknesses'], []),
        'suggestions': json_loads(row['suggestions'], []),
        'status': row['status'],
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
    }


# ---------------------------------------------------------------------------
# Rubric CRUD
# ---------------------------------------------------------------------------

@bp.get('/rubrics')
@login_required
def list_rubrics():
    """List presets + user's custom rubrics. Optional ?examType= filter."""
    exam_type = request.args.get('examType', '').strip()
    user_id = current_user_id()

    # Load presets
    presets = [r for r in PRESET_RUBRICS if not exam_type or r['examType'] == exam_type]

    # Load user's custom rubrics from DB
    try:
        with transaction() as conn:
            if exam_type:
                rows = rows_to_dicts(conn.execute(
                    'SELECT * FROM rubric_templates WHERE user_id = ? AND is_preset = 0 AND exam_type = ? ORDER BY created_at DESC',
                    (user_id, exam_type),
                ).fetchall())
            else:
                rows = rows_to_dicts(conn.execute(
                    'SELECT * FROM rubric_templates WHERE user_id = ? AND is_preset = 0 ORDER BY created_at DESC',
                    (user_id,),
                ).fetchall())
        custom = [_format_rubric(r) for r in rows]
    except Exception:
        custom = []

    return jsonify({'data': {'presets': presets, 'custom': custom}})


@bp.post('/rubrics')
@login_required
def create_rubric():
    """Create a custom rubric."""
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    exam_type = (data.get('examType') or '自定义').strip()
    dimensions = data.get('dimensions', [])
    total_score = data.get('totalScore', 100)

    if not name:
        return jsonify({'message': '评分标准名称不能为空', 'code': 'VALIDATION_ERROR'}), 400

    err = validate_dimensions(dimensions, total_score)
    if err:
        return jsonify({'message': err, 'code': 'VALIDATION_ERROR'}), 400

    rubric_id = new_id()
    user_id = current_user_id()
    with transaction() as conn:
        conn.execute(
            'INSERT INTO rubric_templates (id, user_id, name, exam_type, dimensions, total_score, is_preset) '
            'VALUES (?, ?, ?, ?, ?, ?, 0)',
            (rubric_id, user_id, name, exam_type, json_dumps(dimensions), total_score),
        )

    return jsonify({'data': {
        'id': rubric_id,
        'name': name,
        'examType': exam_type,
        'dimensions': dimensions,
        'totalScore': total_score,
        'isPreset': False,
    }}), 201


@bp.put('/rubrics/<rubric_id>')
@login_required
def update_rubric(rubric_id):
    """Update a custom rubric. Presets cannot be modified."""
    data = request.get_json(silent=True) or {}
    user_id = current_user_id()

    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM rubric_templates WHERE id = ? AND user_id = ?',
            (rubric_id, user_id),
        ).fetchone()

    if not row:
        return jsonify({'message': '评分标准不存在', 'code': 'NOT_FOUND'}), 404
    if row['is_preset']:
        return jsonify({'message': '预设评分标准不可修改', 'code': 'FORBIDDEN'}), 403

    name = (data.get('name') or row['name']).strip()
    exam_type = (data.get('examType') or row['exam_type']).strip()
    dimensions = data.get('dimensions', json_loads(row['dimensions'], []))
    total_score = data.get('totalScore', row['total_score'])

    err = validate_dimensions(dimensions, total_score)
    if err:
        return jsonify({'message': err, 'code': 'VALIDATION_ERROR'}), 400

    with transaction() as conn:
        conn.execute(
            'UPDATE rubric_templates SET name = ?, exam_type = ?, dimensions = ?, total_score = ?, '
            "updated_at = datetime('now') WHERE id = ?",
            (name, exam_type, json_dumps(dimensions), total_score, rubric_id),
        )

    return jsonify({'data': {
        'id': rubric_id,
        'name': name,
        'examType': exam_type,
        'dimensions': dimensions,
        'totalScore': total_score,
        'isPreset': False,
    }})


@bp.delete('/rubrics/<rubric_id>')
@login_required
def delete_rubric(rubric_id):
    """Delete a custom rubric. Presets cannot be deleted."""
    user_id = current_user_id()

    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM rubric_templates WHERE id = ? AND user_id = ?',
            (rubric_id, user_id),
        ).fetchone()

    if not row:
        return jsonify({'message': '评分标准不存在', 'code': 'NOT_FOUND'}), 404
    if row['is_preset']:
        return jsonify({'message': '预设评分标准不可删除', 'code': 'FORBIDDEN'}), 403

    with transaction() as conn:
        conn.execute('DELETE FROM rubric_templates WHERE id = ?', (rubric_id,))

    return jsonify({'data': {'id': rubric_id}})


# ---------------------------------------------------------------------------
# Grading Sessions
# ---------------------------------------------------------------------------

@bp.get('')
@bp.get('/')
@bp.get('/sessions')
@login_required
def list_sessions():
    """List user's grading sessions. Optional ?examType=&status= filters."""
    exam_type = request.args.get('examType', '').strip()
    status = request.args.get('status', '').strip()
    user_id = current_user_id()

    query = 'SELECT * FROM essay_grading_sessions WHERE user_id = ?'
    params: list = [user_id]
    if exam_type:
        query += ' AND exam_type = ?'
        params.append(exam_type)
    if status:
        query += ' AND status = ?'
        params.append(status)
    query += ' ORDER BY created_at DESC'

    try:
        with transaction() as conn:
            rows = rows_to_dicts(conn.execute(query, params).fetchall())
        sessions = [_format_session(r) for r in rows]
    except Exception:
        sessions = []

    return jsonify({'data': sessions})


@bp.post('/start')
@login_required
def start_session():
    """Create a new grading session. Returns session ID for subsequent grading."""
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    essay_text = (data.get('essayText') or '').strip()

    if not title:
        return jsonify({'message': '文章标题不能为空', 'code': 'VALIDATION_ERROR'}), 400
    if len(essay_text) < 50:
        return jsonify({'message': '文章内容至少需要50个字才能进行有意义的批改', 'code': 'VALIDATION_ERROR'}), 400

    user_id = current_user_id()
    rubric_id = data.get('rubricId')
    rubric_snapshot: dict = {}

    # If a rubric is specified, load it and snapshot
    if rubric_id:
        # Check presets first
        preset = next((r for r in PRESET_RUBRICS if r['id'] == rubric_id), None)
        if preset:
            rubric_snapshot = {
                'name': preset['name'],
                'examType': preset['examType'],
                'dimensions': preset['dimensions'],
                'totalScore': preset['totalScore'],
            }
            exam_type = preset['examType']
        else:
            with transaction() as conn:
                rubric_row = conn.execute(
                    'SELECT * FROM rubric_templates WHERE id = ? AND (user_id = ? OR is_preset = 1)',
                    (rubric_id, user_id),
                ).fetchone()
            if not rubric_row:
                return jsonify({'message': '评分标准不存在', 'code': 'NOT_FOUND'}), 404
            rubric_snapshot = {
                'name': rubric_row['name'],
                'examType': rubric_row['exam_type'],
                'dimensions': json_loads(rubric_row['dimensions'], []),
                'totalScore': rubric_row['total_score'],
            }
            exam_type = rubric_row['exam_type']
    else:
        exam_type = data.get('examType', '自定义')

    session_id = new_id()
    with transaction() as conn:
        conn.execute(
            'INSERT INTO essay_grading_sessions '
            '(id, user_id, title, essay_text, rubric_id, rubric_snapshot, exam_type, status) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (session_id, user_id, title, essay_text, rubric_id, json_dumps(rubric_snapshot), exam_type, 'pending'),
        )

    return jsonify({'data': {'id': session_id, 'status': 'pending'}}), 201


@bp.post('/<session_id>/grade')
@login_required
def grade_session(session_id):
    """SSE streaming grading. Grades the essay against the rubric snapshot."""
    user_id = current_user_id()

    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM essay_grading_sessions WHERE id = ? AND user_id = ?',
            (session_id, user_id),
        ).fetchone()

    if not row:
        return jsonify({'message': '批改会话不存在', 'code': 'NOT_FOUND'}), 404

    session = _format_session(row_to_dict(row))
    rubric_snapshot = session['rubricSnapshot']
    if not rubric_snapshot or not rubric_snapshot.get('dimensions'):
        return jsonify({'message': '没有选择评分标准，请先选择或创建评分标准', 'code': 'VALIDATION_ERROR'}), 400

    essay_text = session['essayText']

    with transaction() as conn:
        conn.execute(
            "UPDATE essay_grading_sessions SET status = 'processing', updated_at = datetime('now') WHERE id = ?",
            (session_id,),
        )

    dimensions = rubric_snapshot.get('dimensions', [])
    total_steps = len(dimensions) + 2  # prep + final

    def generate():
        try:
            # Step 1: preparing
            yield sse('progress', {
                'type': 'progress',
                'phase': 'preparing',
                'message': '正在读取评分标准...',
                'percentage': 5,
            })

            # Step 2: AI analysis
            yield sse('progress', {
                'type': 'progress',
                'phase': 'analyzing',
                'message': '正在深度分析文章内容...',
                'percentage': 15,
            })

            messages = build_grading_prompt(rubric_snapshot, essay_text, user_id)
            ai_result = chat_completion_json(messages, temperature=0.4, model=config.TEXT_MODEL, user_id=user_id)
            normalized = normalize_grading_response(ai_result, rubric_snapshot)

            # Step 3: Stream each dimension result progressively
            dim_scores = normalized['dimensionScores']
            for i, dim in enumerate(dim_scores):
                pct = 20 + int((i + 1) / len(dim_scores) * 55)
                yield sse('dimension', {
                    'type': 'dimension',
                    'index': i,
                    'total': len(dim_scores),
                    'data': dim,
                })
                yield sse('progress', {
                    'type': 'progress',
                    'phase': 'scoring',
                    'message': f'已完成 {dim["name"]} 评分（{dim["score"]}/{dim["maxScore"]}）',
                    'percentage': pct,
                })

            # Step 4: Final summary
            yield sse('progress', {
                'type': 'progress',
                'phase': 'summarizing',
                'message': '正在生成综合评价...',
                'percentage': 80,
            })

            final_payload = {
                'type': 'final',
                'data': {
                    'dimensionScores': normalized['dimensionScores'],
                    'totalScore': normalized['totalScore'],
                    'overallFeedback': normalized['overallFeedback'],
                    'strengths': normalized['strengths'],
                    'weaknesses': normalized['weaknesses'],
                    'suggestions': normalized['suggestions'],
                },
            }
            yield sse('final', final_payload)

            # Save results to DB
            with transaction() as conn:
                conn.execute(
                    'UPDATE essay_grading_sessions SET '
                    'total_score = ?, dimension_scores = ?, overall_feedback = ?, '
                    'strengths = ?, weaknesses = ?, suggestions = ?, '
                    "status = 'completed', updated_at = datetime('now') "
                    'WHERE id = ?',
                    (
                        normalized['totalScore'],
                        json_dumps(normalized['dimensionScores']),
                        normalized['overallFeedback'],
                        json_dumps(normalized['strengths']),
                        json_dumps(normalized['weaknesses']),
                        json_dumps(normalized['suggestions']),
                        session_id,
                    ),
                )

            # Log interaction for learning profile
            weak_points = [w for w in normalized['weaknesses'][:3]]
            log_interaction(
                user_id, 'essay_grading', essay_text[:200],
                f'总分{normalized["totalScore"]}分', session_id, weak_points,
            )
            if weak_points:
                upsert_weak_points(user_id, weak_points)

            yield sse('progress', {
                'type': 'progress',
                'phase': 'done',
                'message': '批改完成！',
                'percentage': 100,
            })
            yield sse('done', {'type': 'done'})

        except Exception:
            traceback.print_exc()
            with transaction() as conn:
                conn.execute(
                    "UPDATE essay_grading_sessions SET status = 'error', updated_at = datetime('now') WHERE id = ?",
                    (session_id,),
                )
            yield sse('error', {
                'type': 'error',
                'message': 'AI 批改过程出错，请稍后重试',
            })

    return Response(generate(), mimetype='text/event-stream')


@bp.get('/<session_id>')
@login_required
def get_session(session_id):
    """Get grading session detail."""
    user_id = current_user_id()
    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM essay_grading_sessions WHERE id = ? AND user_id = ?',
            (session_id, user_id),
        ).fetchone()

    if not row:
        return jsonify({'message': '批改会话不存在', 'code': 'NOT_FOUND'}), 404

    return jsonify({'data': _format_session(row_to_dict(row))})


@bp.delete('/<session_id>')
@login_required
def delete_session(session_id):
    """Delete a grading session."""
    user_id = current_user_id()
    with transaction() as conn:
        result = conn.execute(
            'DELETE FROM essay_grading_sessions WHERE id = ? AND user_id = ?',
            (session_id, user_id),
        )
        if result.rowcount == 0:
            return jsonify({'message': '批改会话不存在', 'code': 'NOT_FOUND'}), 404

    return jsonify({'data': {'id': session_id}})
