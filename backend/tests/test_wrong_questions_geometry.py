from blueprints.wrong_questions import (
    bp,
    build_deterministic_similar_questions,
    normalize_knowledge_points,
    same_knowledge_points,
    solve_canonical_geometry_question,
    solve_diameter_circle_question,
    solve_geometry_family,
    solve_parallel_quadrilateral_question,
    validate_geometry_consistency,
)
from auth import create_access_token
from database import init_db, json_dumps, transaction
import config
from flask import Flask


def test_deterministic_similar_geometry_keeps_diagram_answer_and_explanation_aligned():
    source = {
        'question_text': '如图，在△ABC中，AB=AC，点D在BC上，连接AD，若∠BAD=20°，∠ADC=100°，求∠B。',
        'difficulty': '中等',
        'knowledge_points': '["等腰三角形的性质", "三角形内角和"]',
    }

    questions = build_deterministic_similar_questions(source, 4)

    assert len(questions) == 4
    for question in questions:
        text = question['questionText']
        svg = question['diagramSvg']
        explanation = question['explanation']

        assert 'AB=AC' in text
        assert '点D在BC上' in text
        assert '连接AD' in text
        assert '<svg' in svg and '</svg>' in svg
        assert '>D<' in svg
        assert 'M160 40 L200 205' in svg
        assert 'cx="200" cy="205"' in svg
        assert question['answer']
        assert question['answer'] in explanation
        assert '△ABC' in explanation
        assert validate_geometry_consistency(text, svg, question['answer'], explanation) is True


def test_geometry_family_solver_uses_correct_base_angle_formula():
    solved = solve_geometry_family('如图，在△ABC中，AB=AC，点D在BC上，连接AD，若∠BAD=24°，∠ADC=108°，求∠B。')

    assert solved is not None
    assert solved['referenceAnswer'] == '48°'
    assert 'x = 48^\\circ' in solved['feedback']


def test_basic_isosceles_generation_does_not_introduce_auxiliary_points():
    source = {
        'question_text': '如图，在△ABC中，AB=AC，若∠A=50°，求∠B的度数。',
        'difficulty': '中等',
        'knowledge_points': '["等腰三角形的性质", "三角形内角和"]',
    }

    questions = build_deterministic_similar_questions(source, 3)

    assert len(questions) == 3
    for question in questions:
        assert '点D' not in question['questionText']
        assert '>D<' not in question['diagramSvg']
        assert '>A<' in question['diagramSvg']
        assert '>B<' in question['diagramSvg']
        assert '>C<' in question['diagramSvg']
        assert question['answer'] in question['explanation']
        assert validate_geometry_consistency(
            question['questionText'],
            question['diagramSvg'],
            question['answer'],
            question['explanation'],
        ) is True


def test_basic_isosceles_solver_handles_apex_and_base_angles():
    base_from_apex = solve_canonical_geometry_question('如图，在△ABC中，AB=AC，若∠A=52°，求∠C的度数。')
    apex_from_base = solve_canonical_geometry_question('如图，在△ABC中，AB=AC，若∠B=64°，求∠A的度数。')

    assert base_from_apex is not None
    assert base_from_apex['referenceAnswer'] == '64°'
    assert apex_from_base is not None
    assert apex_from_base['referenceAnswer'] == '52°'


def test_parallel_quadrilateral_generation_keeps_diagram_and_solution_aligned():
    source = {
        'question_text': '如图，在四边形ABCD中，AB∥CD，若∠A=70°，求∠D的度数。',
        'difficulty': '中等',
        'knowledge_points': '["平行线性质", "同旁内角互补"]',
    }

    questions = build_deterministic_similar_questions(source, 4)

    assert len(questions) == 4
    for question in questions:
        assert '四边形ABCD' in question['questionText']
        assert 'AB∥CD' in question['questionText']
        assert '>A<' in question['diagramSvg']
        assert '>B<' in question['diagramSvg']
        assert '>C<' in question['diagramSvg']
        assert '>D<' in question['diagramSvg']
        assert 'stroke-dasharray="5 5"' in question['diagramSvg']
        assert question['answer'] in question['explanation']
        assert validate_geometry_consistency(
            question['questionText'],
            question['diagramSvg'],
            question['answer'],
            question['explanation'],
        ) is True


def test_parallel_quadrilateral_solver_uses_same_side_interior_angles():
    solved = solve_parallel_quadrilateral_question('如图，在四边形ABCD中，AB∥CD，若∠A=70°，求∠D的度数。')

    assert solved is not None
    assert solved['referenceAnswer'] == '110°'
    assert '同旁内角互补' in solved['explanation']


def test_diameter_circle_generation_keeps_diagram_and_solution_aligned():
    source = {
        'question_text': '如图，在圆O中，AB是直径，点C在圆上，若∠A=50°，求∠B。',
        'difficulty': '中等',
        'knowledge_points': '["圆周角定理", "三角形内角和"]',
    }

    questions = build_deterministic_similar_questions(source, 4)

    assert len(questions) == 4
    for question in questions:
        assert '圆O' in question['questionText']
        assert 'AB是直径' in question['questionText']
        assert '点C在圆上' in question['questionText']
        assert '>A<' in question['diagramSvg']
        assert '>B<' in question['diagramSvg']
        assert '>C<' in question['diagramSvg']
        assert '>O<' in question['diagramSvg']
        assert '<circle cx="160" cy="120" r="82"' in question['diagramSvg']
        assert question['answer'] in question['explanation']
        assert validate_geometry_consistency(
            question['questionText'],
            question['diagramSvg'],
            question['answer'],
            question['explanation'],
        ) is True


def test_diameter_circle_solver_uses_angle_in_semicircle():
    acute = solve_diameter_circle_question('如图，在圆O中，AB是直径，点C在圆上，若∠A=38°，求∠B的度数。')
    right = solve_diameter_circle_question('如图，在圆O中，AB是直径，点C在圆上，若∠A=38°，求∠C的度数。')

    assert acute is not None
    assert acute['referenceAnswer'] == '52°'
    assert right is not None
    assert right['referenceAnswer'] == '90°'


def test_geometry_consistency_rejects_explanation_with_missing_points():
    question_text = '如图，在△ABC中，AB=AC，点D在BC上，连接AD，若∠ABD=42°，求∠C的度数。'
    svg = '<svg><text>A</text><text>B</text><text>C</text><text>D</text></svg>'

    assert validate_geometry_consistency(
        question_text,
        svg,
        '42°',
        '因为点 E 在 AC 上，所以 ∠AED=42°。',
    ) is False


def test_geometry_consistency_rejects_missing_svg_labels_and_segments():
    question_text = '如图，在△ABC中，AB=AC，点D在BC上，连接AD，若∠ABD=42°，求∠C的度数。'

    assert validate_geometry_consistency(
        question_text,
        '',
        '42°',
        '因为点 D 在 BC 上，所以 ∠ABD=∠ABC。',
    ) is False

    assert validate_geometry_consistency(
        question_text,
        '<svg><path d="M0 0 L10 10"/></svg>',
        '42°',
        '因为点 D 在 BC 上，所以 ∠ABD=∠ABC。',
    ) is False

    assert validate_geometry_consistency(
        question_text,
        '<svg><text>A</text><text>B</text><text>C</text></svg>',
        '42°',
        '因为点 D 在 BC 上，所以 ∠ABD=∠ABC。',
    ) is False

    assert validate_geometry_consistency(
        question_text,
        '<svg><text>A</text><text>B</text><text>C</text><text>D</text></svg>',
        '42°',
        '连接 EF 后可得 ∠EFD=42°。',
    ) is False


def test_geometry_consistency_rejects_answer_not_supported_by_explanation():
    question_text = '如图，在△ABC中，AB=AC，若∠A=50°，求∠B的度数。'
    svg = '<svg><text>A</text><text>B</text><text>C</text></svg>'

    assert validate_geometry_consistency(
        question_text,
        svg,
        '65°',
        '因为 AB=AC，所以底角相等。由内角和可得 ∠B=60°。',
    ) is False


def test_geometry_consistency_rejects_unverified_geometry_type_even_with_svg():
    question_text = '如图，在圆O中，直线PA与圆O相切于点A，若∠P=50°，求∠OAP。'
    svg = '<svg><text>O</text><text>P</text><text>A</text></svg>'

    assert validate_geometry_consistency(
        question_text,
        svg,
        '90°',
        '因为 PA 是切线，所以 OA⊥PA，∠OAP=90°。',
    ) is False


def test_knowledge_points_normalize_without_changing_order():
    points = normalize_knowledge_points('["等腰三角形的性质", "三角形内角和", "等腰三角形的性质", ""]')

    assert points == ['等腰三角形的性质', '三角形内角和']
    assert same_knowledge_points(points, ['等腰三角形的性质', '三角形内角和']) is True
    assert same_knowledge_points(points, ['三角形内角和', '等腰三角形的性质']) is False


def test_generate_similar_persists_original_wrong_question_knowledge_points(tmp_path, monkeypatch):
    db_path = tmp_path / 'learning.db'
    uploads_path = tmp_path / 'uploads'
    monkeypatch.setattr(config, 'DATABASE_PATH', str(db_path))
    monkeypatch.setattr(config, 'UPLOAD_FOLDER', str(uploads_path))
    monkeypatch.setattr('blueprints.wrong_questions.get_personalized_context', lambda _user_id: '')

    init_db()
    app = Flask(__name__)
    app.register_blueprint(bp)

    user = {'id': 'user-1', 'username': 'tester'}
    source_points = ['等腰三角形的性质', '三角形内角和']
    with transaction() as conn:
        conn.execute(
            "INSERT INTO users (id, email, username, password_hash) VALUES (?, ?, ?, ?)",
            ('user-1', 'tester@example.com', 'tester', 'x'),
        )
        conn.execute(
            """INSERT INTO wrong_questions
               (id, user_id, question_text, difficulty, knowledge_points, status)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                'wrong-1',
                'user-1',
                '如图，在△ABC中，AB=AC，点D在BC上，连接AD，若∠BAD=20°，∠ADC=100°，求∠B。',
                '中等',
                json_dumps(source_points),
                'pending',
            ),
        )

    token = create_access_token(user)
    response = app.test_client().post(
        '/api/v1/wrong-questions/wrong-1/generate-similar',
        json={'count': 2},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert len(payload['data']['questions']) == 2
    assert all(question['knowledgePoints'] == source_points for question in payload['data']['questions'])

    with transaction() as conn:
        stored = conn.execute(
            'SELECT knowledge_points FROM similar_questions WHERE wrong_question_id = ? ORDER BY created_at',
            ('wrong-1',),
        ).fetchall()
    assert [normalize_knowledge_points(row['knowledge_points']) for row in stored] == [source_points, source_points]


def test_generate_similar_skips_ai_geometry_with_inconsistent_solution(tmp_path, monkeypatch):
    db_path = tmp_path / 'learning.db'
    uploads_path = tmp_path / 'uploads'
    monkeypatch.setattr(config, 'DATABASE_PATH', str(db_path))
    monkeypatch.setattr(config, 'UPLOAD_FOLDER', str(uploads_path))
    monkeypatch.setattr('blueprints.wrong_questions.get_personalized_context', lambda _user_id: '')
    monkeypatch.setattr(
        'blueprints.wrong_questions.chat_completion_json',
        lambda *_args, **_kwargs: {
            'questions': [
                {
                    'questionText': '如图，在△ABC中，AB=AC，若∠A=40°，求∠B。',
                    'diagramSvg': '<svg><text>A</text><text>B</text><text>C</text></svg>',
                    'difficulty': '中等',
                }
            ]
        },
    )
    monkeypatch.setattr(
        'blueprints.wrong_questions.solve_similar_question_with_ai',
        lambda *_args, **_kwargs: {
            'referenceAnswer': '70°',
            'explanation': '连接 EF，在 ∠EFB 中可得答案为 70°。',
        },
    )

    init_db()
    app = Flask(__name__)
    app.register_blueprint(bp)

    user = {'id': 'user-1', 'username': 'tester'}
    with transaction() as conn:
        conn.execute(
            "INSERT INTO users (id, email, username, password_hash) VALUES (?, ?, ?, ?)",
            ('user-1', 'tester@example.com', 'tester', 'x'),
        )
        conn.execute(
            """INSERT INTO wrong_questions
               (id, user_id, question_text, difficulty, knowledge_points, status)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                'wrong-1',
                'user-1',
                '如图，在圆O中，直线PA与圆O相切于点A，若∠P=50°，求∠OAP。',
                '中等',
                json_dumps(['切线性质', '圆的半径']),
                'pending',
            ),
        )

    token = create_access_token(user)
    response = app.test_client().post(
        '/api/v1/wrong-questions/wrong-1/generate-similar',
        json={'count': 1},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['data']['questionIds'] == []
    assert payload['data']['questions'] == []

    with transaction() as conn:
        count = conn.execute('SELECT COUNT(*) AS total FROM similar_questions').fetchone()['total']
    assert count == 0
