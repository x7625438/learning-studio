from services.textbook_service import (
    build_textbook_context,
    normalize_selected_pages,
    parse_page_numbers,
    split_textbook_sections,
)


def test_split_textbook_sections_preserves_real_pdf_page_numbers():
    text = '[第1页]\n第一页第一段\n\n第一页第二段\n\n[第6页]\n第六页重点内容'

    sections = split_textbook_sections(text)

    assert [section['pageNum'] for section in sections] == [1, 1, 6]
    assert sections[2]['text'] == '第六页重点内容'


def test_parse_page_numbers_supports_chinese_numerals():
    assert parse_page_numbers('第六页讲的什么', total_pages=20) == [6]


def test_normalize_selected_pages_filters_and_dedupes():
    assert normalize_selected_pages([6, '7', 6, 'x', 99], total_pages=10) == [6, 7]


def test_build_textbook_context_prefers_selected_pages_over_page_query():
    sections = [
        {'pageNum': 1, 'paragraphIndex': 0, 'text': '第一页内容：有理数。'},
        {'pageNum': 6, 'paragraphIndex': 1, 'text': '第六页内容：二次根式的定义。'},
        {'pageNum': 7, 'paragraphIndex': 2, 'text': '第七页内容：二次根式的性质。'},
    ]

    result = build_textbook_context('第六页讲什么', sections, selected_pages=[7])

    assert result['pages'] == [7]
    assert result['strategy'] == 'selected-pages'
    assert '第七页内容：二次根式的性质。' in result['context']
    assert '第六页内容：二次根式的定义。' not in result['context']
