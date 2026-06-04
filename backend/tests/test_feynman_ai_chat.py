from uuid import uuid4

from app import app


def register_user(client):
    suffix = uuid4().hex[:8]
    response = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'feynman-{suffix}@example.com',
            'username': f'feynman_{suffix}',
            'password': '123456',
        },
    )
    return response.get_json()['data']['token']


def test_feynman_explain_streams_real_ai_follow_up(monkeypatch):
    client = app.test_client()
    token = register_user(client)
    start = client.post(
        '/api/v1/feynman/start',
        headers={'Authorization': f'Bearer {token}'},
        json={'concept': '梯度下降'},
    )
    session_id = start.get_json()['data']['id']
    captured_messages = []

    def fake_stream_chat(messages, **_kwargs):
        captured_messages.extend(messages)
        yield 'event: stream\ndata: {"type":"text","content":"你刚才说会往低处走，"}\n\n'
        yield 'event: stream\ndata: {"type":"text","content":"那学习率太大会发生什么？"}\n\n'
        yield 'event: done\ndata: {"type":"done"}\n\n'

    monkeypatch.setattr('blueprints.feynman.stream_chat', fake_stream_chat)
    monkeypatch.setattr(
        'blueprints.feynman.log_interaction',
        lambda *_args, **_kwargs: {
            'id': 'interaction-1',
            'isLearning': True,
            'summary': '费曼学习：梯度下降',
            'knowledgePoints': ['梯度下降'],
            'weakPointCandidates': [],
        },
    )

    response = client.post(
        f'/api/v1/feynman/{session_id}/explain',
        headers={'Authorization': f'Bearer {token}'},
        json={'text': '梯度下降就是沿着损失函数变小的方向更新参数。'},
    )

    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'event: stream' in body
    assert '学习率太大' in body
    assert 'event: question' not in body
    prompt_text = '\n'.join(message['content'] for message in captured_messages)
    assert '费曼导师' in prompt_text
    assert '梯度下降' in prompt_text
    assert '沿着损失函数变小的方向' in prompt_text
