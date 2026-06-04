from services.textbook_service import build_full_pdf_page_list, determine_total_pages


def test_build_full_pdf_page_list_returns_every_page():
    assert build_full_pdf_page_list(5) == [1, 2, 3, 4, 5]


def test_build_full_pdf_page_list_handles_empty_pdf():
    assert build_full_pdf_page_list(0) == []


def test_determine_total_pages_prefers_explicit_pdf_count():
    sections = [{'pageNum': 1}, {'pageNum': 2}]

    assert determine_total_pages(sections, pdf_page_count=186) == 186


def test_determine_total_pages_falls_back_to_sections():
    sections = [{'pageNum': 1}, {'pageNum': 6}, {'pageNum': 3}]

    assert determine_total_pages(sections, pdf_page_count=None) == 6
