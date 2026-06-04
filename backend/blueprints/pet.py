"""
电子伴学宠物 API
"""
from flask import Blueprint, jsonify, request, g
from uuid import uuid4
from werkzeug.utils import secure_filename
import os

from auth import login_required
from database import get_db
from services.pet_service import chat_with_pet, log_user_action, load_user_memory
import config


bp = Blueprint('pet', __name__, url_prefix='/api/v1/pet')


def allowed_file(filename):
    """检查文件类型是否允许"""
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf', 'txt', 'doc', 'docx'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@bp.route('/chat', methods=['POST'])
@login_required
def chat():
    """与宠物对话"""
    user_id = g.user_id
    db = get_db()

    try:
        # 检查是否有文件上传
        files = []
        if 'files' in request.files:
            uploaded_files = request.files.getlist('files')
            for file in uploaded_files:
                if file and allowed_file(file.filename):
                    filename = secure_filename(file.filename)
                    file_id = str(uuid4())
                    file_ext = filename.rsplit('.', 1)[1].lower()
                    saved_filename = f'{file_id}.{file_ext}'

                    # 保存文件
                    upload_dir = os.path.join(config.UPLOAD_FOLDER, 'pet_uploads', user_id)
                    os.makedirs(upload_dir, exist_ok=True)
                    file_path = os.path.join(upload_dir, saved_filename)
                    file.save(file_path)

                    files.append({
                        'filename': filename,
                        'path': file_path,
                        'type': file_ext
                    })

        # 获取消息内容
        if request.content_type and 'multipart/form-data' in request.content_type:
            message = request.form.get('message', '').strip()
        else:
            data = request.get_json()
            message = data.get('message', '').strip()

        if not message and not files:
            return jsonify({'message': '消息不能为空'}), 400

        # 如果有文件，添加到消息中
        if files:
            file_info = '\n'.join([f'[文件: {f["filename"]}]' for f in files])
            message = f'{message}\n\n{file_info}' if message else file_info

        result = chat_with_pet(user_id, message, db)
        return jsonify(result)
    except Exception as e:
        return jsonify({'message': f'对话失败: {str(e)}'}), 500
    finally:
        db.close()


@bp.route('/history', methods=['GET'])
@login_required
def get_history():
    """获取对话历史"""
    user_id = g.user_id
    limit = request.args.get('limit', 50, type=int)

    db = get_db()
    try:
        conversations = db.execute(
            '''SELECT id, message, role, tool_calls, created_at
               FROM pet_conversations
               WHERE user_id = ?
               ORDER BY created_at DESC LIMIT ?''',
            (user_id, limit)
        ).fetchall()

        return jsonify({
            'conversations': [
                {
                    'id': conv['id'],
                    'message': conv['message'],
                    'role': conv['role'],
                    'toolCalls': conv['tool_calls'],
                    'createdAt': conv['created_at']
                }
                for conv in reversed(conversations)
            ]
        })
    finally:
        db.close()


@bp.route('/memory', methods=['GET'])
@login_required
def get_memory():
    """获取用户记忆档案"""
    user_id = g.user_id

    try:
        memory_content = load_user_memory(user_id)
        return jsonify({
            'content': memory_content,
            'exists': bool(memory_content)
        })
    except Exception as e:
        return jsonify({'message': f'获取记忆失败: {str(e)}'}), 500


@bp.route('/action', methods=['POST'])
@login_required
def track_action():
    """记录用户行为"""
    data = request.get_json()
    action_type = data.get('actionType', '')
    action_data = data.get('actionData', {})
    page = data.get('page', '')

    if not action_type:
        return jsonify({'message': '行为类型不能为空'}), 400

    user_id = g.user_id
    db = get_db()

    try:
        log_user_action(user_id, action_type, action_data, page, db)
        return jsonify({'message': '行为已记录'})
    except Exception as e:
        return jsonify({'message': f'记录失败: {str(e)}'}), 500
    finally:
        db.close()


@bp.route('/clear-history', methods=['POST'])
@login_required
def clear_history():
    """清空对话历史"""
    user_id = g.user_id
    db = get_db()

    try:
        db.execute('DELETE FROM pet_conversations WHERE user_id = ?', (user_id,))
        db.commit()
        return jsonify({'message': '对话历史已清空'})
    except Exception as e:
        db.rollback()
        return jsonify({'message': f'清空失败: {str(e)}'}), 500
    finally:
        db.close()
