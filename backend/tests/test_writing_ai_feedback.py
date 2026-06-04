from uuid import uuid4

from app import app


def register_user(client):
    suffix = uuid4().hex[:8]
    response = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'writing-{suffix}@example.com',
            'username': f'writing_{suffix}',
            'password': '123456',
        },
    )
    return response.get_json()['data']['token']


def test_writing_feedback_uses_ai_feedback(monkeypatch):
    client = app.test_client()
    token = register_user(client)
    captured_messages = []

    start = client.post(
        '/api/v1/writing/start',
        headers={'Authorization': f'Bearer {token}'},
        json={'title': '申请文书', 'initialText': '我很喜欢计算机，因为它很有用。'},
    )
    session_id = start.get_json()['data']['id']

    def fake_chat_completion_json(messages, **_kwargs):
        captured_messages.extend(messages)
        return {
            'feedback': {
                'anchorText': '我很喜欢计算机',
                'feedbackText': '这段开头表达了兴趣，但缺少一个真实经历来支撑动机。',
                'suggestion': '补充一次你解决具体问题的经历，再说明它如何改变了你对计算机的理解。',
                'type': 'evidence',
                'position': {'start': 0, 'end': 7},
            },
            'report': {
                'argumentClarity': 68,
                'logicCoherence': 72,
                'languageExpression': 75,
                'overallScore': 71.7,
            },
        }

    monkeypatch.setattr('blueprints.writing_documents_graph.chat_completion_json', fake_chat_completion_json)
    monkeypatch.setattr(
        'blueprints.writing_documents_graph.log_interaction',
        lambda *_args, **_kwargs: {'id': 'interaction-1', 'isLearning': True},
    )

    response = client.post(
        f'/api/v1/writing/{session_id}/feedback',
        headers={'Authorization': f'Bearer {token}'},
        json={
            'text': '我很喜欢计算机，因为它很有用。',
            'instruction': '增加论据',
        },
    )

    assert response.status_code == 200
    payload = response.get_json()['data']
    assert payload['feedback']['feedbackText'] == '这段开头表达了兴趣，但缺少一个真实经历来支撑动机。'
    assert payload['feedback']['suggestion'].startswith('补充一次')
    assert payload['feedback']['type'] == 'evidence'
    assert payload['report']['overallScore'] == 71.7
    prompt_text = '\n'.join(message['content'] for message in captured_messages)
    assert '申请文书' in prompt_text
    assert '增加论据' in prompt_text
    assert '我很喜欢计算机' in prompt_text
