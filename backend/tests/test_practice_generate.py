from uuid import uuid4

from app import app
from database import transaction


def test_generate_uses_qa_seed_weak_points_when_strict_filter_is_empty():
    client = app.test_client()
    suffix = uuid4().hex[:8]
    email = f'user-{suffix}@example.com'
    username = f'user_{suffix}'

    register = client.post(
        '/api/v1/auth/register',
        json={'email': email, 'username': username, 'password': '123456'},
    )
    assert register.status_code == 201
    token = register.get_json()['data']['token']
    headers = {'Authorization': f'Bearer {token}'}

    with transaction() as conn:
        user_id = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()['id']
        conn.execute(
            """
            INSERT INTO weak_points
            (id, user_id, knowledge_name, mastery_score, error_count, correct_count, source)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (str(uuid4()), user_id, '\\u4e00\\u6b21\\u51fd\\u6570', 55, 0, 0, 'qa'),
        )

    response = client.post('/api/v1/practice/generate', json={'targetCount': 5}, headers=headers)
    assert response.status_code == 200
    payload = response.get_json()['data']

    assert payload['targetCount'] >= 1
    assert len(payload['questions']) >= 1


def test_completed_practice_question_is_not_returned_or_counted_twice():
    client = app.test_client()
    suffix = uuid4().hex[:8]
    email = f'practice-{suffix}@example.com'
    username = f'practice_{suffix}'

    register = client.post(
        '/api/v1/auth/register',
        json={'email': email, 'username': username, 'password': '123456'},
    )
    assert register.status_code == 201
    token = register.get_json()['data']['token']
    headers = {'Authorization': f'Bearer {token}'}

    with transaction() as conn:
        user_id = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()['id']
        conn.execute(
            """
            INSERT INTO weak_points
            (id, user_id, knowledge_name, mastery_score, error_count, correct_count, source)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (str(uuid4()), user_id, '一次函数', 35, 1, 0, 'qa'),
        )

    generated = client.post('/api/v1/practice/generate', json={'targetCount': 1}, headers=headers)
    assert generated.status_code == 200
    question = generated.get_json()['data']['questions'][0]

    first_submit = client.post(
        '/api/v1/practice/submit',
        json={'questionId': question['id'], 'answer': question['correctAnswer'], 'feeling': 'remember'},
        headers=headers,
    )
    assert first_submit.status_code == 200

    duplicate_submit = client.post(
        '/api/v1/practice/submit',
        json={'questionId': question['id'], 'answer': question['correctAnswer'], 'feeling': 'remember'},
        headers=headers,
    )
    assert duplicate_submit.status_code == 200
    assert duplicate_submit.get_json()['data']['duplicate'] is True

    today_response = client.get('/api/v1/practice/today', headers=headers)
    assert today_response.status_code == 200
    payload = today_response.get_json()['data']
    assert payload['completedCount'] == 1
    assert payload['targetCount'] == 1
    assert payload['questions'] == []
