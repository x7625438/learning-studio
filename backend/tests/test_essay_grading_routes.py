from uuid import uuid4

from app import app


def register_user(client):
    suffix = uuid4().hex[:8]
    response = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'essay-{suffix}@example.com',
            'username': f'essay_{suffix}',
            'password': '123456',
        },
    )
    assert response.status_code == 201
    return response.get_json()['data']['token']


def test_essay_grading_sessions_endpoint_requires_auth_without_redirect():
    client = app.test_client()

    response = client.get('/api/v1/essay-grading/sessions')

    assert response.status_code == 401
    assert response.location is None


def test_essay_grading_sessions_endpoint_lists_user_sessions():
    client = app.test_client()
    token = register_user(client)
    headers = {'Authorization': f'Bearer {token}'}

    empty = client.get('/api/v1/essay-grading/sessions', headers=headers)
    assert empty.status_code == 200
    assert empty.get_json()['data'] == []

    start = client.post(
        '/api/v1/essay-grading/start',
        headers=headers,
        json={
            'title': '测试作文',
            'essayText': '人工智能正在改变学习方式。我们可以利用它提高效率，但不能放弃独立思考。'
            '真正的学习需要提问、验证和修改，也需要把工具的帮助转化为自己的理解。',
            'examType': '高中',
            'rubricId': 'rubric-high-chinese',
        },
    )
    assert start.status_code == 201

    sessions = client.get('/api/v1/essay-grading/sessions', headers=headers)
    assert sessions.status_code == 200
    assert sessions.get_json()['data'][0]['title'] == '测试作文'
