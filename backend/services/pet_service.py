"""
电子伴学宠物服务
提供智能对话、用户行为追踪、记忆管理、工具调用等功能
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from duckduckgo_search import DDGS

import config
from services.ai_service import chat_completion_json, client


def get_user_memory_path(user_id: str) -> Path:
    """获取用户记忆文件路径"""
    memory_dir = Path(config.UPLOAD_FOLDER) / 'pet_memories'
    memory_dir.mkdir(parents=True, exist_ok=True)
    return memory_dir / f'{user_id}.md'


def load_user_memory(user_id: str) -> str:
    """加载用户记忆文件"""
    memory_path = get_user_memory_path(user_id)
    if memory_path.exists():
        return memory_path.read_text(encoding='utf-8')
    return ''


def save_user_memory(user_id: str, content: str) -> None:
    """保存用户记忆文件"""
    memory_path = get_user_memory_path(user_id)
    memory_path.write_text(content, encoding='utf-8')


def search_web(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    """使用 DuckDuckGo 搜索网络"""
    try:
        with DDGS() as ddgs:
            results = []
            for result in ddgs.text(query, max_results=max_results):
                results.append({
                    'title': result.get('title', ''),
                    'url': result.get('href', ''),
                    'snippet': result.get('body', '')
                })
            return results
    except Exception as e:
        return [{'error': str(e)}]


def get_available_tools() -> list[dict[str, Any]]:
    """获取宠物可用的工具列表"""
    return [
        {
            'type': 'function',
            'function': {
                'name': 'search_web',
                'description': '在互联网上搜索信息，获取最新的知识和资料',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'query': {
                            'type': 'string',
                            'description': '搜索关键词或问题'
                        }
                    },
                    'required': ['query']
                }
            }
        },
        {
            'type': 'function',
            'function': {
                'name': 'create_learning_path',
                'description': '为用户创建学习路径，规划学习计划',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'topic': {
                            'type': 'string',
                            'description': '学习主题，如"梯度下降"'
                        },
                        'goal': {
                            'type': 'string',
                            'description': '学习目标描述'
                        }
                    },
                    'required': ['topic']
                }
            }
        },
        {
            'type': 'function',
            'function': {
                'name': 'navigate_to_page',
                'description': '引导用户跳转到特定功能页面',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'page': {
                            'type': 'string',
                            'enum': ['learning-path', 'practice', 'textbook', 'calendar', 'profile', 'feynman', 'knowledge-graph'],
                            'description': '目标页面'
                        },
                        'reason': {
                            'type': 'string',
                            'description': '跳转原因，向用户解释为什么要去这个页面'
                        }
                    },
                    'required': ['page', 'reason']
                }
            }
        },
        {
            'type': 'function',
            'function': {
                'name': 'update_user_memory',
                'description': '更新用户记忆档案，记录重要的用户信息、偏好、学习状态等',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'memory_type': {
                            'type': 'string',
                            'enum': ['preference', 'goal', 'habit', 'knowledge', 'emotion', 'other'],
                            'description': '记忆类型'
                        },
                        'content': {
                            'type': 'string',
                            'description': '要记录的内容'
                        }
                    },
                    'required': ['memory_type', 'content']
                }
            }
        },
        {
            'type': 'function',
            'function': {
                'name': 'get_user_learning_status',
                'description': '获取用户当前的学习状态、进度、薄弱点等信息',
                'parameters': {
                    'type': 'object',
                    'properties': {},
                    'required': []
                }
            }
        }
    ]


def execute_tool(tool_name: str, arguments: dict[str, Any], user_id: str, db) -> dict[str, Any]:
    """执行工具调用"""
    try:
        if tool_name == 'search_web':
            query = arguments.get('query', '')
            results = search_web(query)
            return {
                'success': True,
                'results': results,
                'summary': f'找到 {len(results)} 条搜索结果'
            }

        elif tool_name == 'create_learning_path':
            topic = arguments.get('topic', '')
            goal = arguments.get('goal', '')

            # 记录到学习路径表
            path_id = str(uuid4())
            db.execute(
                '''INSERT INTO learning_paths (id, user_id, topic, goal, status, created_at)
                   VALUES (?, ?, ?, ?, 'pending', datetime('now'))''',
                (path_id, user_id, topic, goal)
            )
            db.commit()

            return {
                'success': True,
                'path_id': path_id,
                'message': f'已为"{topic}"创建学习路径，请前往学习路径页面查看详细规划'
            }

        elif tool_name == 'navigate_to_page':
            page = arguments.get('page', '')
            reason = arguments.get('reason', '')
            return {
                'success': True,
                'action': 'navigate',
                'page': page,
                'reason': reason
            }

        elif tool_name == 'update_user_memory':
            memory_type = arguments.get('memory_type', 'other')
            content = arguments.get('content', '')

            # 保存到数据库
            memory_id = str(uuid4())
            db.execute(
                '''INSERT INTO pet_user_memories (id, user_id, memory_content, memory_type, created_at)
                   VALUES (?, ?, ?, ?, datetime('now'))''',
                (memory_id, user_id, content, memory_type)
            )
            db.commit()

            # 更新 user.md 文件
            update_user_md(user_id, db)

            return {
                'success': True,
                'message': '已记录到记忆档案'
            }

        elif tool_name == 'get_user_learning_status':
            # 获取学习档案
            profile = db.execute(
                'SELECT * FROM learning_profile WHERE user_id = ?',
                (user_id,)
            ).fetchone()

            # 获取薄弱点
            weak_points = db.execute(
                '''SELECT knowledge_name, mastery_score, error_count
                   FROM weak_points
                   WHERE user_id = ? AND ignored = 0
                   ORDER BY mastery_score ASC LIMIT 5''',
                (user_id,)
            ).fetchall()

            # 获取学习路径
            paths = db.execute(
                '''SELECT topic, status, progress
                   FROM learning_paths
                   WHERE user_id = ? AND status != 'completed'
                   ORDER BY created_at DESC LIMIT 3''',
                (user_id,)
            ).fetchall()

            return {
                'success': True,
                'profile': dict(profile) if profile else None,
                'weak_points': [dict(wp) for wp in weak_points],
                'active_paths': [dict(p) for p in paths]
            }

        else:
            return {
                'success': False,
                'error': f'未知工具: {tool_name}'
            }

    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }


def update_user_md(user_id: str, db) -> None:
    """更新用户的 user.md 记忆文件"""
    # 获取用户基本信息
    user = db.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    profile = db.execute('SELECT * FROM learning_profile WHERE user_id = ?', (user_id,)).fetchone()

    # 获取所有记忆
    memories = db.execute(
        '''SELECT memory_type, memory_content, created_at
           FROM pet_user_memories
           WHERE user_id = ?
           ORDER BY created_at DESC''',
        (user_id,)
    ).fetchall()

    # 生成 markdown 内容
    content = f"""# 用户档案：{user['username'] if user else 'Unknown'}

## 基本信息
- 用户ID: {user_id}
- 注册时间: {user['created_at'] if user else 'Unknown'}
- 最后登录: {user['last_login_at'] if user else 'Unknown'}

## 学习档案
"""

    if profile:
        content += f"""- 学习目标: {profile['goal'] or '未设置'}
- 当前阶段: {profile['current_stage'] or '未设置'}
- 累计学习时长: {profile['total_study_hours'] or 0} 小时
- 连续学习天数: {profile['streak_days'] or 0} 天
- 自我介绍: {profile['self_introduction'] or '未填写'}
"""

    # 按类型分组记忆
    memory_groups = {}
    for mem in memories:
        mem_type = mem['memory_type']
        if mem_type not in memory_groups:
            memory_groups[mem_type] = []
        memory_groups[mem_type].append({
            'content': mem['memory_content'],
            'time': mem['created_at']
        })

    # 写入各类记忆
    type_names = {
        'preference': '偏好与习惯',
        'goal': '目标与规划',
        'habit': '学习习惯',
        'knowledge': '知识掌握',
        'emotion': '情绪与状态',
        'other': '其他记录'
    }

    for mem_type, type_name in type_names.items():
        if mem_type in memory_groups:
            content += f"\n## {type_name}\n"
            for mem in memory_groups[mem_type][:10]:  # 每类最多10条
                content += f"- {mem['content']} _({mem['time'][:10]})_\n"

    content += f"\n---\n_最后更新: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}_\n"

    # 保存文件
    save_user_memory(user_id, content)


def get_pet_system_prompt(user_id: str, db) -> str:
    """生成宠物的[REDACTED]"""
    # 加载用户记忆
    user_memory = load_user_memory(user_id)

    # 获取最近的用户行为
    recent_actions = db.execute(
        '''SELECT action_type, action_data, page, created_at
           FROM pet_user_actions
           WHERE user_id = ?
           ORDER BY created_at DESC LIMIT 10''',
        (user_id,)
    ).fetchall()

    actions_summary = '\n'.join([
        f"- {action['created_at'][:19]}: 在 {action['page'] or '未知页面'} 进行了 {action['action_type']}"
        for action in recent_actions
    ])

    return f"""你是一个可爱的电子伴学宠物，名字叫"小智"。你的职责是陪伴用户学习，帮助他们更好地掌握知识。

## 你的特点
- 温暖友善，像朋友一样陪伴用户
- 善于观察用户的学习行为和状态
- 会主动提醒和引导用户学习
- 能够记住用户的偏好和习惯
- 可以调用各种工具来帮助用户

## 用户档案
{user_memory if user_memory else '暂无用户记忆，这是你们的第一次对话'}

## 最近用户行为
{actions_summary if actions_summary else '暂无最近行为记录'}

## 你的能力
1. **回答问题** - 解答用户的学习疑问
2. **联网搜索** - 使用 search_web 工具搜索最新信息
3. **创建学习路径** - 使用 create_learning_path 为用户规划学习计划
4. **页面导航** - 使用 navigate_to_page 引导用户到合适的功能页面
5. **记忆管理** - 使用 update_user_memory 记录重要信息
6. **状态查询** - 使用 get_user_learning_status 了解用户学习情况

## 行为准则
- 主动关心用户的学习进度和状态
- 根据用户的薄弱点提供针对性建议
- 适时使用工具来提供更好的帮助
- 记住重要的用户信息（偏好、目标、习惯等）
- 用温暖、鼓励的语气交流
- 回答要简洁明了，不要过于冗长
- 涉及数学公式时使用 $...$（行内）和 $$...$$（块级）包裹，如 $x^2$

当前时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
"""


def chat_with_pet(user_id: str, message: str, db) -> dict[str, Any]:
    """与宠物对话"""
    # 获取历史对话（最近20条）
    history = db.execute(
        '''SELECT role, message, tool_calls
           FROM pet_conversations
           WHERE user_id = ?
           ORDER BY created_at DESC LIMIT 20''',
        (user_id,)
    ).fetchall()

    # 构建消息列表
    messages = [{'role': 'system', 'content': get_pet_system_prompt(user_id, db)}]

    # 添加历史消息（倒序）
    for msg in reversed(history):
        messages.append({
            'role': msg['role'],
            'content': msg['message']
        })

    # 添加当前用户消息
    messages.append({
        'role': 'user',
        'content': message
    })

    # 调用 AI
    tools = get_available_tools()
    response = client.chat.completions.create(
        model=config.TEXT_MODEL,
        messages=messages,
        tools=tools,
        tool_choice='auto',
        temperature=0.7
    )

    assistant_message = response.choices[0].message
    tool_calls = assistant_message.tool_calls or []

    # 执行工具调用
    tool_results = []
    navigation_action = None

    for tool_call in tool_calls:
        tool_name = tool_call.function.name
        arguments = json.loads(tool_call.function.arguments)

        result = execute_tool(tool_name, arguments, user_id, db)
        tool_results.append({
            'tool': tool_name,
            'arguments': arguments,
            'result': result
        })

        # 检查是否有导航动作
        if tool_name == 'navigate_to_page' and result.get('success'):
            navigation_action = {
                'page': result['page'],
                'reason': result['reason']
            }

    # 如果有工具调用，需要再次调用 AI 生成最终回复
    final_content = assistant_message.content

    if tool_calls:
        # 添加工具调用结果到消息
        assistant_msg = {
            'role': 'assistant',
            'content': assistant_message.content,
            'tool_calls': [
                {
                    'id': tc.id,
                    'type': 'function',
                    'function': {
                        'name': tc.function.name,
                        'arguments': tc.function.arguments
                    }
                }
                for tc in tool_calls
            ]
        }

        # 如果有 reasoning_content，也要传回
        if hasattr(assistant_message, 'reasoning_content') and assistant_message.reasoning_content:
            assistant_msg['reasoning_content'] = assistant_message.reasoning_content

        messages.append(assistant_msg)

        for i, tool_call in enumerate(tool_calls):
            messages.append({
                'role': 'tool',
                'tool_call_id': tool_call.id,
                'content': json.dumps(tool_results[i]['result'], ensure_ascii=False)
            })

        # 再次调用获取最终回复
        final_response = client.chat.completions.create(
            model=config.TEXT_MODEL,
            messages=messages,
            temperature=0.7
        )

        final_content = final_response.choices[0].message.content

    # 保存对话记录
    conv_id = str(uuid4())
    db.execute(
        '''INSERT INTO pet_conversations (id, user_id, message, role, tool_calls, created_at)
           VALUES (?, ?, ?, 'user', '[]', datetime('now'))''',
        (str(uuid4()), user_id, message)
    )

    db.execute(
        '''INSERT INTO pet_conversations (id, user_id, message, role, tool_calls, created_at)
           VALUES (?, ?, ?, 'assistant', ?, datetime('now'))''',
        (conv_id, user_id, final_content or '', json.dumps(tool_results))
    )

    db.commit()

    return {
        'message': final_content or '我在思考中...',
        'tool_calls': tool_results,
        'navigation': navigation_action
    }


def log_user_action(user_id: str, action_type: str, action_data: dict[str, Any], page: str, db) -> None:
    """记录用户行为"""
    action_id = str(uuid4())
    db.execute(
        '''INSERT INTO pet_user_actions (id, user_id, action_type, action_data, page, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))''',
        (action_id, user_id, action_type, json.dumps(action_data, ensure_ascii=False), page)
    )
    db.commit()

