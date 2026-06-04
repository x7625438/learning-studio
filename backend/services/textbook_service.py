from __future__ import annotations

import re
from collections import defaultdict
from typing import Any


PAGE_MARKER_PATTERN = re.compile(r'^\[第(\d+)页\]\s*$', re.MULTILINE)
CHINESE_DIGITS = {
    '零': 0,
    '〇': 0,
    '一': 1,
    '二': 2,
    '两': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
}
QUERY_STOPWORDS = {
    '这页',
    '这一页',
    '那一页',
    '哪一页',
    '第页',
    '讲什么',
    '讲了什么',
    '是什么',
    '什么意思',
    '内容',
    '页',
    '第',
}


def split_textbook_sections(text: str, max_sections: int = 240) -> list[dict[str, Any]]:
    normalized = (text or '').replace('\r\n', '\n').strip()
    page_blocks = extract_page_blocks(normalized)

    sections: list[dict[str, Any]] = []
    paragraph_index = 0

    if page_blocks:
        for page_num, page_text in page_blocks:
            for paragraph in split_paragraphs(page_text):
                sections.append(
                    {
                        'pageNum': page_num,
                        'paragraphIndex': paragraph_index,
                        'text': paragraph,
                        'keyTerms': [],
                    }
                )
                paragraph_index += 1
                if len(sections) >= max_sections:
                    return sections
    else:
        for paragraph in split_paragraphs(normalized)[:max_sections]:
            sections.append(
                {
                    'pageNum': 1,
                    'paragraphIndex': paragraph_index,
                    'text': paragraph,
                    'keyTerms': [],
                }
            )
            paragraph_index += 1

    if sections:
        return sections

    return [
        {
            'pageNum': 1,
            'paragraphIndex': 0,
            'text': '文件已上传，但暂时没有解析出可供阅读的正文内容。你仍然可以围绕标题、页码或截图继续提问。',
            'keyTerms': [],
        }
    ]


def extract_page_blocks(text: str) -> list[tuple[int, str]]:
    matches = list(PAGE_MARKER_PATTERN.finditer(text))
    if not matches:
        return []

    blocks: list[tuple[int, str]] = []
    for index, match in enumerate(matches):
        page_num = int(match.group(1))
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        blocks.append((page_num, text[start:end].strip()))
    return blocks


def split_paragraphs(text: str) -> list[str]:
    return [paragraph.strip() for paragraph in re.split(r'\n\s*\n+', text or '') if paragraph.strip()]


def parse_page_numbers(text: str, total_pages: int) -> list[int]:
    pages: list[int] = []
    for match in re.finditer(r'第\s*([0-9零〇一二两三四五六七八九十百]+)\s*页', text or ''):
        page = parse_page_token(match.group(1))
        if page and (total_pages <= 0 or 1 <= page <= total_pages):
            pages.append(page)
    return dedupe_ints(pages)[:3]


def parse_page_token(token: str) -> int | None:
    token = (token or '').strip()
    if not token:
        return None
    if token.isdigit():
        return int(token)
    return chinese_number_to_int(token)


def chinese_number_to_int(token: str) -> int | None:
    token = token.strip()
    if not token:
        return None
    if token == '十':
        return 10
    if '百' in token:
        parts = token.split('百', 1)
        hundreds = CHINESE_DIGITS.get(parts[0], 1 if parts[0] else 1)
        remainder = chinese_number_to_int(parts[1]) if parts[1] else 0
        return hundreds * 100 + (remainder or 0)
    if '十' in token:
        parts = token.split('十', 1)
        tens = CHINESE_DIGITS.get(parts[0], 1) if parts[0] else 1
        ones = CHINESE_DIGITS.get(parts[1], 0) if parts[1] else 0
        return tens * 10 + ones
    return CHINESE_DIGITS.get(token)


def normalize_selected_pages(selected_pages: list[Any] | None, total_pages: int) -> list[int]:
    if not isinstance(selected_pages, list):
        return []
    valid = []
    for item in selected_pages:
        try:
            page = int(item)
        except (TypeError, ValueError):
            continue
        if total_pages <= 0 or 1 <= page <= total_pages:
            valid.append(page)
    return dedupe_ints(valid)


def build_full_pdf_page_list(total_pages: int) -> list[int]:
    if total_pages <= 0:
        return []
    return list(range(1, total_pages + 1))


def determine_total_pages(sections: list[dict[str, Any]], pdf_page_count: int | None = None) -> int:
    if pdf_page_count and pdf_page_count > 0:
        return pdf_page_count
    return max((int(section.get('pageNum') or 1) for section in sections), default=1)


def build_textbook_context(
    question: str,
    sections: list[dict[str, Any]],
    selected_text: str = '',
    selected_pages: list[int] | None = None,
    max_chars: int = 4500,
) -> dict[str, Any]:
    total_pages = max((int(section.get('pageNum') or 1) for section in sections), default=1)
    normalized_selected_pages = normalize_selected_pages(selected_pages, total_pages)

    if normalized_selected_pages:
        selected_sections = [
            section for section in sections if int(section.get('pageNum') or 1) in normalized_selected_pages
        ]
        if selected_sections:
            return {
                'pages': normalized_selected_pages,
                'context': join_sections(selected_sections, max_chars=max_chars),
                'strategy': 'selected-pages',
            }

    selected_sections = find_sections_for_selected_text(selected_text, sections)
    if selected_sections:
        return {
            'pages': unique_pages(selected_sections),
            'context': join_sections(selected_sections, max_chars=max_chars),
            'strategy': 'selection',
        }

    requested_pages = parse_page_numbers(question, total_pages)
    if requested_pages:
        requested_sections = [section for section in sections if int(section.get('pageNum') or 1) in requested_pages]
        if requested_sections:
            return {
                'pages': requested_pages,
                'context': join_sections(requested_sections, max_chars=max_chars),
                'strategy': 'page',
            }

    ranked_sections = rank_sections(question, sections)
    if ranked_sections:
        return {
            'pages': unique_pages(ranked_sections),
            'context': join_sections(ranked_sections, max_chars=max_chars),
            'strategy': 'retrieval',
        }

    fallback = sections[: min(8, len(sections))]
    return {
        'pages': unique_pages(fallback),
        'context': join_sections(fallback, max_chars=max_chars),
        'strategy': 'fallback',
    }


def find_sections_for_selected_text(selected_text: str, sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    needle = normalize_search_text(selected_text)
    if len(needle) < 6:
        return []

    matches = [section for section in sections if needle[:24] in normalize_search_text(section.get('text', ''))]
    if not matches:
        return []
    pages = unique_pages(matches)
    return [section for section in sections if int(section.get('pageNum') or 1) in pages][:10]


def rank_sections(question: str, sections: list[dict[str, Any]], top_k: int = 8) -> list[dict[str, Any]]:
    terms = extract_query_terms(question)
    if not terms:
        return sections[:top_k]

    scored: list[tuple[int, int, dict[str, Any]]] = []
    for index, section in enumerate(sections):
        normalized_text = normalize_search_text(section.get('text', ''))
        score = 0
        for term in terms:
            if term in normalized_text:
                score += len(term) * 3
        if score > 0:
            scored.append((score, -index, section))

    if not scored:
        return sections[:top_k]

    scored.sort(reverse=True)
    return [item[2] for item in scored[:top_k]]


def extract_query_terms(question: str) -> list[str]:
    normalized = normalize_search_text(question)
    for stopword in QUERY_STOPWORDS:
        normalized = normalized.replace(stopword, '')

    raw_terms = re.findall(r'[a-z0-9]{2,}|[\u4e00-\u9fff]{2,12}', normalized)
    weighted_terms: list[str] = []
    for term in raw_terms:
        if term in QUERY_STOPWORDS:
            continue
        weighted_terms.append(term)
        if len(term) >= 4 and re.fullmatch(r'[\u4e00-\u9fff]+', term):
            for size in range(min(6, len(term)), 1, -1):
                for start in range(0, len(term) - size + 1):
                    weighted_terms.append(term[start:start + size])
    return dedupe_strs(weighted_terms)[:24]


def join_sections(sections: list[dict[str, Any]], max_chars: int) -> str:
    grouped: dict[int, list[str]] = defaultdict(list)
    for section in sections:
        grouped[int(section.get('pageNum') or 1)].append(str(section.get('text') or '').strip())

    chunks: list[str] = []
    current_length = 0
    for page_num in sorted(grouped):
        block = f'[第{page_num}页]\n' + '\n\n'.join(text for text in grouped[page_num] if text)
        if current_length and current_length + len(block) > max_chars:
            break
        chunks.append(block)
        current_length += len(block)
    return '\n\n'.join(chunks).strip()


def normalize_search_text(text: str) -> str:
    return re.sub(r'\s+', '', (text or '').lower())


def unique_pages(sections: list[dict[str, Any]]) -> list[int]:
    pages = [int(section.get('pageNum') or 1) for section in sections]
    return dedupe_ints(pages)


def dedupe_ints(values: list[int]) -> list[int]:
    deduped: list[int] = []
    for value in values:
        if value not in deduped:
            deduped.append(value)
    return deduped


def dedupe_strs(values: list[str]) -> list[str]:
    deduped: list[str] = []
    for value in values:
        if value not in deduped:
            deduped.append(value)
    return deduped
