from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any, Callable
from uuid import uuid4

import jwt
from flask import g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

import config
from database import row_to_dict, transaction


def hash_password(password: str) -> str:
    return generate_password_hash(password, method='pbkdf2:sha256')


def verify_password(password_hash: str, password: str) -> bool:
    return check_password_hash(password_hash, password)


def create_access_token(user: dict[str, Any]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        'sub': user['id'],
        'username': user['username'],
        'iat': int(now.timestamp()),
        'exp': int((now + timedelta(hours=config.JWT_EXPIRES_HOURS)).timestamp()),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm='HS256')


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, config.JWT_SECRET, algorithms=['HS256'])
    except jwt.PyJWTError:
        return None


def get_bearer_token() -> str | None:
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header.removeprefix('Bearer ').strip()
    return request.args.get('token')


def current_user_id() -> str:
    return getattr(g, 'user_id', '')


def login_required(handler: Callable) -> Callable:
    @wraps(handler)
    def wrapper(*args, **kwargs):
        token = get_bearer_token()
        payload = decode_token(token) if token else None
        if not payload:
            return jsonify({'message': 'Please log in again.', 'code': 'UNAUTHORIZED'}), 401

        user_id = payload['sub']
        with transaction() as conn:
            user_exists = conn.execute('SELECT 1 FROM users WHERE id = ?', (user_id,)).fetchone()

        if not user_exists:
            return jsonify({'message': 'User not found. Please log in again.', 'code': 'USER_NOT_FOUND'}), 401

        g.user_id = user_id
        g.user = payload
        return handler(*args, **kwargs)

    return wrapper


def create_user(username: str, password: str, email: str | None = None) -> dict[str, Any]:
    user_id = str(uuid4())
    normalized_username = username.strip()
    normalized_email = (email or '').lower().strip()
    internal_email = normalized_email or f'{normalized_username.lower()}@local.user'
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO users (id, email, username, password_hash)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, internal_email, normalized_username, hash_password(password)),
        )
        row = conn.execute(
            'SELECT id, email, username, created_at, updated_at, last_login_at FROM users WHERE id = ?',
            (user_id,),
        ).fetchone()
    return row_to_dict(row)


def authenticate(email_or_username: str, password: str) -> dict[str, Any] | None:
    identifier = email_or_username.lower().strip()
    with transaction() as conn:
        row = conn.execute(
            """
            SELECT * FROM users
            WHERE lower(email) = ? OR lower(username) = ?
            """,
            (identifier, identifier),
        ).fetchone()
        user = row_to_dict(row)
        if not user or not verify_password(user['password_hash'], password):
            return None
        conn.execute("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", (user['id'],))
    user.pop('password_hash', None)
    return user


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': user['id'],
        'username': user['username'],
        'createdAt': user.get('created_at'),
        'updatedAt': user.get('updated_at'),
        'lastLoginAt': user.get('last_login_at'),
    }
