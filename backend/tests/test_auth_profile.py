from uuid import uuid4

from app import app
from database import transaction


def test_register_login_and_profile_flow():
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

    profile = client.get('/api/v1/profile', headers={'Authorization': f'Bearer {token}'})
    assert profile.status_code == 200
    assert profile.get_json()['data']['profile']['userId']

    update = client.put(
        '/api/v1/profile',
        headers={'Authorization': f'Bearer {token}'},
        json={'goal': '备战考试', 'currentStage': '基础阶段'},
    )
    assert update.status_code == 200
    assert update.get_json()['data']['goal'] == '备战考试'


def test_protected_api_rejects_missing_token():
    client = app.test_client()
    response = client.get('/api/v1/profile')
    assert response.status_code == 401


def test_calendar_timer_finish_records_without_ai_analysis(monkeypatch):
    client = app.test_client()
    suffix = uuid4().hex[:8]
    register = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'timer-{suffix}@example.com',
            'username': f'timer_{suffix}',
            'password': '123456',
        },
    )
    token = register.get_json()['data']['token']
    user_id = register.get_json()['data']['user']['id']

    ai_analysis_calls = 0

    def track_ai_analysis(*_args, **_kwargs):
        nonlocal ai_analysis_calls
        ai_analysis_calls += 1
        return {
            'isLearning': True,
            'summary': '学习计时：自主学习',
            'knowledgePoints': ['自主学习'],
            'weaknessEvidence': False,
            'weakPointCandidates': [],
        }

    monkeypatch.setattr('services.learning_service.chat_completion_json', track_ai_analysis)

    response = client.post(
        '/api/v1/calendar/timer/finish',
        headers={'Authorization': f'Bearer {token}'},
        json={'minutes': 1, 'topic': '自主学习'},
    )

    assert response.status_code == 200
    assert response.get_json()['data']['minutes'] == 1
    assert ai_analysis_calls == 0
    with transaction() as conn:
        record = conn.execute(
            'SELECT study_minutes FROM study_records WHERE user_id = ?',
            (user_id,),
        ).fetchone()
        log = conn.execute(
            'SELECT source_type, user_input FROM interaction_logs WHERE user_id = ?',
            (user_id,),
        ).fetchone()
    assert record['study_minutes'] == 1
    assert log['source_type'] == 'calendar'
    assert '自主学习' in log['user_input']


def test_profile_total_study_hours_comes_from_study_records():
    client = app.test_client()
    suffix = uuid4().hex[:8]
    register = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'total-{suffix}@example.com',
            'username': f'total_{suffix}',
            'password': '123456',
        },
    )
    token = register.get_json()['data']['token']
    user_id = register.get_json()['data']['user']['id']

    client.post(
        '/api/v1/calendar/timer/finish',
        headers={'Authorization': f'Bearer {token}'},
        json={'minutes': 1, 'topic': '自主学习'},
    )
    with transaction() as conn:
        conn.execute(
            'UPDATE learning_profile SET total_study_hours = 0.6 WHERE user_id = ?',
            (user_id,),
        )

    response = client.get('/api/v1/profile', headers={'Authorization': f'Bearer {token}'})

    assert response.status_code == 200
    total_hours = response.get_json()['data']['profile']['totalStudyHours']
    assert total_hours == 1 / 60


def test_calendar_timer_preserves_seconds():
    client = app.test_client()
    suffix = uuid4().hex[:8]
    register = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'seconds-{suffix}@example.com',
            'username': f'seconds_{suffix}',
            'password': '123456',
        },
    )
    token = register.get_json()['data']['token']
    user_id = register.get_json()['data']['user']['id']

    response = client.post(
        '/api/v1/calendar/timer/finish',
        headers={'Authorization': f'Bearer {token}'},
        json={'seconds': 16, 'topic': '自主学习'},
    )

    assert response.status_code == 200
    assert response.get_json()['data']['seconds'] == 16
    profile = client.get('/api/v1/profile', headers={'Authorization': f'Bearer {token}'})
    payload = profile.get_json()['data']
    assert payload['profile']['totalStudyHours'] == 16 / 3600
    assert payload['today']['studySeconds'] == 16
    with transaction() as conn:
        record = conn.execute(
            'SELECT study_seconds, study_minutes FROM study_records WHERE user_id = ?',
            (user_id,),
        ).fetchone()
    assert record['study_seconds'] == 16
    assert record['study_minutes'] == 0


def test_calendar_monthly_heatmap_marks_sub_minute_study():
    client = app.test_client()
    suffix = uuid4().hex[:8]
    register = client.post(
        '/api/v1/auth/register',
        json={
            'email': f'heatmap-{suffix}@example.com',
            'username': f'heatmap_{suffix}',
            'password': '123456',
        },
    )
    token = register.get_json()['data']['token']

    client.post(
        '/api/v1/calendar/timer/finish',
        headers={'Authorization': f'Bearer {token}'},
        json={'seconds': 16, 'topic': '自主学习'},
    )

    response = client.get(
        '/api/v1/calendar/monthly',
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    today_cell = next(cell for cell in response.get_json()['data'] if cell['studySeconds'] == 16)
    assert today_cell['studyMinutes'] == 0
    assert today_cell['intensity'] == 1
