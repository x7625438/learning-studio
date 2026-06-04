import time
from uuid import uuid4

from app import app
from blueprints import writing_documents_graph


def register_user(client):
    suffix = uuid4().hex[:8]
    response = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'graph-{suffix}@example.com',
            'username': f'graph_{suffix}',
            'password': '123456',
        },
    )
    return response.get_json()['data']['token']


def test_knowledge_graph_generate_uses_ai_nodes_and_edges(monkeypatch):
    client = app.test_client()
    token = register_user(client)
    captured_messages = []

    def fake_chat_completion_json(messages, **_kwargs):
        captured_messages.extend(messages)
        return {
            'summary': 'Machine learning studies algorithms that learn patterns from data.',
            'nodes': [
                {
                    'id': 'root',
                    'name': 'Machine Learning',
                    'description': 'The overall field.',
                    'level': 0,
                    'estimatedHours': 5,
                },
                {
                    'id': 'supervised-learning',
                    'name': 'Supervised Learning',
                    'description': 'Learning from labeled examples.',
                    'level': 1,
                    'estimatedHours': 8,
                },
                {
                    'id': 'model-evaluation',
                    'name': 'Model Evaluation',
                    'description': 'Measuring generalization quality.',
                    'level': 2,
                    'estimatedHours': 4,
                },
                {
                    'id': 'regularization',
                    'name': 'Regularization',
                    'description': 'Reducing overfitting in learned models.',
                    'level': 3,
                    'estimatedHours': 4,
                },
            ],
            'edges': [
                {
                    'sourceId': 'root',
                    'targetId': 'supervised-learning',
                    'relationType': 'includes',
                    'reason': 'Supervised learning is a central branch.',
                },
                {
                    'sourceId': 'supervised-learning',
                    'targetId': 'model-evaluation',
                    'relationType': 'prerequisite',
                    'reason': 'Evaluation is needed to compare models.',
                },
                {
                    'sourceId': 'model-evaluation',
                    'targetId': 'regularization',
                    'relationType': 'related',
                    'reason': 'Evaluation reveals when regularization is needed.',
                },
                {
                    'sourceId': 'missing',
                    'targetId': 'root',
                    'relationType': 'related',
                    'reason': 'This invalid edge should be removed.',
                },
            ],
        }

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', fake_chat_completion_json)

    response = client.post(
        '/api/v1/knowledge-graph/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={'topic': 'Machine Learning'},
    )

    assert response.status_code == 202
    job_id = response.get_json()['data']['jobId']
    payload = wait_for_graph_job(client, token, job_id)
    assert payload['summary'].startswith('Machine learning studies')
    assert [node['name'] for node in payload['nodes']] == [
        'Machine Learning',
        'Supervised Learning',
        'Model Evaluation',
        'Regularization',
    ]
    assert payload['nodes'][0]['masteryStatus'] == 'learning'
    assert payload['nodes'][1]['parentIds'] == ['root']
    assert len(payload['edges']) == 3
    assert all(edge['sourceId'] != 'missing' for edge in payload['edges'])
    prompt_text = '\n'.join(message['content'] for message in captured_messages)
    assert 'Machine Learning' in prompt_text
    assert 'knowledge points' in prompt_text


def test_knowledge_graph_generate_job_fails_when_ai_fails(monkeypatch):
    client = app.test_client()
    token = register_user(client)

    def fail_chat_completion_json(*_args, **_kwargs):
        raise RuntimeError('AI unavailable')

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', fail_chat_completion_json)

    response = client.post(
        '/api/v1/knowledge-graph/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={'topic': 'Linear Algebra'},
    )

    assert response.status_code == 202
    job_id = response.get_json()['data']['jobId']
    payload = wait_for_graph_job(client, token, job_id, expected_status='failed')
    assert payload['code'] == 'AI_GRAPH_FAILED'
    assert 'AI' in payload['message']


def test_knowledge_graph_retries_when_ai_json_is_invalid(monkeypatch):
    client = app.test_client()
    token = register_user(client)
    calls = []

    def fake_chat_completion_json(messages, **_kwargs):
        calls.append(messages)
        if len(calls) == 1:
            raise ValueError('empty AI response')
        return {
            'summary': 'Machine Learning connects data, models, training, and evaluation.',
            'nodes': [
                {'id': 'machine-learning', 'name': 'Machine Learning', 'description': 'The whole field.', 'level': 0, 'estimatedHours': 5},
                {'id': 'data', 'name': 'Data', 'description': 'Training examples.', 'level': 1, 'estimatedHours': 4},
                {'id': 'models', 'name': 'Models', 'description': 'Pattern learners.', 'level': 2, 'estimatedHours': 6},
                {'id': 'evaluation', 'name': 'Evaluation', 'description': 'Quality checks.', 'level': 2, 'estimatedHours': 4},
            ],
            'edges': [
                {'sourceId': 'machine-learning', 'targetId': 'data', 'relationType': 'includes', 'reason': 'Data is the input.'},
                {'sourceId': 'data', 'targetId': 'models', 'relationType': 'prerequisite', 'reason': 'Models learn from data.'},
                {'sourceId': 'models', 'targetId': 'evaluation', 'relationType': 'related', 'reason': 'Evaluation checks models.'},
            ],
        }

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', fake_chat_completion_json)

    response = client.post(
        '/api/v1/knowledge-graph/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={'topic': 'Machine Learning'},
    )

    assert response.status_code == 202
    payload = wait_for_graph_job(client, token, response.get_json()['data']['jobId'])
    assert payload['topic'] == 'Machine Learning'
    assert len(calls) == 2


def test_knowledge_graph_retries_when_ai_returns_wrong_topic(monkeypatch):
    client = app.test_client()
    token = register_user(client)
    calls = []

    def fake_chat_completion_json(messages, **_kwargs):
        calls.append(messages)
        if len(calls) == 1:
            return {
                'summary': 'Learning Architecture connects goals and study strategies.',
                'nodes': [
                    {'id': 'learning-architecture', 'name': 'Learning Architecture', 'description': 'Wrong topic.', 'level': 0, 'estimatedHours': 4},
                    {'id': 'goals', 'name': 'Goals', 'description': 'Learning goals.', 'level': 1, 'estimatedHours': 2},
                    {'id': 'practice', 'name': 'Practice', 'description': 'Study practice.', 'level': 2, 'estimatedHours': 3},
                    {'id': 'review', 'name': 'Review', 'description': 'Review cycle.', 'level': 2, 'estimatedHours': 3},
                ],
                'edges': [
                    {'sourceId': 'learning-architecture', 'targetId': 'goals', 'relationType': 'includes', 'reason': 'Goals guide learning.'},
                    {'sourceId': 'goals', 'targetId': 'practice', 'relationType': 'prerequisite', 'reason': 'Goals shape practice.'},
                    {'sourceId': 'practice', 'targetId': 'review', 'relationType': 'related', 'reason': 'Review improves practice.'},
                ],
            }
        return {
            'summary': 'Machine Learning connects data, models, training, and evaluation.',
            'nodes': [
                {'id': 'machine-learning', 'name': 'Machine Learning', 'description': 'The whole field.', 'level': 0, 'estimatedHours': 5},
                {'id': 'data', 'name': 'Data', 'description': 'Training examples.', 'level': 1, 'estimatedHours': 4},
                {'id': 'models', 'name': 'Models', 'description': 'Pattern learners.', 'level': 2, 'estimatedHours': 6},
                {'id': 'evaluation', 'name': 'Evaluation', 'description': 'Quality checks.', 'level': 2, 'estimatedHours': 4},
            ],
            'edges': [
                {'sourceId': 'machine-learning', 'targetId': 'data', 'relationType': 'includes', 'reason': 'Data is the input.'},
                {'sourceId': 'data', 'targetId': 'models', 'relationType': 'prerequisite', 'reason': 'Models learn from data.'},
                {'sourceId': 'models', 'targetId': 'evaluation', 'relationType': 'related', 'reason': 'Evaluation checks models.'},
            ],
        }

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', fake_chat_completion_json)

    response = client.post(
        '/api/v1/knowledge-graph/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={'topic': 'Machine Learning'},
    )

    assert response.status_code == 202
    payload = wait_for_graph_job(client, token, response.get_json()['data']['jobId'])
    assert payload['nodes'][0]['name'] == 'Machine Learning'
    assert len(calls) == 2


def test_knowledge_graph_retries_up_to_four_attempts(monkeypatch):
    client = app.test_client()
    token = register_user(client)
    calls = []

    def fake_chat_completion_json(messages, **_kwargs):
        calls.append(messages)
        if len(calls) < 4:
            return {'summary': 'Bad payload', 'nodes': [], 'edges': []}
        return {
            'summary': 'Gradient Descent optimizes models by following loss gradients.',
            'nodes': [
                {'id': 'gradient-descent', 'name': 'Gradient Descent', 'description': 'The optimization method.', 'level': 0, 'estimatedHours': 5},
                {'id': 'loss-function', 'name': 'Loss Function', 'description': 'Objective to minimize.', 'level': 1, 'estimatedHours': 3},
                {'id': 'gradient', 'name': 'Gradient', 'description': 'Direction of steepest increase.', 'level': 1, 'estimatedHours': 4},
                {'id': 'learning-rate', 'name': 'Learning Rate', 'description': 'Update step size.', 'level': 2, 'estimatedHours': 3},
            ],
            'edges': [
                {'sourceId': 'gradient-descent', 'targetId': 'loss-function', 'relationType': 'includes', 'reason': 'It minimizes a loss.'},
                {'sourceId': 'loss-function', 'targetId': 'gradient', 'relationType': 'prerequisite', 'reason': 'Gradients come from loss.'},
                {'sourceId': 'gradient', 'targetId': 'learning-rate', 'relationType': 'related', 'reason': 'Updates use both.'},
            ],
        }

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', fake_chat_completion_json)

    response = client.post(
        '/api/v1/knowledge-graph/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={'topic': 'Gradient Descent'},
    )

    assert response.status_code == 202
    payload = wait_for_graph_job(client, token, response.get_json()['data']['jobId'])
    assert payload['nodes'][0]['name'] == 'Gradient Descent'
    assert len(calls) == 4


def test_knowledge_graph_accepts_label_based_ai_schema(monkeypatch):
    client = app.test_client()
    token = register_user(client)

    def fake_chat_completion_json(*_args, **_kwargs):
        return {
            'summary': '梯度下降通过损失函数、梯度和学习率连接优化过程。',
            'nodes': [
                {'id': 1, 'label': '梯度下降', 'description': '核心优化算法', 'level': 0, 'estimatedHours': 4},
                {'id': 2, 'label': '损失函数', 'description': '优化目标', 'level': 1, 'estimatedHours': 3},
                {'id': 3, 'label': '梯度计算', 'description': '方向计算', 'level': 1, 'estimatedHours': 4},
                {'id': 4, 'label': '学习率', 'description': '更新步长', 'level': 2, 'estimatedHours': 3},
            ],
            'edges': [
                {'source': 1, 'target': 2, 'label': 'has'},
                {'source': 2, 'target': 3, 'label': 'requires'},
                {'source': 3, 'target': 4, 'label': 'related'},
            ],
        }

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', fake_chat_completion_json)

    response = client.post(
        '/api/v1/knowledge-graph/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={'topic': '梯度下降'},
    )

    assert response.status_code == 202
    payload = wait_for_graph_job(client, token, response.get_json()['data']['jobId'])
    assert [node['name'] for node in payload['nodes']] == ['梯度下降', '损失函数', '梯度计算', '学习率']
    assert payload['edges'][0]['relationType'] == 'includes'
    assert payload['edges'][1]['relationType'] == 'prerequisite'


def test_knowledge_graph_accepts_chinese_ai_node_ids(monkeypatch):
    client = app.test_client()
    token = register_user(client)

    def fake_chat_completion_json(*_args, **_kwargs):
        return {
            'summary': '机器学习由基础概念、监督学习、评估方法和正则化组成。',
            'nodes': [
                {'id': '机器学习', 'name': '机器学习', 'description': '整体主题', 'level': 0, 'estimatedHours': 5},
                {'id': '基础概念', 'name': '基础概念', 'description': '核心术语', 'level': 1, 'estimatedHours': 3},
                {'id': '监督学习', 'name': '监督学习', 'description': '标注数据学习', 'level': 2, 'estimatedHours': 6},
                {'id': '模型评估', 'name': '模型评估', 'description': '衡量泛化能力', 'level': 2, 'estimatedHours': 4},
            ],
            'edges': [
                {'sourceId': '机器学习', 'targetId': '基础概念', 'relationType': 'includes', 'reason': '基础概念是入口'},
                {'sourceId': '基础概念', 'targetId': '监督学习', 'relationType': 'prerequisite', 'reason': '先理解术语'},
                {'sourceId': '监督学习', 'targetId': '模型评估', 'relationType': 'related', 'reason': '需要评估效果'},
            ],
        }

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', fake_chat_completion_json)

    response = client.post(
        '/api/v1/knowledge-graph/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={'topic': '机器学习'},
    )

    assert response.status_code == 202
    job_id = response.get_json()['data']['jobId']
    payload = wait_for_graph_job(client, token, job_id)
    assert len(payload['edges']) == 3
    assert payload['edges'][0]['sourceId'] == payload['nodes'][0]['id']


def test_knowledge_graph_generate_job_completes_when_ai_is_slow(monkeypatch):
    client = app.test_client()
    token = register_user(client)

    def slow_chat_completion_json(*_args, **_kwargs):
        time.sleep(0.08)
        return {
            'summary': 'Calculus connects limits, derivatives, integrals, and applications.',
            'nodes': [
                {'id': 'root', 'name': 'Calculus', 'description': 'The whole subject.', 'level': 0, 'estimatedHours': 5},
                {'id': 'limits', 'name': 'Limits', 'description': 'Behavior near values.', 'level': 1, 'estimatedHours': 4},
                {'id': 'derivatives', 'name': 'Derivatives', 'description': 'Rates of change.', 'level': 2, 'estimatedHours': 6},
                {'id': 'integrals', 'name': 'Integrals', 'description': 'Accumulated change.', 'level': 2, 'estimatedHours': 6},
            ],
            'edges': [
                {'sourceId': 'root', 'targetId': 'limits', 'relationType': 'includes', 'reason': 'Limits are the entry point.'},
                {'sourceId': 'limits', 'targetId': 'derivatives', 'relationType': 'prerequisite', 'reason': 'Derivatives use limits.'},
                {'sourceId': 'limits', 'targetId': 'integrals', 'relationType': 'prerequisite', 'reason': 'Integrals rely on limit ideas.'},
            ],
        }

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', slow_chat_completion_json)
    monkeypatch.setattr('blueprints.writing_documents_graph.AI_GRAPH_TIMEOUT_SECONDS', 0.01)

    started_at = time.perf_counter()
    response = client.post(
        '/api/v1/knowledge-graph/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={'topic': 'Calculus'},
    )
    elapsed = time.perf_counter() - started_at

    assert response.status_code == 202
    assert elapsed < 0.06
    job_id = response.get_json()['data']['jobId']
    payload = wait_for_graph_job(client, token, job_id)
    assert payload['topic'] == 'Calculus'
    assert payload['summary'].startswith('Calculus connects')


def test_knowledge_graph_job_survives_memory_reset(monkeypatch):
    client = app.test_client()
    token = register_user(client)

    def fake_chat_completion_json(*_args, **_kwargs):
        return {
            'summary': 'Statistics connects data, probability, inference, and modeling.',
            'nodes': [
                {'id': 'root', 'name': 'Statistics', 'description': 'The whole subject.', 'level': 0, 'estimatedHours': 5},
                {'id': 'data', 'name': 'Data', 'description': 'Observed information.', 'level': 1, 'estimatedHours': 3},
                {'id': 'probability', 'name': 'Probability', 'description': 'Uncertainty rules.', 'level': 2, 'estimatedHours': 6},
                {'id': 'inference', 'name': 'Inference', 'description': 'Learning from samples.', 'level': 2, 'estimatedHours': 6},
            ],
            'edges': [
                {'sourceId': 'root', 'targetId': 'data', 'relationType': 'includes', 'reason': 'Data is the input.'},
                {'sourceId': 'data', 'targetId': 'probability', 'relationType': 'related', 'reason': 'Data has uncertainty.'},
                {'sourceId': 'probability', 'targetId': 'inference', 'relationType': 'prerequisite', 'reason': 'Inference uses probability.'},
            ],
        }

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', fake_chat_completion_json)

    response = client.post(
        '/api/v1/knowledge-graph/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={'topic': 'Statistics'},
    )

    assert response.status_code == 202
    job_id = response.get_json()['data']['jobId']
    wait_for_graph_job(client, token, job_id)
    writing_documents_graph.graph_jobs.clear()

    response = client.get(
        f'/api/v1/knowledge-graph/jobs/{job_id}',
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()['data']
    assert payload['status'] == 'completed'
    assert payload['graph']['topic'] == 'Statistics'


def wait_for_graph_job(client, token, job_id, expected_status='completed'):
    for _ in range(20):
        response = client.get(
            f'/api/v1/knowledge-graph/jobs/{job_id}',
            headers={'Authorization': f'Bearer {token}'},
        )
        assert response.status_code == 200
        payload = response.get_json()['data']
        if payload['status'] == expected_status:
            return payload['graph'] if expected_status == 'completed' else payload
        time.sleep(0.01)
    raise AssertionError(f'Graph job did not reach {expected_status}')
