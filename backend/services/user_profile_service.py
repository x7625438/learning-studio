"""
用户档案文档服务
为AI提供用户的个性化信息，包括学习风格、性格特点、兴趣爱好等
"""
from __future__ import annotations

from database import transaction


def get_user_profile_context(user_id: str) -> str:
    """
    获取用户档案上下文，供AI使用
    返回格式化的用户档案文本，如果不存在则返回空字符串
    """
    with transaction() as conn:
        row = conn.execute(
            'SELECT content FROM user_profile_document WHERE user_id = ?',
            (user_id,)
        ).fetchone()

    if not row or not row['content']:
        return ''

    content = row['content'].strip()
    if not content:
        return ''

    # 返回格式化的上下文
    return f"""
## 用户档案信息
以下是该用户的个性化档案，请根据这些信息调整你的回答风格和内容：

{content}

请基于以上用户档案信息，提供更个性化、更符合用户特点的回答。
"""


def should_include_profile(source_type: str) -> bool:
    """
    判断某个功能模块是否应该包含用户档案
    """
    # 所有主要交互模块都应该包含用户档案
    include_sources = {
        'qa',           # 即时问答
        'feynman',      # 费曼学习法
        'textbook',     # 教材问答
        'practice',     # 主动回想
        'learning_path', # 学习路径
    }
    return source_type in include_sources
