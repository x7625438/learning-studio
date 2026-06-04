import os
import sqlite3
from pathlib import Path

from flask import Blueprint, jsonify, request

import config
from auth import authenticate, create_access_token, create_user, current_user_id, login_required, public_user
from database import row_to_dict, transaction
from services.learning_service import ensure_profile

bp = Blueprint('auth', __name__, url_prefix='/api/v1/auth')


@bp.post('/register')
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip()
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or len(password) < 6:
        return jsonify({'message': '用户名和至少 6 位密码必填', 'code': 'VALIDATION_ERROR'}), 400
    try:
        user = create_user(username, password, email=email or None)
    except sqlite3.IntegrityError:
        return jsonify({'message': '用户名已存在', 'code': 'DUPLICATE_USER'}), 409
    ensure_profile(user['id'])
    token = create_access_token(user)
    return jsonify({'data': {'user': public_user(user), 'token': token}}), 201


@bp.post('/login')
def login():
    data = request.get_json(silent=True) or {}
    identifier = data.get('email') or data.get('username') or ''
    password = data.get('password') or ''
    user = authenticate(identifier, password)
    if not user:
        return jsonify({'message': '账号或密码错误', 'code': 'INVALID_CREDENTIALS'}), 401
    ensure_profile(user['id'])
    return jsonify({'data': {'user': public_user(user), 'token': create_access_token(user)}})


@bp.post('/logout')
@login_required
def logout():
    return jsonify({'data': {'ok': True}})


@bp.get('/me')
@login_required
def me():
    with transaction() as conn:
        row = conn.execute(
            'SELECT id, email, username, created_at, updated_at, last_login_at FROM users WHERE id = ?',
            (current_user_id(),),
        ).fetchone()
    if not row:
        return jsonify({'message': '用户不存在', 'code': 'USER_NOT_FOUND'}), 404
    return jsonify({'data': public_user(row_to_dict(row))})


@bp.delete('/me')
@login_required
def delete_me():
    user_id = current_user_id()
    files_to_delete = collect_user_files(user_id)
    with transaction() as conn:
        conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
    delete_files(files_to_delete)
    return jsonify({'data': {'ok': True}})


def collect_user_files(user_id: str) -> list[str]:
    paths: list[str] = []
    with transaction() as conn:
        for table, column in [
            ('qa_sessions', 'image_path'),
            ('textbooks', 'file_path'),
        ]:
            rows = conn.execute(f'SELECT {column} AS path FROM {table} WHERE user_id = ?', (user_id,)).fetchall()
            paths.extend(row['path'] for row in rows if row['path'])
    return paths


def delete_files(paths: list[str]) -> None:
    base_dir = Path(config.BASE_DIR).resolve()
    for raw_path in paths:
        path = Path(raw_path)
        if not path.is_absolute():
            path = base_dir / path
        try:
            resolved = path.resolve()
            if base_dir in resolved.parents or resolved == base_dir:
                os.remove(resolved)
        except OSError:
            continue
