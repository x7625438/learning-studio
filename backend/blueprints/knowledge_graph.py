from __future__ import annotations

from flask import Blueprint, jsonify, request

from auth import current_user_id, login_required
from database import json_dumps, json_loads, row_to_dict, rows_to_dicts, transaction
from services.ai_service import chat_completion_json
from services.learning_service import get_learning_context, log_interaction, new_id
from services.search_service import format_search_results, search_web, should_search

bp = Blueprint('knowledge_graph', __name__, url_prefix='/api/v1/knowledge-graph')


@bp.post('/generate')
@login_required
def generate():
    user_id = current_user_id()
    data = request.get_json(silent=True) or {}
    topic = (data.get('topic') or '').strip()

    if not topic:
        return jsonify({'message': '请输入主题', 'code': 'INVALID_INPUT'}), 400

    # 创建任务记录
    job_id = new_id()
    graph_id = new_id()

    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO knowledge_graph_jobs (id, graph_id, user_id, topic, status)
            VALUES (?, ?, ?, ?, 'processing')
            """,
            (job_id, graph_id, user_id, topic),
        )

    # 异步生成知识图谱（这里简化为同步）
    try:
        graph_data = generate_knowledge_graph(topic, user_id)

        with transaction() as conn:
            conn.execute(
                """
                INSERT INTO knowledge_graphs (id, user_id, topic, nodes, edges, summary)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    graph_id,
                    user_id,
                    topic,
                    json_dumps(graph_data['nodes']),
                    json_dumps(graph_data['edges']),
                    graph_data.get('summary', ''),
                ),
            )
            conn.execute(
                "UPDATE knowledge_graph_jobs SET status = 'completed' WHERE id = ?",
                (job_id,),
            )

        # 记录到学习档案
        log_interaction(
            user_id,
            'knowledge_graph',
            f'生成知识图谱：{topic}',
            graph_data.get('summary', f'生成了关于{topic}的知识图谱'),
            graph_id,
            knowledge_points=[topic],
            should_update_weak_points=False,
        )

        return jsonify({'data': {'jobId': job_id, 'graphId': graph_id, 'topic': topic, 'status': 'processing'}}), 201

    except Exception as e:
        with transaction() as conn:
            conn.execute(
                "UPDATE knowledge_graph_jobs SET status = 'failed', message = ? WHERE id = ?",
                (str(e), job_id),
            )
        return jsonify({'message': '生成失败', 'code': 'GENERATION_FAILED'}), 500


@bp.get('/jobs/<job_id>')
@login_required
def get_job_status(job_id):
    user_id = current_user_id()

    with transaction() as conn:
        job = row_to_dict(
            conn.execute(
                'SELECT * FROM knowledge_graph_jobs WHERE id = ? AND user_id = ?',
                (job_id, user_id),
            ).fetchone()
        )

        if not job:
            return jsonify({'message': '任务不存在', 'code': 'NOT_FOUND'}), 404

        result = {
            'jobId': job['id'],
            'topic': job['topic'],
            'status': job['status'],
            'graphId': job.get('graph_id'),
        }

        if job['status'] == 'failed':
            result['message'] = job.get('message', '生成失败')

        if job['status'] == 'completed' and job.get('graph_id'):
            graph = row_to_dict(
                conn.execute(
                    'SELECT * FROM knowledge_graphs WHERE id = ?',
                    (job['graph_id'],),
                ).fetchone()
            )
            if graph:
                result['graph'] = normalize_graph(graph)

        return jsonify({'data': result})


@bp.get('/current')
@login_required
def get_current():
    user_id = current_user_id()

    with transaction() as conn:
        graph = row_to_dict(
            conn.execute(
                'SELECT * FROM knowledge_graphs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
                (user_id,),
            ).fetchone()
        )

    if not graph:
        return jsonify({'data': None})

    return jsonify({'data': normalize_graph(graph)})


@bp.put('/<graph_id>/node/<node_id>')
@login_required
def update_node(graph_id, node_id):
    user_id = current_user_id()
    data = request.get_json(silent=True) or {}
    mastery_status = data.get('masteryStatus')

    if mastery_status not in ['unvisited', 'learning', 'mastered']:
        return jsonify({'message': '无效的掌握状态', 'code': 'INVALID_INPUT'}), 400

    with transaction() as conn:
        graph = row_to_dict(
            conn.execute(
                'SELECT * FROM knowledge_graphs WHERE id = ? AND user_id = ?',
                (graph_id, user_id),
            ).fetchone()
        )

        if not graph:
            return jsonify({'message': '知识图谱不存在', 'code': 'NOT_FOUND'}), 404

        nodes = json_loads(graph['nodes'], [])
        updated = False

        for node in nodes:
            if node.get('id') == node_id:
                node['masteryStatus'] = mastery_status
                updated = True
                break

        if not updated:
            return jsonify({'message': '节点不存在', 'code': 'NOT_FOUND'}), 404

        conn.execute(
            'UPDATE knowledge_graphs SET nodes = ?, updated_at = datetime("now") WHERE id = ?',
            (json_dumps(nodes), graph_id),
        )

    return jsonify({'data': {'nodes': nodes}})


def normalize_graph(graph: dict) -> dict:
    return {
        'id': graph['id'],
        'userId': graph['user_id'],
        'topic': graph['topic'],
        'nodes': json_loads(graph.get('nodes'), []),
        'edges': json_loads(graph.get('edges'), []),
        'summary': graph.get('summary', ''),
        'createdAt': graph.get('created_at'),
        'updatedAt': graph.get('updated_at'),
    }


def generate_knowledge_graph(topic: str, user_id: str | None = None) -> dict:
    # 获取学习档案上下文
    learning_context = ''
    if user_id:
        learning_context = get_learning_context(user_id)

    # 判断是否需要搜索最新信息
    search_context = ''
    if should_search(topic):
        search_results = search_web(f'{topic} 知识体系 最新发展', max_results=3)
        if search_results:
            search_context = '\n\n' + format_search_results(search_results) + '\n请参考以上最新信息来构建知识图谱。\n'

    prompt = f"""
{learning_context}

为主题"{topic}"生成知识图谱。只返回 JSON，不要 markdown。
{search_context}
要求：
1. 根据用户的学习档案，优先展示与用户薄弱点相关的知识节点
2. 如果用户有明确的学习目标，确保图谱与目标对齐
3. 生成 5-10 个核心知识点节点
4. 每个节点包含：
   - id（唯一标识）
   - name（知识点名称）
   - description（简短描述）
   - level（难度等级，1-5）
   - masteryStatus（默认 'unvisited'）
   - estimatedHours（预计学习时长）
   - parentIds（前置知识点的id列表）
5. 生成节点之间的依赖关系边：
   - sourceId（源节点id）
   - targetId（目标节点id）
   - relationType（关系类型：'prerequisite'前置知识、'includes'包含、'related'相关）
   - reason（关系说明）
6. 提供整体学习路径的摘要

格式：
{{
  "nodes": [
    {{
      "id": "node-1",
      "name": "知识点名称",
      "description": "简短描述",
      "level": 1,
      "masteryStatus": "unvisited",
      "estimatedHours": 2,
      "parentIds": []
    }}
  ],
  "edges": [
    {{
      "sourceId": "node-1",
      "targetId": "node-2",
      "relationType": "prerequisite",
      "reason": "需要先掌握基础概念"
    }}
  ],
  "summary": "整体学习路径摘要"
}}
"""

    fallback = {
        'nodes': [
            {
                'id': 'node-1',
                'name': f'{topic}基础',
                'description': '基础概念和定义',
                'level': 1,
                'masteryStatus': 'unvisited',
                'estimatedHours': 3,
                'parentIds': [],
            },
            {
                'id': 'node-2',
                'name': f'{topic}进阶',
                'description': '深入理解和应用',
                'level': 2,
                'masteryStatus': 'unvisited',
                'estimatedHours': 5,
                'parentIds': ['node-1'],
            },
        ],
        'edges': [
            {
                'sourceId': 'node-1',
                'targetId': 'node-2',
                'relationType': 'prerequisite',
                'reason': '需要先掌握基础知识',
            },
        ],
        'summary': f'{topic}的学习路径',
    }

    try:
        result = chat_completion_json(
            [{'role': 'user', 'content': prompt}],
            fallback=fallback,
            temperature=0.5,
            user_id=user_id,
        )
        return result
    except Exception:
        return fallback
