from pathlib import Path

import fitz

from services.pdf_translation import create_layout_translated_pdf, iter_layout_translated_pdf, should_translate_text


def test_should_translate_text_skips_page_numbers_and_urls():
    assert should_translate_text('DeepSeek-R1 improves reasoning.')
    assert not should_translate_text('12')
    assert not should_translate_text('https://example.com')
    assert not should_translate_text('research@example.com')


def test_create_layout_translated_pdf_replaces_text_visually(tmp_path):
    source = tmp_path / 'paper.pdf'
    output = tmp_path / 'paper.zh-CN.pdf'

    doc = fitz.open()
    page = doc.new_page(width=360, height=240)
    page.draw_rect(fitz.Rect(40, 60, 320, 180), color=(0, 0, 0), width=0.5)
    page.insert_textbox(
        fitz.Rect(54, 76, 306, 132),
        'Abstract\nThis paper introduces a reasoning model.',
        fontsize=12,
        fontname='helv',
    )
    doc.save(source)
    doc.close()

    calls = []

    def translator(text):
        calls.append(text)
        return '摘要\n本文介绍了一种推理模型。'

    translated_blocks = create_layout_translated_pdf(source, output, translator)

    assert output.exists()
    assert calls == ['Abstract\nThis paper introduces a reasoning model.']
    assert translated_blocks[0]['textCn'] == '摘要\n本文介绍了一种推理模型。'

    rendered_text = fitz.open(output)[0].get_text()
    assert '摘要' in rendered_text
    assert '模型' in rendered_text
    assert 'This paper introduces a reasoning model.' not in rendered_text


def test_create_layout_translated_pdf_batches_translatable_blocks_by_page(tmp_path):
    source = tmp_path / 'paper.pdf'
    output = tmp_path / 'paper.zh-CN.pdf'

    doc = fitz.open()
    page = doc.new_page(width=360, height=260)
    page.insert_textbox(fitz.Rect(40, 40, 320, 80), 'First English block.', fontsize=12, fontname='helv')
    page.insert_textbox(fitz.Rect(40, 120, 320, 160), 'Second English block.', fontsize=12, fontname='helv')
    doc.save(source)
    doc.close()

    batch_calls = []

    def batch_translator(texts):
        batch_calls.append(texts)
        return ['第一段中文。', '第二段中文。']

    translated_blocks = create_layout_translated_pdf(
        source,
        output,
        translator=lambda text: text,
        batch_translator=batch_translator,
    )

    assert batch_calls == [['First English block.', 'Second English block.']]
    assert [block['textCn'] for block in translated_blocks] == ['第一段中文。', '第二段中文。']


def test_iter_layout_translated_pdf_reports_page_progress_before_done(tmp_path):
    source = tmp_path / 'paper.pdf'
    output = tmp_path / 'paper.zh-CN.pdf'
    preview_dir = tmp_path / 'previews'

    doc = fitz.open()
    page = doc.new_page(width=360, height=220)
    page.insert_textbox(fitz.Rect(40, 40, 320, 80), 'First page block.', fontsize=12, fontname='helv')
    page = doc.new_page(width=360, height=220)
    page.insert_textbox(fitz.Rect(40, 40, 320, 80), 'Second page block.', fontsize=12, fontname='helv')
    doc.save(source)
    doc.close()

    events = list(
        iter_layout_translated_pdf(
            source,
            output,
            translator=lambda text: f'译文：{text}',
            preview_dir=preview_dir,
        )
    )

    progress_events = [event for event in events if event['event'] == 'progress']
    done_event = events[-1]

    assert [event['page'] for event in progress_events] == [1, 2]
    assert progress_events[0]['message'] == '已处理第 1/2 页'
    assert progress_events[0]['pagePreviewPath'].endswith('page-0001.png')
    assert (preview_dir / 'page-0001.png').exists()
    assert done_event['event'] == 'done'
    assert output.exists()


def test_create_layout_translated_pdf_preserves_chart_regions(tmp_path):
    source = tmp_path / 'chart.pdf'
    output = tmp_path / 'chart.zh-CN.pdf'

    doc = fitz.open()
    page = doc.new_page(width=420, height=320)
    page.insert_textbox(
        fitz.Rect(40, 34, 380, 74),
        'This paragraph should be translated.',
        fontsize=12,
        fontname='helv',
    )
    for index in range(8):
        x0 = 70 + index * 28
        page.draw_rect(fitz.Rect(x0, 150 - index * 3, x0 + 14, 260), color=(0.2, 0.4, 0.9), fill=(0.6, 0.7, 1))
    page.insert_textbox(fitz.Rect(80, 265, 170, 284), 'AIME 2024', fontsize=8, fontname='helv')
    page.insert_textbox(fitz.Rect(180, 265, 280, 284), 'Codeforces', fontsize=8, fontname='helv')
    doc.save(source)
    doc.close()

    calls = []

    def translator(text):
        calls.append(text)
        return '这段正文应该被翻译。'

    create_layout_translated_pdf(source, output, translator)

    rendered_text = fitz.open(output)[0].get_text()
    assert calls == ['This paragraph should be translated.']
    assert 'AIME 2024' in rendered_text
    assert 'Codeforces' in rendered_text


def test_full_page_background_image_does_not_protect_body_text(tmp_path):
    source = tmp_path / 'background.pdf'
    output = tmp_path / 'background.zh-CN.pdf'

    doc = fitz.open()
    page = doc.new_page(width=360, height=260)
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 2, 2), 0)
    pixmap.clear_with(255)
    page.insert_image(page.rect, pixmap=pixmap)
    page.insert_textbox(
        fitz.Rect(40, 40, 320, 90),
        'This body text should still be translated.',
        fontsize=12,
        fontname='helv',
    )
    doc.save(source)
    doc.close()

    calls = []

    def translator(text):
        calls.append(text)
        return '这段正文仍然应该被翻译。'

    create_layout_translated_pdf(source, output, translator)

    rendered_text = fitz.open(output)[0].get_text()
    assert calls == ['This body text should still be translated.']
    assert '正文' in rendered_text


def test_create_layout_translated_pdf_expands_text_box_instead_of_dropping_text(tmp_path):
    source = tmp_path / 'small-box.pdf'
    output = tmp_path / 'small-box.zh-CN.pdf'

    doc = fitz.open()
    page = doc.new_page(width=360, height=260)
    page.insert_textbox(
        fitz.Rect(40, 40, 190, 70),
        'Short abstract.',
        fontsize=12,
        fontname='helv',
    )
    doc.save(source)
    doc.close()

    long_translation = '这是一段明显比原文更长的中文译文，用来验证内容不会因为原始文本框太小而直接丢失。'
    create_layout_translated_pdf(source, output, lambda _text: long_translation)

    rendered_text = fitz.open(output)[0].get_text()
    assert '直接丢失' in ''.join(rendered_text.split())
