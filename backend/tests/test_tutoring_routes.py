from uuid import uuid4

from app import app


def register_user(client):
    suffix = uuid4().hex[:8]
    response = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'tutoring-{suffix}@example.com',
            'username': f'tutoring_{suffix}',
            'password': '123456',
        },
    )
    return response.get_json()['data']['token']


def test_tutoring_list_accepts_url_without_trailing_slash():
    client = app.test_client()
    token = register_user(client)

    response = client.get(
        '/api/v1/tutoring?limit=50',
        headers={'Authorization': f'Bearer {token}'},
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert response.get_json()['data'] == []


def test_tutoring_start_creates_guided_session(monkeypatch):
    client = app.test_client()
    token = register_user(client)

    monkeypatch.setattr(
        'blueprints.tutoring.chat_completion_json',
        lambda *_args, **_kwargs: {
            'subject': '数学',
            'difficulty': '中等',
            'knowledgePoints': ['二次函数'],
            'gradeLevel': '初中',
        },
    )
    monkeypatch.setattr(
        'blueprints.tutoring.chat_completion',
        lambda *_args, **_kwargs: '你先看看题目要求我们求什么？',
    )

    response = client.post(
        '/api/v1/tutoring/start',
        headers={'Authorization': f'Bearer {token}'},
        json={'problemText': '已知 f(x)=x²+2x-3，求最小值。'},
    )

    assert response.status_code == 201
    data = response.get_json()['data']
    assert data['sessionId']
    assert data['greeting'] == '你先看看题目要求我们求什么？'
    assert data['problemAnalysis']['knowledgePoints'] == ['二次函数']
