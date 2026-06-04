import json

from blueprints.practice import normalize_question
from services.learning_service import build_generated_question, fallback_practice_question


def test_fallback_practice_question_uses_readable_chinese_text():
    weak_point = {'id': 'wp-1', 'knowledge_name': '\u4e00\u6b21\u51fd\u6570'}

    question = fallback_practice_question('q-1', weak_point)

    user_facing_text = [
        question['knowledgeName'],
        question['questionText'],
        question['hint'],
        question['explanation'],
        *[choice['text'] for choice in question['choices']],
    ]

    assert question['knowledgeName'] == '\u4e00\u6b21\u51fd\u6570'
    assert all('?' not in text for text in user_facing_text)
    assert all(text for text in user_facing_text)
    assert '复习方式' not in question['questionText']
    assert '自查问题' not in question['questionText']
    assert any(token in question['questionText'] for token in ['函数', 'x', 'y', '解析式'])


def test_normalize_question_repairs_stored_placeholder_text():
    row = {
        'id': 'q-1',
        'weak_point_id': 'wp-1',
        'knowledge_name': '\u4e00\u6b21\u51fd\u6570',
        'question_text': '???\u4e00\u6b21\u51fd\u6570???????????????',
        'choices': json.dumps(
            [
                {'key': 'A', 'text': '??????????'},
                {'key': 'B', 'text': '??????????'},
                {'key': 'C', 'text': '????????'},
                {'key': 'D', 'text': '?????????'},
            ]
        ),
        'correct_answer': 'A',
        'hint': '????????????????????',
        'explanation': '??????????????????????????',
    }

    question = normalize_question(row)
    user_facing_text = [
        question['questionText'],
        question['hint'],
        question['explanation'],
        *[choice['text'] for choice in question['choices']],
    ]

    assert question['id'] == 'q-1'
    assert question['knowledgeName'] == '\u4e00\u6b21\u51fd\u6570'
    assert all('?' not in text for text in user_facing_text)


def test_build_generated_question_rejects_meta_template_question():
    weak_point = {'id': 'wp-1', 'knowledge_name': '\u4e00\u6b21\u51fd\u6570'}
    generated = {
        'questionText': '关于一次函数，下面哪一种复习方式最能检验你是否真正理解？',
        'choices': [
            {'key': 'A', 'text': '用自己的话说清定义、条件和例子'},
            {'key': 'B', 'text': '把教材原句连续抄写三遍'},
            {'key': 'C', 'text': '只看答案，不尝试回忆'},
            {'key': 'D', 'text': '跳过不熟的地方，直接下一题'},
        ],
        'correctAnswer': 'A',
        'hint': '先想这是什么、什么时候用。',
        'explanation': '这是一道模板题。',
    }

    question = build_generated_question('q-1', weak_point, generated)
    assert question is None
