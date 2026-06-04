from flask import Blueprint, jsonify, request

from auth import current_user_id, login_required
from services.learning_service import log_interaction

bp = Blueprint('interactions', __name__, url_prefix='/api/v1/interactions')


@bp.post('')
@login_required
def create_interaction():
    data = request.get_json(silent=True) or {}
    user_input = data.get('userInput') or data.get('user_input') or ''
    if not user_input.strip():
        return jsonify({'message': '输入不能为空', 'code': 'VALIDATION_ERROR'}), 400
    result = log_interaction(
        current_user_id(),
        data.get('sourceType') or data.get('source_type') or 'qa',
        user_input,
        data.get('aiResponse') or data.get('ai_response') or '',
        data.get('sourceId') or data.get('source_id'),
        data.get('knowledgePoints') or data.get('knowledge_points'),
    )
    return jsonify({'data': result}), 201
