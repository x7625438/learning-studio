from __future__ import annotations

from flask import Blueprint, jsonify, request

from auth import current_user_id, login_required
from services.knowledge_memory_service import (
    auto_capture_batch,
    consolidate_memories,
    create_memory,
    delete_memory,
    export_memories,
    find_consolidation_candidates,
    get_due_reviews,
    get_knowledge_context,
    get_memory,
    get_stats,
    list_memories,
    record_review,
    reindex_all_memories,
    restore_memory,
    search_memories,
    update_memory,
)

bp = Blueprint('knowledge_memories', __name__, url_prefix='/api/v1/knowledge-memories')


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@bp.get('')
@login_required
def index():
    """List knowledge memories (paginated, filtered)."""
    user_id = current_user_id()
    page = request.args.get('page', 1, type=int)
    page_size = request.args.get('pageSize', 20, type=int)
    subject = request.args.get('subject', None, type=str)
    topic = request.args.get('topic', None, type=str)
    memory_type = request.args.get('memoryType', None, type=str)
    query = request.args.get('q', None, type=str)
    sort_by = request.args.get('sortBy', 'updated_at', type=str)
    sort_order = request.args.get('sortOrder', 'desc', type=str)
    include_archived = request.args.get('includeArchived', '0') == '1'

    result = list_memories(
        user_id,
        page=page,
        page_size=min(page_size, 100),
        subject=subject,
        topic=topic,
        memory_type=memory_type,
        query=query,
        sort_by=sort_by,
        sort_order=sort_order,
        include_archived=include_archived,
    )
    return jsonify({
        'data': result['items'],
        'total': result['total'],
        'page': result['page'],
        'pageSize': result['pageSize'],
    })


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@bp.post('')
@login_required
def create():
    """Create a new knowledge memory manually."""
    data = request.get_json(silent=True) or {}
    try:
        memory = create_memory(current_user_id(), data)
        return jsonify({'data': memory, 'message': '创建成功'}), 201
    except ValueError as exc:
        return jsonify({'message': str(exc), 'code': 'VALIDATION_ERROR'}), 400


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@bp.get('/stats')
@login_required
def stats():
    """Dashboard stats."""
    return jsonify({'data': get_stats(current_user_id())})


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@bp.get('/search')
@login_required
def search():
    """Hybrid search across knowledge memories."""
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'data': [], 'message': 'Query is required'}), 400
    top_k = request.args.get('topK', 10, type=int)
    results = search_memories(current_user_id(), query, top_k=min(top_k, 50))
    return jsonify({'data': results})


# ---------------------------------------------------------------------------
# Auto-capture
# ---------------------------------------------------------------------------

@bp.post('/auto-capture')
@login_required
def auto_capture():
    """Manually trigger auto-capture from recent interactions."""
    limit = request.get_json(silent=True) or {}
    limit_val = limit.get('limit', 20) if isinstance(limit, dict) else 20
    result = auto_capture_batch(current_user_id(), limit=min(int(limit_val), 50))
    return jsonify({
        'message': f'扫描了 {result["scanned"]} 条交互，捕获了 {result["captured"]} 条新知识',
        'data': result,
    })


# ---------------------------------------------------------------------------
# RAG Context (debug/testing)
# ---------------------------------------------------------------------------

@bp.get('/context')
@login_required
def rag_context():
    """Return RAG knowledge context for a query (used for debugging)."""
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'message': 'Query is required', 'code': 'VALIDATION_ERROR'}), 400
    top_k = request.args.get('topK', 5, type=int)
    context = get_knowledge_context(current_user_id(), query, top_k=min(top_k, 10))
    if not context:
        return jsonify({'data': {'context': '', 'message': 'No relevant knowledge found'}})
    return jsonify({'data': {'context': context}})


# ---------------------------------------------------------------------------
# Reindex
# ---------------------------------------------------------------------------

@bp.post('/reindex')
@login_required
def reindex():
    """Rebuild all vector embeddings for current user."""
    result = reindex_all_memories(current_user_id())
    return jsonify({'message': f'已重建 {result["indexed"]}/{result["total"]} 条向量索引', 'data': result})


# ---------------------------------------------------------------------------
# SM-2 Spaced Repetition Review
# ---------------------------------------------------------------------------

@bp.get('/due-review')
@login_required
def due_review():
    """Get memories due for spaced repetition review."""
    limit = request.args.get('limit', 20, type=int)
    results = get_due_reviews(current_user_id(), limit=min(limit, 50))
    return jsonify({'data': results})


@bp.post('/review')
@login_required
def submit_review():
    """Submit a review grade (quality 0-5) for a knowledge memory."""
    data = request.get_json(silent=True) or {}
    memory_id = (data.get('memoryId') or '').strip()
    quality = data.get('quality')

    if not memory_id or quality is None:
        return jsonify({'message': 'memoryId and quality are required', 'code': 'VALIDATION_ERROR'}), 400

    try:
        quality = int(quality)
        if quality < 0 or quality > 5:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({'message': 'quality must be an integer 0-5', 'code': 'VALIDATION_ERROR'}), 400

    response_time = int(data.get('responseTimeSeconds', 0))

    memory = record_review(memory_id, current_user_id(), quality, response_time)
    if not memory:
        return jsonify({'message': '知识记忆不存在', 'code': 'NOT_FOUND'}), 404

    return jsonify({'data': memory, 'message': '复习已记录'})


# ---------------------------------------------------------------------------
# Single memory CRUD
# ---------------------------------------------------------------------------

@bp.get('/<memory_id>')
@login_required
def detail(memory_id: str):
    """Get single memory with review history."""
    memory = get_memory(memory_id, current_user_id())
    if not memory:
        return jsonify({'message': '知识记忆不存在', 'code': 'NOT_FOUND'}), 404
    return jsonify({'data': memory})


@bp.put('/<memory_id>')
@login_required
def update(memory_id: str):
    """Update a knowledge memory."""
    data = request.get_json(silent=True) or {}
    memory = update_memory(memory_id, current_user_id(), data)
    if not memory:
        return jsonify({'message': '知识记忆不存在', 'code': 'NOT_FOUND'}), 404
    return jsonify({'data': memory, 'message': '更新成功'})


@bp.delete('/<memory_id>')
@login_required
def archive(memory_id: str):
    """Archive (soft-delete) a knowledge memory."""
    ok = delete_memory(memory_id, current_user_id())
    if not ok:
        return jsonify({'message': '知识记忆不存在', 'code': 'NOT_FOUND'}), 404
    return jsonify({'message': '已归档'})


@bp.post('/<memory_id>/restore')
@login_required
def restore(memory_id: str):
    """Unarchive a knowledge memory."""
    ok = restore_memory(memory_id, current_user_id())
    if not ok:
        return jsonify({'message': '知识记忆不存在', 'code': 'NOT_FOUND'}), 404
    return jsonify({'message': '已恢复'})


# ---------------------------------------------------------------------------
# Consolidation
# ---------------------------------------------------------------------------

@bp.get('/consolidation-candidates')
@login_required
def consolidation_candidates():
    """Get AI-suggested memory pairs to merge."""
    candidates = find_consolidation_candidates(current_user_id())
    return jsonify({'data': candidates})


@bp.post('/consolidate')
@login_required
def consolidate():
    """Merge specified memories into one."""
    data = request.get_json(silent=True) or {}
    memory_ids = data.get('memoryIds') or []
    if not isinstance(memory_ids, list) or len(memory_ids) < 2:
        return jsonify({'message': '至少需要 2 条记忆 ID', 'code': 'VALIDATION_ERROR'}), 400

    new_title = str(data.get('title') or '').strip()
    new_content = str(data.get('content') or '').strip()

    result = consolidate_memories(current_user_id(), memory_ids, new_title, new_content)
    if not result:
        return jsonify({'message': '整合失败，请检查记忆是否存在', 'code': 'CONSOLIDATION_ERROR'}), 400

    return jsonify({'data': result, 'message': f'已整合为一条新记忆'})


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@bp.get('/export')
@login_required
def export_data():
    """Export all knowledge memories as JSON."""
    result = export_memories(current_user_id())
    return jsonify({'data': result})
