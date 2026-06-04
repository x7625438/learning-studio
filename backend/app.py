import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from flask import Flask, jsonify, request
from flask_cors import CORS

import config
from auth import decode_token
from blueprints import BLUEPRINTS
from database import init_db
from extensions import scheduler, socketio
from scheduler.reminder import register_jobs


def create_app() -> Flask:
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH
    CORS(app, origins=config.CORS_ORIGINS, supports_credentials=True)

    os.makedirs(config.UPLOAD_FOLDER, exist_ok=True)
    init_db()

    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)

    @app.get('/api/health')
    def health():
        return jsonify({'data': {'status': 'ok', 'service': 'ai-learning-platform'}})

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify({'message': '文件超过 50MB 限制', 'code': 'FILE_TOO_LARGE'}), 413

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({'message': '内容不存在或已被删除', 'code': 'NOT_FOUND'}), 404

    @app.errorhandler(Exception)
    def server_error(error):
        app.logger.exception(error)
        return jsonify({'message': '服务开小差了，请稍后重试', 'code': 'INTERNAL_ERROR'}), 500

    return app


app = create_app()
socketio.init_app(app, cors_allowed_origins=config.CORS_ORIGINS)
register_jobs()
if not scheduler.running:
    scheduler.start()


@socketio.on('connect', namespace='/ws')
def socket_connect(auth):
    token = None
    if isinstance(auth, dict):
        token = auth.get('token')
    token = token or request.args.get('token')
    payload = decode_token(token) if token else None
    if not payload:
        return False
    from flask_socketio import join_room

    join_room(f'user:{payload["sub"]}')
    socketio.emit('pong', {}, namespace='/ws')
    return True


@socketio.on('ping', namespace='/ws')
def socket_ping(_payload=None):
    socketio.emit('pong', {}, namespace='/ws')


if __name__ == '__main__':
    port = int(os.getenv('PORT', '5000'))
    socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True)
