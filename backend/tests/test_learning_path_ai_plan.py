from uuid import uuid4

from app import app


def register_user(client):
    suffix = uuid4().hex[:8]
    response = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'path-{suffix}@example.com',
            'username': f'path_{suffix}',
            'password': '123456',
        },
    )
    return response.get_json()['data']['token']


def test_learning_path_generate_uses_ai_week_plan(monkeypatch):
    client = app.test_client()
    token = register_user(client)
    captured_messages = []

    def fake_chat_completion_json(messages, **_kwargs):
        captured_messages.extend(messages)
        return {
            'weeks': [
                {
                    'weekNumber': 1,
                    'title': '建立极限和导数直觉',
                    'topics': ['函数极限', '导数定义', '常见求导法则'],
                    'exercises': ['完成 20 道极限与导数基础题', '用费曼法讲解导数定义'],
                    'reviewTopics': ['错题中的极限变形'],
                },
                {
                    'weekNumber': 2,
                    'title': '强化积分计算和应用',
                    'topics': ['不定积分', '定积分', '面积应用'],
                    'exercises': ['整理 10 个积分模板', '完成 1 套综合训练'],
                    'reviewTopics': ['换元法和分部积分的选择'],
                },
            ]
        }

    monkeypatch.setattr('blueprints.learning_path.chat_completion_json', fake_chat_completion_json)

    response = client.post(
        '/api/v1/learning-path/generate',
        headers={'Authorization': f'Bearer {token}'},
        json={
            'topic': '考研数学一',
            'currentLevel': 'beginner',
            'goal': 'exam',
            'hoursPerWeek': 8,
            'targetWeeks': 2,
        },
    )

    assert response.status_code == 201
    weeks = response.get_json()['data']['weeks']
    assert weeks[0]['title'] == '建立极限和导数直觉'
    assert weeks[0]['topics'] == ['函数极限', '导数定义', '常见求导法则']
    assert weeks[0]['status'] == 'in_progress'
    assert weeks[1]['status'] == 'pending'
    assert '核心概念 1' not in ' '.join(weeks[0]['topics'])
    prompt_text = '\n'.join(message['content'] for message in captured_messages)
    assert '考研数学一' in prompt_text
    assert 'beginner' in prompt_text
    assert '8 小时' in prompt_text
    assert '2 周' in prompt_text
