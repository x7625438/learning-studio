from __future__ import annotations

from io import BytesIO
from pathlib import Path
import re

import fitz
try:
    import numpy as np
except Exception:
    np = None
from docx import Document
from flask import Blueprint, Response, jsonify, request, send_file
from PyPDF2 import PdfReader
try:
    from rapidocr_onnxruntime import RapidOCR
except Exception:
    RapidOCR = None

from auth import current_user_id, login_required
from database import json_dumps, json_loads, transaction
from services.ai_service import compact_prompt, sse, stream_chat, stream_vision_chat
from services.learning_service import extract_knowledge, get_learning_context, log_interaction, new_id
from services.textbook_service import (
    build_textbook_context,
    determine_total_pages,
    normalize_selected_pages,
    parse_page_numbers,
    split_textbook_sections,
)
from services.search_service import format_search_results, search_web, should_search

bp = Blueprint('textbook', __name__, url_prefix='/api/v1/textbook')
ocr_engine = RapidOCR() if RapidOCR else None


def build_messages_with_context(system_prompt: str, user_prompt: str, user_id: str | None = None) -> list[dict]:
    """构建包含学习档案上下文的消息列表"""
    messages = [{'role': 'user', 'content': system_prompt}]

    # 添加学习档案上下文
    if user_id:
        learning_context = get_learning_context(user_id)
        if learning_context:
            messages.append({'role': 'user', 'content': learning_context})

    messages.append({'role': 'user', 'content': user_prompt})
    return messages


def extract_pdf_text(path: str) -> str:
    chunks: list[str] = []

    try:
        doc = fitz.open(path)
        try:
            for index, page in enumerate(doc, start=1):
                text = page.get_text('text').strip()
                if text:
                    chunks.append(f'[第{index}页]\n{text}')
            if chunks:
                return '\n\n'.join(chunks).strip()
        finally:
            doc.close()
    except Exception:
        pass

    try:
        reader = PdfReader(path)
        for index, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or '').strip()
            if text:
                chunks.append(f'[第{index}页]\n{text}')
    except Exception:
        chunks = []

    return '\n\n'.join(chunks).strip()


def extract_text(path: str, fallback: str = '') -> str:
    suffix = Path(path).suffix.lower()
    try:
        if suffix == '.pdf':
            text = extract_pdf_text(path)
            return text or fallback
        if suffix in {'.docx', '.doc'}:
            document = Document(path)
            paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
            return '\n\n'.join(paragraphs) or fallback
        if suffix == '.txt':
            return Path(path).read_text(encoding='utf-8', errors='ignore') or fallback
    except Exception:
        return fallback
    return fallback


def get_pdf_page_count(path: str | Path) -> int | None:
    try:
        doc = fitz.open(path)
        try:
            return doc.page_count
        finally:
            doc.close()
    except Exception:
        return None


def resolve_absolute_file_path(file_path: str | None) -> Path | None:
    if not file_path:
        return None
    path = Path(file_path)
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[1] / file_path
    try:
        resolved = path.resolve()
    except OSError:
        return None
    uploads_dir = (Path(__file__).resolve().parents[1] / 'uploads').resolve()
    if uploads_dir not in resolved.parents:
        return None
    return resolved


def file_type_from_name(file_name: str | None) -> str:
    return Path(file_name or '').suffix.lower().lstrip('.')


def has_meaningful_text(sections: list[dict], title: str) -> bool:
    combined = '\n'.join(section.get('text', '') for section in sections).strip()
    normalized = re.sub(r'\s+', '', combined)
    normalized_title = re.sub(r'\s+', '', title or '')
    return len(normalized) >= 120 and normalized != normalized_title


def render_pdf_pages(path: Path, pages: list[int], scale: float = 1.15) -> list[bytes]:
    doc = fitz.open(path)
    try:
        rendered: list[bytes] = []
        for page_num in pages:
            if 1 <= page_num <= doc.page_count:
                pixmap = doc.load_page(page_num - 1).get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                rendered.append(pixmap.tobytes('png'))
        return rendered
    finally:
        doc.close()


def render_pdf_page(path: Path, page_num: int, scale: float = 1.15) -> bytes | None:
    doc = fitz.open(path)
    try:
        if not (1 <= page_num <= doc.page_count):
            return None
        pixmap = doc.load_page(page_num - 1).get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        return pixmap.tobytes('png')
    finally:
        doc.close()


def ocr_pdf_pages(path: Path, pages: list[int]) -> dict[int, str]:
    if ocr_engine is None or np is None:
        return {}

    try:
        doc = fitz.open(path)
    except Exception:
        return {}

    try:
        chunks: dict[int, str] = {}
        for page_num in pages:
            if not (1 <= page_num <= doc.page_count):
                continue
            page = doc.load_page(page_num - 1)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(1.3, 1.3), alpha=False)
            image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height,
                pixmap.width,
                pixmap.n,
            )
            result, _ = ocr_engine(image)
            lines = [item[1].strip() for item in (result or []) if len(item) > 1 and str(item[1]).strip()]
            if lines:
                chunks[page_num] = '\n'.join(lines)
        return chunks
    finally:
        doc.close()


def expand_candidate_pages(page_numbers: list[int], total_pages: int) -> list[int]:
    if total_pages <= 0:
        return []
    if not page_numbers:
        return list(range(1, min(total_pages, 3) + 1))

    candidates: list[int] = []
    for page_num in page_numbers[:2]:
        for candidate in range(max(1, page_num - 1), min(total_pages, page_num + 1) + 1):
            if candidate not in candidates:
                candidates.append(candidate)
    return candidates[:5]


def select_relevant_ocr_context(question: str, page_texts: dict[int, str]) -> tuple[list[int], str]:
    normalized_question = re.sub(r'\s+', '', question or '')
    keywords = [token for token in re.findall(r'[\u4e00-\u9fff]{2,12}|[A-Za-z0-9]{2,}', normalized_question) if token]

    scored: list[tuple[int, int]] = []
    for page_num, text in page_texts.items():
        normalized_text = re.sub(r'\s+', '', text)
        score = 0
        for keyword in keywords:
            if keyword in normalized_text:
                score += len(keyword) * 3
        if score > 0:
            scored.append((score, page_num))

    if scored:
        scored.sort(reverse=True)
        selected_pages = [page_num for _, page_num in scored[:3]]
    else:
        selected_pages = list(page_texts.keys())[:3]

    context = '\n\n'.join(f'[第{page}页]\n{page_texts[page]}' for page in selected_pages if page in page_texts)
    return selected_pages, context.strip()


@bp.post('/upload')
@login_required
def upload():
    user_id = current_user_id()
    title = request.form.get('title') or '未命名教材'
    file = request.files.get('file')
    content = request.form.get('content') or ''
    file_name = file.filename if file else f'{title}.txt'
    file_path = None
    file_size = len(content.encode('utf-8'))
    pdf_page_count = None

    if file:
        upload_dir = Path(__file__).resolve().parents[1] / 'uploads'
        upload_dir.mkdir(exist_ok=True)
        stored_name = f'{user_id}-{new_id()}-{file_name}'
        absolute_path = upload_dir / stored_name
        file.save(absolute_path)
        file_path = f'uploads/{stored_name}'
        file_size = absolute_path.stat().st_size
        if file_name.lower().endswith('.pdf'):
            pdf_page_count = get_pdf_page_count(absolute_path)
        content = extract_text(str(absolute_path), fallback=title)

    sections = split_textbook_sections(content or title)
    textbook_id = new_id()
    glossary = [
        {'term': term, 'definition': f'{term} 是这份教材中的重点概念。', 'pageNum': 1}
        for term in extract_knowledge(content or title)
    ]
    total_pages = determine_total_pages(sections, pdf_page_count=pdf_page_count)
    readable_text = has_meaningful_text(sections, title)

    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO textbooks
            (id, user_id, title, file_name, file_path, file_size, total_pages, status, sections, glossary)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
            """,
            (
                textbook_id,
                user_id,
                title,
                file_name,
                file_path,
                file_size,
                total_pages,
                json_dumps(sections),
                json_dumps(glossary),
            ),
        )

    return (
        jsonify(
            {
                'data': {
                    'id': textbook_id,
                    'title': title,
                    'status': 'ready',
                    'sections': sections,
                    'glossary': glossary,
                    'fileName': file_name,
                    'fileType': file_type_from_name(file_name),
                    'fileUrl': f'/api/v1/textbook/{textbook_id}/file' if file_path else None,
                    'totalPages': total_pages,
                    'isScanned': file_type_from_name(file_name) == 'pdf' and not readable_text,
                }
            }
        ),
        201,
    )


@bp.get('/<textbook_id>/content')
@login_required
def content(textbook_id):
    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM textbooks WHERE id = ? AND user_id = ?',
            (textbook_id, current_user_id()),
        ).fetchone()
    if not row:
        return jsonify({'message': '教材不存在', 'code': 'NOT_FOUND'}), 404

    sections = json_loads(row['sections'], [])
    return jsonify(
        {
            'data': {
                'id': row['id'],
                'title': row['title'],
                'sections': sections,
                'glossary': json_loads(row['glossary'], []),
                'fileName': row['file_name'],
                'fileType': file_type_from_name(row['file_name']),
                'fileUrl': f'/api/v1/textbook/{row["id"]}/file' if row['file_path'] else None,
                'totalPages': int(row['total_pages'] or 1),
                'isScanned': file_type_from_name(row['file_name']) == 'pdf' and not has_meaningful_text(sections, row['title']),
            }
        }
    )


@bp.get('/<textbook_id>/file')
@login_required
def textbook_file(textbook_id):
    with transaction() as conn:
        row = conn.execute(
            'SELECT file_path, file_name FROM textbooks WHERE id = ? AND user_id = ?',
            (textbook_id, current_user_id()),
        ).fetchone()
    if not row:
        return jsonify({'message': '教材不存在', 'code': 'NOT_FOUND'}), 404

    absolute_path = resolve_absolute_file_path(row['file_path'])
    if not absolute_path or not absolute_path.exists():
        return jsonify({'message': '文件不存在', 'code': 'NOT_FOUND'}), 404

    return send_file(absolute_path, download_name=row['file_name'] or absolute_path.name, as_attachment=False)


@bp.get('/<textbook_id>/pages/<int:page_num>/image')
@login_required
def textbook_page_image(textbook_id: str, page_num: int):
    with transaction() as conn:
        row = conn.execute(
            'SELECT file_path, file_name FROM textbooks WHERE id = ? AND user_id = ?',
            (textbook_id, current_user_id()),
        ).fetchone()
    if not row:
        return jsonify({'message': '教材不存在', 'code': 'NOT_FOUND'}), 404
    if file_type_from_name(row['file_name']) != 'pdf':
        return jsonify({'message': '当前教材不是 PDF', 'code': 'VALIDATION_ERROR'}), 400

    absolute_path = resolve_absolute_file_path(row['file_path'])
    if not absolute_path or not absolute_path.exists():
        return jsonify({'message': '文件不存在', 'code': 'NOT_FOUND'}), 404

    image = render_pdf_page(absolute_path, page_num)
    if not image:
        return jsonify({'message': '页码不存在', 'code': 'NOT_FOUND'}), 404

    return send_file(BytesIO(image), mimetype='image/png')


@bp.post('/<textbook_id>/query')
@login_required
def query(textbook_id):
    user_id = current_user_id()
    data = request.get_json(silent=True) or {}
    question = data.get('userQuestion') or data.get('question') or ''
    paragraph = data.get('paragraph') or data.get('selectedText') or ''
    selected_pages_raw = data.get('selectedPages') or []
    if not question:
        return jsonify({'message': '问题不能为空', 'code': 'VALIDATION_ERROR'}), 400

    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM textbooks WHERE id = ? AND user_id = ?',
            (textbook_id, current_user_id()),
        ).fetchone()
    if not row:
        return jsonify({'message': '教材不存在', 'code': 'NOT_FOUND'}), 404

    all_sections = json_loads(row['sections'], [])
    total_pages = int(row['total_pages'] or max((int(section.get('pageNum') or 1) for section in all_sections), default=1))
    selected_pages = normalize_selected_pages(selected_pages_raw, total_pages)
    readable_text = has_meaningful_text(all_sections, row['title'])
    context_result = build_textbook_context(
        question,
        all_sections,
        selected_text=paragraph,
        selected_pages=selected_pages,
    )
    focused_context = context_result['context']
    focused_pages = context_result['pages']

    log_interaction(
        current_user_id(),
        'textbook',
        question,
        focused_context if readable_text else f'扫描版教材问题：{question}',
        textbook_id,
        should_update_weak_points=question not in {'这段内容的核心是什么？', '这段的核心概念是什么？'},
    )

    absolute_path = resolve_absolute_file_path(row['file_path'])

    # 只有当用户明确选择了页面时，才使用 PDF 图片模式
    user_selected_pages = bool(selected_pages_raw and len(selected_pages_raw) > 0)

    if user_selected_pages and absolute_path and file_type_from_name(row['file_name']) == 'pdf' and absolute_path.exists():
        pages_for_images = selected_pages
        if not pages_for_images:
            pages_for_images = [1]
        pages_for_images = normalize_selected_pages(pages_for_images, total_pages)

        if pages_for_images:
            def stream_selected_pages():
                yield sse(
                    'stream',
                    {
                        'type': 'text',
                        'content': f'正在读取第 {", ".join(str(page) for page in pages_for_images)} 页...',
                    },
                )
                selected_page_texts = ocr_pdf_pages(absolute_path, pages_for_images)
                selected_page_ocr_context = '\n\n'.join(
                    f'[第{page}页]\n{selected_page_texts[page]}'
                    for page in pages_for_images
                    if page in selected_page_texts
                ).strip()

                # DeepSeek 不支持图片，只使用 OCR 文本
                prompt = (
                    f'教材标题：{row["title"]}\n'
                    f'用户选中的页码：{", ".join(str(page) for page in pages_for_images)}\n'
                    f'问题：{question}\n'
                )
                if paragraph:
                    prompt += f'\n用户当前选中的文本片段：{paragraph}\n'
                if selected_page_ocr_context:
                    prompt += f'\n选中页的内容：\n{selected_page_ocr_context[:8000]}'
                elif focused_context:
                    prompt += f'\n系统提取的参考上下文：\n{focused_context[:6000]}'

                messages = build_messages_with_context(
                    '你是教材阅读助手。用户选中了特定页面，请严格依据这些页面的内容回答问题，不要脱离页面内容编造。',
                    prompt,
                    user_id
                )
                yield from stream_chat(messages, user_id=user_id)

            return Response(stream_selected_pages(), mimetype='text/event-stream')

    if readable_text and focused_context:
        # 判断是否需要搜索相关应用案例
        search_context = ''
        if should_search(question):
            search_query = f'{row["title"]} {question} 最新应用案例'
            search_results = search_web(search_query, max_results=3)
            if search_results:
                search_context = '\n\n' + format_search_results(search_results) + '\n'

        page_hint = f'命中的教材页：{", ".join(str(page) for page in focused_pages)}\n' if focused_pages else ''
        messages = build_messages_with_context(
            '你是教材阅读助手。必须严格依据检索到的教材原文回答。如果用户问的是某一页，就只围绕该页内容作答；无法确认时要明确说明，不要编造。',
            f'教材标题：{row["title"]}\n{page_hint}检索策略：{context_result["strategy"]}\n教材上下文：\n{focused_context}\n{search_context}\n问题：{question}',
            user_id
        )
        return Response(stream_chat(messages, user_id=user_id), mimetype='text/event-stream')

    if not absolute_path or file_type_from_name(row['file_name']) != 'pdf':
        messages = build_messages_with_context(
            '你是教材阅读助手。当前材料没有抽取出可靠正文。请明确说明限制，并尽量基于用户问题给出保守帮助。',
            f'教材标题：{row["title"]}\n问题：{question}',
            user_id
        )
        return Response(stream_chat(messages, user_id=user_id), mimetype='text/event-stream')

    page_numbers = parse_page_numbers(question, total_pages) or [1]
    candidate_pages = expand_candidate_pages(page_numbers, total_pages)
    page_texts = ocr_pdf_pages(absolute_path, candidate_pages) if candidate_pages else {}
    selected_ocr_pages, ocr_context = select_relevant_ocr_context(question, page_texts) if page_texts else ([], '')

    if ocr_context:
        messages = build_messages_with_context(
            '你是教材阅读助手。以下是从扫描版教材指定页面经 OCR 提取的文字。请严格依据这些文字作答；如果 OCR 可能有误，只能做保守推断，不要编造。',
            f'教材标题：{row["title"]}\n用户提到的页码：{", ".join(str(page) for page in page_numbers)}\n实际命中的 PDF 页：{", ".join(str(page) for page in selected_ocr_pages)}\nOCR 内容：\n{ocr_context}\n\n问题：{question}',
            user_id
        )
        return Response(stream_chat(messages, user_id=user_id), mimetype='text/event-stream')

    images = render_pdf_pages(absolute_path, page_numbers)
    if not images:
        messages = build_messages_with_context(
            '你是教材阅读助手。当前无法读取到指定页的文本或图像。请说明限制，并引导用户提供更明确的页码或截图。',
            f'教材标题：{row["title"]}\n问题：{question}',
            user_id
        )
        return Response(stream_chat(messages, user_id=user_id), mimetype='text/event-stream')

    prompt = (
        '你是教材阅读助手。下面会给你一到三张教材页图片。'
        '请严格基于图片中的内容回答问题；如果用户问的是某一页讲了什么，先概括该页主题，再补充要点。'
        f'教材标题：{row["title"]}\n'
        f'关注页码：{", ".join(str(page) for page in page_numbers)}\n'
        f'问题：{question}'
    )
    return Response(stream_vision_chat(prompt, images, user_id=user_id), mimetype='text/event-stream')
