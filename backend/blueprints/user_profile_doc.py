from __future__ import annotations

from flask import Blueprint, jsonify, request

from auth import current_user_id, login_required
from database import row_to_dict, transaction
from services.learning_service import new_id

bp = Blueprint('user_profile_doc', __name__, url_prefix='/api/v1/user-profile-doc')


@bp.get('')
@login_required
def get_profile_doc():
    """获取用户档案文档"""
    user_id = current_user_id()
    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM user_profile_document WHERE user_id = ?',
            (user_id,)
        ).fetchone()

        if not row:
            # 如果不存在，创建默认文档
            doc_id = new_id()
            default_content = f"""# 用户档案

## 基本信息
- 用户ID: {user_id}
- 创建时间: 自动生成

## 学习风格
（待AI观察和记录）

## 性格特点
（待AI观察和记录）

## 兴趣爱好
（待AI观察和记录）

## 学习偏好
（待AI观察和记录）

## 交互历史洞察
（AI在与用户交互过程中发现的特点）
"""
            conn.execute(
                'INSERT INTO user_profile_document (id, user_id, content, version) VALUES (?, ?, ?, ?)',
                (doc_id, user_id, default_content, 1)
            )
            return jsonify({
                'data': {
                    'id': doc_id,
                    'userId': user_id,
                    'content': default_content,
                    'version': 1,
                    'lastUpdatedBy': None,
                    'lastUpdatedSource': None
                }
            })

        doc = row_to_dict(row)
        return jsonify({
            'data': {
                'id': doc['id'],
                'userId': doc['user_id'],
                'content': doc['content'],
                'version': doc['version'],
                'lastUpdatedBy': doc['last_updated_by'],
                'lastUpdatedSource': doc['last_updated_source'],
                'updatedAt': doc['updated_at']
            }
        })


@bp.put('')
@login_required
def update_profile_doc():
    """更新用户档案文档"""
    data = request.get_json(silent=True) or {}
    content = data.get('content', '').strip()
    source = data.get('source', 'manual')  # manual, qa, feynman, textbook, etc.

    if not content:
        return jsonify({'message': '内容不能为空', 'code': 'VALIDATION_ERROR'}), 400

    user_id = current_user_id()

    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM user_profile_document WHERE user_id = ?',
            (user_id,)
        ).fetchone()

        if not row:
            # 创建新文档
            doc_id = new_id()
            conn.execute(
                'INSERT INTO user_profile_document (id, user_id, content, version, last_updated_by, last_updated_source) VALUES (?, ?, ?, ?, ?, ?)',
                (doc_id, user_id, content, 1, user_id, source)
            )
            new_version = 1
        else:
            # 更新现有文档
            new_version = row['version'] + 1
            conn.execute(
                '''UPDATE user_profile_document
                   SET content = ?, version = ?, last_updated_by = ?, last_updated_source = ?, updated_at = datetime('now')
                   WHERE user_id = ?''',
                (content, new_version, user_id, source, user_id)
            )

    return jsonify({
        'message': '更新成功',
        'data': {
            'version': new_version,
            'source': source
        }
    })


@bp.post('/ai-update')
@login_required
def ai_update_profile_doc():
    """AI自动更新用户档案（追加模式）"""
    data = request.get_json(silent=True) or {}
    insights = data.get('insights', '').strip()
    source = data.get('source', 'ai')

    if not insights:
        return jsonify({'message': '洞察内容不能为空', 'code': 'VALIDATION_ERROR'}), 400

    user_id = current_user_id()

    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM user_profile_document WHERE user_id = ?',
            (user_id,)
        ).fetchone()

        if not row:
            # 创建新文档
            doc_id = new_id()
            content = f"""# 用户档案

## 基本信息
- 用户ID: {user_id}

## AI观察记录
{insights}
"""
            conn.execute(
                'INSERT INTO user_profile_document (id, user_id, content, version, last_updated_by, last_updated_source) VALUES (?, ?, ?, ?, ?, ?)',
                (doc_id, user_id, content, 1, 'ai', source)
            )
            new_version = 1
        else:
            # 追加到现有文档
            current_content = row['content']
            new_content = f"{current_content}\n\n---\n**更新时间**: {source} 模块\n{insights}"
            new_version = row['version'] + 1
            conn.execute(
                '''UPDATE user_profile_document
                   SET content = ?, version = ?, last_updated_by = ?, last_updated_source = ?, updated_at = datetime('now')
                   WHERE user_id = ?''',
                (new_content, new_version, 'ai', source, user_id)
            )

    return jsonify({
        'message': 'AI更新成功',
        'data': {
            'version': new_version
        }
    })
