import os
from typing import Optional


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RUNTIME_DIR = '/tmp' if os.getenv('VERCEL') else BASE_DIR
DATABASE_PATH = os.path.join(RUNTIME_DIR, 'learning.db')
UPLOAD_FOLDER = os.path.join(RUNTIME_DIR, 'uploads')
VECTOR_STORE_PATH = os.path.join(RUNTIME_DIR, 'vector_store')
ENABLE_VECTOR_SEARCH = os.getenv('ENABLE_VECTOR_SEARCH', '1').lower() in {'1', 'true', 'yes', 'on'}

MAX_CONTENT_LENGTH = 50 * 1024 * 1024
MAX_IMAGE_SIZE = 10 * 1024 * 1024
_cors_origins = os.getenv('CORS_ORIGINS', '')
CORS_ORIGINS = [
    origin.strip()
    for origin in _cors_origins.split(',')
    if origin.strip()
] or [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]

JWT_SECRET = os.getenv('JWT_SECRET', 'learning-platform-development-secret-v1')
JWT_EXPIRES_HOURS = 24 * 7


def _env_value(name: str) -> Optional[str]:
    value = (os.getenv(name) or '').strip()
    if not value:
        return None
    lowered = value.lower()
    if 'your-' in lowered or 'change-this' in lowered or 'placeholder' in lowered:
        return None
    return value


def _model_value(name: str, default: str, provider: str) -> str:
    value = _env_value(name)
    if value and (provider == 'deepseek' or not value.startswith('deepseek-')):
        return value
    return default


_ai_key = _env_value('AI_API_KEY')
_dashscope_key = _env_value('DASHSCOPE_API_KEY')
_deepseek_key = _env_value('DEEPSEEK_API_KEY')
_provider = 'deepseek' if _deepseek_key and not (_ai_key or _dashscope_key) else 'dashscope'

AI_API_KEY = _ai_key or _dashscope_key or _deepseek_key or ''
AI_BASE_URL = (
    _env_value('AI_BASE_URL')
    or (_env_value('DEEPSEEK_BASE_URL') if _provider == 'deepseek' else None)
    or 'https://dashscope.aliyuncs.com/compatible-mode/v1'
)
TEXT_MODEL = _model_value('TEXT_MODEL', 'qwen-plus', _provider)
VISION_MODEL = _model_value('VISION_MODEL', 'qwen-vl-max', _provider)

DEFAULT_PAGE_SIZE = 20
MAX_QA_ROUNDS = 5
MAX_FEYNMAN_ROUNDS = 20
MAX_ACTIVE_PATHS = 3
MAX_KNOWLEDGE_GRAPHS = 20
