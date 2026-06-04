from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, request, send_file
from werkzeug.utils import secure_filename

import config
from auth import current_user_id, login_required
from database import json_dumps, json_loads, row_to_dict, rows_to_dicts, transaction
from services.ai_service import AIServiceError, chat_completion, chat_completion_json
from services.learning_service import new_id, upsert_weak_points
from services.pet_service import load_user_memory
from services.user_profile_service import get_user_profile_context

bp = Blueprint('wrong_questions', __name__, url_prefix='/api/v1/wrong-questions')

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def normalize_teacher_tone(text: str) -> str:
    normalized = str(text or '')
    replacements = (
        ('用户的', '你的'),
        ('学生的', '你的'),
        ('用户', '你'),
        ('学生', '你'),
        ('你可能', '你'),
        ('也许', ''),
        ('大概', ''),
        ('可能', ''),
        ('我认为', ''),
        ('我觉得', ''),
        ('不太确定', ''),
        ('似乎', ''),
        ('好像', ''),
    )
    for source, target in replacements:
        normalized = normalized.replace(source, target)
    normalized = re.sub(r'(?m)^\s*(不对|等等|等一下|让我想想|我们来一步步理清楚|先想一想)[^\n]*$', '', normalized)
    normalized = re.sub(r'\n{3,}', '\n\n', normalized)
    return normalized.strip()


def build_fallback_error_analysis(ai_response: dict) -> str:
    error_type = str(ai_response.get('errorType') or '思路偏差').strip()
    user_answer = str(ai_response.get('userAnswer') or '').strip()
    correct_answer = str(ai_response.get('correctAnswer') or '').strip()
    explanation = str(ai_response.get('explanation') or '').strip()
    knowledge_points = json_loads(json_dumps(ai_response.get('knowledgePoints', [])), [])
    knowledge_text = '、'.join([str(item).strip() for item in knowledge_points if str(item).strip()][:3]) or '题目中的关键条件'

    reason_line = f'你这道题的主要问题是{error_type}。'
    if user_answer and correct_answer and user_answer != correct_answer:
        reason_line = f'你这道题选了 {user_answer}，但正确答案是 {correct_answer}，主要问题是{error_type}。'

    explanation_summary = explanation.split('\n')[0].strip() if explanation else ''
    if len(explanation_summary) > 120:
        explanation_summary = explanation_summary[:120].rstrip() + '...'

    body = [
        '### 错在哪里',
        reason_line,
        '',
        '### 为什么会错',
        f'这道题不能只盯着单个数字或局部关系，而要把 {knowledge_text} 放在一起判断。'
        + (f' 正确思路的关键是：{explanation_summary}' if explanation_summary else ''),
        '',
        '### 下次怎么避免',
        '先圈出图形里的已知条件，再判断该用的性质或定理，最后再代入计算。只要顺着“条件 -> 性质 -> 结论”这条线检查，就不容易再走偏。',
    ]
    return '\n'.join(body)


def rewrite_error_analysis(ai_response: dict, user_id: str) -> str:
    prompt = f'''你是一位经验丰富的中学老师。请把下面这道错题的“错误分析”重写成给学生看的正式讲评稿。

要求：
1. 直接对学生说话，只用“你”，不要用“用户”“学生”“AI”“模型”。
2. 只输出最终讲评，不要暴露思考过程，不要出现“可能、也许、我觉得、我认为、似乎、好像、不对、等等、让我想想”。
3. 结构固定为三个小标题：`### 错在哪里`、`### 为什么会错`、`### 下次怎么避免`。
4. 每一部分都写完整句子，讲清楚，但不要空话套话。
5. 如果是数学题，要结合题目条件、图形关系或公式来讲，不要泛泛而谈。

题目信息：
- 题干：{ai_response.get('questionText', '')}
- 科目：{ai_response.get('subject', '')}
- 错误类型：{ai_response.get('errorType', '')}
- 你的答案：{ai_response.get('userAnswer', '')}
- 正确答案：{ai_response.get('correctAnswer', '')}
- 知识点：{json_dumps(ai_response.get('knowledgePoints', []))}
- 参考解法：{ai_response.get('explanation', '')}
- 原始错误分析：{ai_response.get('errorAnalysis', '')}
'''

    try:
        rewritten = chat_completion(
            [{'role': 'user', 'content': prompt}],
            temperature=0.2,
            model=config.TEXT_MODEL,
            user_id=user_id,
        )
    except Exception:
        rewritten = ''

    normalized = normalize_teacher_tone(rewritten)
    if not normalized:
        return build_fallback_error_analysis(ai_response)

    banned_patterns = ('我觉得', '我认为', '可能', '也许', '似乎', '好像', '不对', '等等', '让我想想')
    if any(pattern in normalized for pattern in banned_patterns):
        return build_fallback_error_analysis(ai_response)

    required_sections = ('### 错在哪里', '### 为什么会错', '### 下次怎么避免')
    if not all(section in normalized for section in required_sections):
        return build_fallback_error_analysis(ai_response)

    return normalized


def needs_error_analysis_refresh(text: str) -> bool:
    normalized = normalize_teacher_tone(text)
    if not normalized:
        return True

    required_sections = ('### 错在哪里', '### 为什么会错', '### 下次怎么避免')
    if not all(section in normalized for section in required_sections):
        return True

    banned_patterns = ('我觉得', '我认为', '可能', '也许', '似乎', '好像', '不对', '等等', '让我想想')
    return any(pattern in normalized for pattern in banned_patterns)


def finalize_error_analysis(ai_response: dict) -> str:
    normalized = normalize_teacher_tone(ai_response.get('errorAnalysis', ''))
    if needs_error_analysis_refresh(normalized):
        return build_fallback_error_analysis(ai_response)
    return normalized


def normalize_diagram_svg(svg_text: str) -> str:
    text = str(svg_text or '').strip()
    if not text:
        return ''
    match = re.search(r'<svg[\s\S]*?</svg>', text)
    if not match:
        return ''
    svg = match.group(0)
    svg = re.sub(r'<script[\s\S]*?</script>', '', svg, flags=re.IGNORECASE)
    svg = re.sub(r'on\w+="[^"]*"', '', svg)
    svg = re.sub(r'on\w+=\'[^\']*\'', '', svg)
    if 'viewBox=' not in svg:
        svg = svg.replace('<svg', '<svg viewBox="0 0 320 240"', 1)
    if 'xmlns=' not in svg:
        svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"', 1)
    return svg


def looks_like_geometry_question(text: str) -> bool:
    normalized = str(text or '')
    geometry_markers = ('如图', '△', '三角形', '四边形', '圆', '点', '线段', '角', '∠')
    return any(marker in normalized for marker in geometry_markers)


def render_canonical_geometry_svg(question_text: str) -> str:
    normalized = re.sub(r'\s+', '', str(question_text or ''))
    if '圆O' in normalized and ('AB是直径' in normalized or 'AB为直径' in normalized) and '点C在圆' in normalized:
        return '''<svg width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#fffaf0"/>
  <circle cx="160" cy="120" r="82" fill="none" stroke="#3f3f46" stroke-width="2.8"/>
  <path d="M78 120 L242 120" fill="none" stroke="#3f3f46" stroke-width="2.8"/>
  <path d="M78 120 L176 40 L242 120" fill="none" stroke="#3f3f46" stroke-width="2.4"/>
  <circle cx="78" cy="120" r="3.5" fill="#3f3f46"/>
  <circle cx="242" cy="120" r="3.5" fill="#3f3f46"/>
  <circle cx="176" cy="40" r="3.5" fill="#3f3f46"/>
  <circle cx="160" cy="120" r="3" fill="#f97316"/>
  <text x="66" y="143" text-anchor="middle" font-size="15" fill="#27272a">A</text>
  <text x="254" y="143" text-anchor="middle" font-size="15" fill="#27272a">B</text>
  <text x="176" y="27" text-anchor="middle" font-size="15" fill="#27272a">C</text>
  <text x="160" y="111" text-anchor="middle" font-size="14" fill="#ea580c">O</text>
</svg>'''

    if '四边形ABCD' in normalized:
        return '''<svg width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#fffaf0"/>
  <path d="M70 55 L250 55 L220 190 L45 190 Z" fill="none" stroke="#3f3f46" stroke-width="2.8"/>
  <path d="M70 45 L250 45" fill="none" stroke="#f97316" stroke-width="2" stroke-dasharray="5 5"/>
  <path d="M45 202 L220 202" fill="none" stroke="#f97316" stroke-width="2" stroke-dasharray="5 5"/>
  <circle cx="70" cy="55" r="3.5" fill="#3f3f46"/>
  <circle cx="250" cy="55" r="3.5" fill="#3f3f46"/>
  <circle cx="220" cy="190" r="3.5" fill="#3f3f46"/>
  <circle cx="45" cy="190" r="3.5" fill="#3f3f46"/>
  <text x="62" y="38" text-anchor="middle" font-size="15" fill="#27272a">A</text>
  <text x="260" y="38" text-anchor="middle" font-size="15" fill="#27272a">B</text>
  <text x="232" y="213" text-anchor="middle" font-size="15" fill="#27272a">C</text>
  <text x="31" y="213" text-anchor="middle" font-size="15" fill="#27272a">D</text>
</svg>'''

    if '△ABC' not in normalized and '三角形ABC' not in normalized:
        return ''

    # Match D on BC: 点D在BC上 / 点D在边BC上 / D是BC的中点 / D为BC中点 / 点D是BC边的中点 / D是BC上一点 ...
    has_d_on_bc = bool(re.search(r'(点?D在(边)?BC上|D[是为]BC(边)?的?(中点|上一点))', normalized))
    is_d_midpoint = bool(re.search(r'D[是为]BC(边)?的?中点', normalized))
    has_connect_ad = '连接AD' in normalized
    # Match E on AB: similar patterns
    has_e_on_ab = bool(re.search(r'(点?E在(边)?AB上|E[是为]AB(边)?的?(中点|上一点))', normalized))
    is_e_midpoint = bool(re.search(r'E[是为]AB(边)?的?中点', normalized))
    # Match F on AC: similar patterns
    has_f_on_ac = bool(re.search(r'(点?F在(边)?AC上|F[是为]AC(边)?的?(中点|上一点))', normalized))
    is_f_midpoint = bool(re.search(r'F[是为]AC(边)?的?中点', normalized))
    has_extend_to_d = '延长BC到D' in normalized or '延长CB到D' in normalized or ('点D在BC的延长线' in normalized)

    base_line = '<path d="M35 205 L285 205" fill="none" stroke="#3f3f46" stroke-width="2.8"/>'
    if has_extend_to_d:
        base_line = '<path d="M35 205 L300 205" fill="none" stroke="#3f3f46" stroke-width="2.8"/>'

    extra_segments = []
    extra_points = []
    extra_labels = []

    if has_d_on_bc:
        # Midpoint of BC: (160, 205); general point on BC: (200, 205)
        d_cx = '160' if is_d_midpoint else '200'
        d_label_x = '148' if is_d_midpoint else '214'
        extra_points.append(f'<circle cx="{d_cx}" cy="205" r="3.5" fill="#3f3f46"/>')
        extra_labels.append(f'<text x="{d_label_x}" y="198" text-anchor="middle" font-size="15" fill="#27272a">D</text>')
    elif has_extend_to_d:
        extra_points.append('<circle cx="300" cy="205" r="3.5" fill="#3f3f46"/>')
        extra_labels.append('<text x="312" y="226" text-anchor="middle" font-size="15" fill="#27272a">D</text>')
        extra_segments.append('<path d="M285 205 L300 205" fill="none" stroke="#3f3f46" stroke-width="2.8" stroke-dasharray="4 4"/>')

    if has_connect_ad and has_d_on_bc:
        # Line from A(160,40) to D on BC
        d_cx = '160' if is_d_midpoint else '200'
        extra_segments.append(f'<path d="M160 40 L{d_cx} 205" fill="none" stroke="#3f3f46" stroke-width="2.8"/>')

    if has_e_on_ab:
        # Midpoint of AB: (98, 123); general point on AB: (120, 93)
        e_cx = '98' if is_e_midpoint else '120'
        e_cy = '123' if is_e_midpoint else '93'
        e_label_x = str(int(e_cx)) if is_e_midpoint else '120'
        e_label_y = str(int(e_cy) - 7) if is_e_midpoint else '86'
        extra_points.append(f'<circle cx="{e_cx}" cy="{e_cy}" r="3.5" fill="#3f3f46"/>')
        extra_labels.append(f'<text x="{e_label_x}" y="{e_label_y}" text-anchor="middle" font-size="15" fill="#27272a">E</text>')
        extra_segments.append(f'<path d="M35 205 L{e_cx} {e_cy}" fill="none" stroke="#3f3f46" stroke-width="2.4"/>')

    if has_f_on_ac:
        # Midpoint of AC: (223, 123); general point on AC: (210, 106)
        f_cx = '223' if is_f_midpoint else '210'
        f_cy = '123' if is_f_midpoint else '106'
        f_label_x = str(int(f_cx) + 14) if is_f_midpoint else '224'
        f_label_y = str(int(f_cy)) if is_f_midpoint else '106'
        extra_points.append(f'<circle cx="{f_cx}" cy="{f_cy}" r="3.5" fill="#3f3f46"/>')
        extra_labels.append(f'<text x="{f_label_x}" y="{f_label_y}" text-anchor="middle" font-size="15" fill="#27272a">F</text>')
        extra_segments.append(f'<path d="M285 205 L{f_cx} {f_cy}" fill="none" stroke="#3f3f46" stroke-width="2.4"/>')

    return f'''<svg width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#fffaf0"/>
  <path d="M35 205 L160 40 L285 205" fill="none" stroke="#3f3f46" stroke-width="2.8"/>
  {base_line}
  {''.join(extra_segments)}
  <circle cx="160" cy="40" r="3.5" fill="#3f3f46"/>
  <circle cx="35" cy="205" r="3.5" fill="#3f3f46"/>
  <circle cx="285" cy="205" r="3.5" fill="#3f3f46"/>
  {''.join(extra_points)}
  <text x="160" y="28" text-anchor="middle" font-size="15" fill="#27272a">A</text>
  <text x="24" y="226" text-anchor="middle" font-size="15" fill="#27272a">B</text>
  <text x="296" y="226" text-anchor="middle" font-size="15" fill="#27272a">C</text>
  {''.join(extra_labels)}
</svg>'''


def get_effective_similar_diagram_svg(question_text: str, stored_svg: str) -> str:
    canonical = render_canonical_geometry_svg(question_text)
    if canonical:
        return canonical
    return normalize_diagram_svg(stored_svg)


def solve_similar_question_with_ai(question_text: str, diagram_svg: str, user_id: str) -> dict:
    deterministic = (
        solve_geometry_family(question_text)
        or solve_canonical_geometry_question(question_text)
        or solve_parallel_quadrilateral_question(question_text)
        or solve_diameter_circle_question(question_text)
    )
    if deterministic:
        return {
            'referenceAnswer': str(deterministic.get('referenceAnswer') or '').strip(),
            'explanation': str(deterministic.get('explanation') or deterministic.get('feedback') or '').strip(),
        }

    personalized_context = get_personalized_context(user_id)
    svg_data_url = ''
    if diagram_svg:
        svg_data_url = 'data:image/svg+xml;base64,' + base64.b64encode(
            diagram_svg.encode('utf-8')
        ).decode('utf-8')

    messages = [
        {'role': 'user', 'content': personalized_context} if personalized_context else None,
        {
            'role': 'user',
            'content': (
                ([{'type': 'image_url', 'image_url': {'url': svg_data_url}}] if svg_data_url else [])
                + [{
                    'type': 'text',
                    'text': f'''请根据下面这道题和提供给你的示意图来解题。注意：你必须以这张图为准，不要脑补另一张图。

题目：{question_text}

请以 JSON 返回：
{{
  "referenceAnswer": "标准答案，尽量简洁",
  "explanation": "面向学生的分步解析，直接给结论和推导，不要暴露思考过程"
}}'''
                }]
            )
        }
    ]
    messages = [m for m in messages if m]

    try:
        ai_response = chat_completion_json(messages, temperature=0.2, model=config.VISION_MODEL, user_id=user_id)
    except Exception:
        return {'referenceAnswer': '', 'explanation': ''}

    return {
        'referenceAnswer': str(ai_response.get('referenceAnswer') or '').strip(),
        'explanation': str(ai_response.get('explanation') or '').strip(),
    }


def parse_numeric_answer(answer: str) -> float | None:
    match = re.search(r'-?\d+(?:\.\d+)?', str(answer or ''))
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def solve_geometry_family(question_text: str) -> dict | None:
    normalized = re.sub(r'\s+', '', str(question_text or ''))
    if '△ABC' not in normalized or 'AB=AC' not in normalized or '点D在BC上' not in normalized or '连接AD' not in normalized:
        return None

    angle_map: dict[str, float] = {}
    for match in re.finditer(r'∠([A-D]{3})=([0-9]+(?:\.[0-9]+)?)°', normalized):
        angle_map[match.group(1)] = float(match.group(2))

    ask_match = re.search(r'求∠([A-D])', normalized)
    target = ask_match.group(1) if ask_match else ''

    if target == 'C' and 'ABD' in angle_map:
        value = angle_map['ABD']
        return {
            'referenceAnswer': f'{int(value) if value.is_integer() else value}°',
            'feedback': f'因为点 D 在 BC 上，所以 \\(\\angle ABD = \\angle ABC\\)。又因为 \\(AB = AC\\)，所以底角相等，\\(\\angle B = \\angle C\\)。因此 \\(\\angle C = {int(value) if value.is_integer() else value}^\\circ\\)。',
        }

    if target == 'B' and 'BAD' in angle_map and 'ADC' in angle_map:
        value = (180 - angle_map['ADC'] + angle_map['BAD']) / 2
        if value > 0:
            shown = int(value) if float(value).is_integer() else value
            return {
                'referenceAnswer': f'{shown}°',
                'feedback': f'设 \\(\\angle B = \\angle C = x\\)。因为 \\(AB = AC\\)，所以顶角 \\(\\angle A = 180^\\circ - 2x\\)。又有 \\(\\angle BAD = {int(angle_map["BAD"])}^\\circ\\)，所以 \\(\\angle CAD = 180^\\circ - 2x - {int(angle_map["BAD"])}^\\circ\\)。在三角形 \\(ACD\\) 中，内角和为 \\(180^\\circ\\)，得到 \\((180^\\circ - 2x - {int(angle_map["BAD"])}^\\circ) + x + {int(angle_map["ADC"])}^\\circ = 180^\\circ\\)，解得 \\(x = {shown}^\\circ\\)。因此 \\(\\angle B = {shown}^\\circ\\)。',
            }

    return None


def parse_angle_value(value: str) -> float | None:
    match = re.search(r'(-?\d+(?:\.\d+)?)', str(value or ''))
    if not match:
        return None
    return float(match.group(1))


def normalize_answer_value(value: str) -> str:
    numeric = parse_angle_value(value)
    if numeric is None:
        return str(value or '').strip()
    if abs(numeric - round(numeric)) < 1e-6:
        return str(int(round(numeric)))
    return f'{numeric:.2f}'.rstrip('0').rstrip('.')


def answer_value_appears_in_explanation(answer: str, explanation: str) -> bool:
    normalized_answer = normalize_answer_value(answer)
    if not normalized_answer:
        return False
    numeric = parse_angle_value(normalized_answer)
    if numeric is None:
        return normalized_answer in str(explanation or '')
    candidates = {normalized_answer}
    if abs(numeric - round(numeric)) < 1e-6:
        candidates.add(str(int(round(numeric))))
    else:
        candidates.add(f'{numeric:.2f}'.rstrip('0').rstrip('.'))
    return any(candidate and candidate in str(explanation or '') for candidate in candidates)


def normalize_segment_name(segment: str) -> str:
    letters = re.sub(r'[^A-Z]', '', str(segment or ''))
    if len(letters) != 2:
        return ''
    return ''.join(sorted(letters))


def extract_triangle_names(text: str) -> set[str]:
    triangles = set()
    for match in re.finditer(r'(?:△|三角形)([A-Z]{3})', str(text or '')):
        triangles.add(match.group(1))
    for match in re.finditer(r'\\triangle\s*([A-Z]{3})', str(text or '')):
        triangles.add(match.group(1))
    return triangles


def extract_quadrilateral_names(text: str) -> set[str]:
    quadrilaterals = set()
    for match in re.finditer(r'四边形([A-Z]{4})', str(text or '')):
        quadrilaterals.add(match.group(1))
    return quadrilaterals


def extract_circle_centers(text: str) -> set[str]:
    centers = set()
    for match in re.finditer(r'圆([A-Z])', str(text or '')):
        centers.add(match.group(1))
    return centers


def triangle_edges(triangle: str) -> set[str]:
    if len(triangle) != 3:
        return set()
    a, b, c = triangle
    return {
        normalize_segment_name(a + b),
        normalize_segment_name(a + c),
        normalize_segment_name(b + c),
    }


def quadrilateral_edges(quadrilateral: str) -> set[str]:
    if len(quadrilateral) != 4:
        return set()
    return {
        normalize_segment_name(quadrilateral[0] + quadrilateral[1]),
        normalize_segment_name(quadrilateral[1] + quadrilateral[2]),
        normalize_segment_name(quadrilateral[2] + quadrilateral[3]),
        normalize_segment_name(quadrilateral[3] + quadrilateral[0]),
    }


def extract_geometry_points(text: str) -> set[str]:
    normalized = str(text or '')
    points: set[str] = set()
    for triangle in extract_triangle_names(normalized):
        points.update(triangle)
    for quadrilateral in extract_quadrilateral_names(normalized):
        points.update(quadrilateral)
    points.update(extract_circle_centers(normalized))
    for match in re.finditer(r'([A-Z]{2})(?:是|为)直径', normalized):
        points.update(match.group(1))
    for match in re.finditer(r'点([A-Z])', normalized):
        points.add(match.group(1))
    for match in re.finditer(r'∠([A-Z]{3})', normalized):
        points.update(match.group(1))
    for match in re.finditer(r'\b([A-Z]{2})\b', normalized):
        points.update(match.group(1))
    return points


def extract_geometry_angles(text: str) -> set[str]:
    normalized = str(text or '')
    angles = set()
    for match in re.finditer(r'∠([A-Z]{3})', normalized):
        angles.add(match.group(1))
    for match in re.finditer(r'\\angle\s*([A-Z]{3})', normalized):
        angles.add(match.group(1))
    return angles


def extract_geometry_segments(text: str) -> set[str]:
    normalized = str(text or '')
    segments = set()
    for triangle in extract_triangle_names(normalized):
        segments.update(triangle_edges(triangle))
    for quadrilateral in extract_quadrilateral_names(normalized):
        segments.update(quadrilateral_edges(quadrilateral))
    diameter_points: str | None = None
    for match in re.finditer(r'([A-Z]{2})(?:是|为)直径', normalized):
        diameter_points = match.group(1)
        segment = normalize_segment_name(diameter_points)
        if segment:
            segments.add(segment)
    if diameter_points:
        for match in re.finditer(r'点([A-Z])在圆', normalized):
            point = match.group(1)
            for endpoint in diameter_points:
                segment = normalize_segment_name(point + endpoint)
                if segment:
                    segments.add(segment)
    for match in re.finditer(r'([A-Z]{2})∥([A-Z]{2})', normalized):
        for raw_segment in match.groups():
            segment = normalize_segment_name(raw_segment)
            if segment:
                segments.add(segment)
    for match in re.finditer(r'连接([A-Z]{2})', normalized):
        segment = normalize_segment_name(match.group(1))
        if segment:
            segments.add(segment)
    for match in re.finditer(r'延长([A-Z]{2})到([A-Z])', normalized):
        segment = normalize_segment_name(match.group(1))
        if segment:
            segments.add(segment)
        endpoint = match.group(1)[-1] + match.group(2)
        extended = normalize_segment_name(endpoint)
        if extended:
            segments.add(extended)
    for match in re.finditer(r'点([A-Z])在([A-Z]{2})上', normalized):
        point = match.group(1)
        base = match.group(2)
        base_segment = normalize_segment_name(base)
        if base_segment:
            segments.add(base_segment)
        for endpoint in base:
            segment = normalize_segment_name(point + endpoint)
            if segment:
                segments.add(segment)
    for match in re.finditer(r'\b([A-Z]{2})\b', normalized):
        segment = normalize_segment_name(match.group(1))
        if segment:
            segments.add(segment)
    return segments


def referenced_geometry_points(text: str) -> set[str]:
    normalized = str(text or '')
    points: set[str] = set()
    for angle in extract_geometry_angles(normalized):
        points.update(angle)
    for triangle in extract_triangle_names(normalized):
        points.update(triangle)
    for quadrilateral in extract_quadrilateral_names(normalized):
        points.update(quadrilateral)
    for match in re.finditer(r'\b([A-Z]{2})\b', normalized):
        points.update(match.group(1))
    return points


def referenced_geometry_angles(text: str) -> set[str]:
    return extract_geometry_angles(text)


def referenced_geometry_segments(text: str) -> set[str]:
    return extract_geometry_segments(text)


def angle_supported_by_segments(angle: str, allowed_segments: set[str]) -> bool:
    if len(angle) != 3:
        return False
    first_ray = normalize_segment_name(angle[0] + angle[1])
    second_ray = normalize_segment_name(angle[1] + angle[2])
    return first_ray in allowed_segments and second_ray in allowed_segments


def extract_svg_labels(svg_text: str) -> set[str]:
    labels = set()
    for match in re.finditer(r'<text\b[^>]*>\s*([A-Z])\s*</text>', str(svg_text or '')):
        labels.add(match.group(1))
    return labels


def validate_geometry_consistency(question_text: str, diagram_svg: str, answer: str, explanation: str) -> bool:
    if not looks_like_geometry_question(question_text):
        return True
    canonical_svg = render_canonical_geometry_svg(question_text)
    if not canonical_svg:
        return False

    allowed_points = extract_geometry_points(question_text)
    if not allowed_points:
        return False
    if not str(diagram_svg or '').strip():
        return False

    svg_labels = extract_svg_labels(diagram_svg)
    if not svg_labels:
        return False
    if svg_labels and not svg_labels.issubset(allowed_points):
        return False
    if diagram_svg and svg_labels and not allowed_points.issubset(svg_labels):
        return False

    referenced_points = referenced_geometry_points(explanation)
    if referenced_points and not referenced_points.issubset(allowed_points):
        return False

    referenced_angles = referenced_geometry_angles(explanation)
    allowed_segments = extract_geometry_segments(question_text)
    if any(not angle_supported_by_segments(angle, allowed_segments) for angle in referenced_angles):
        return False

    referenced_segments = referenced_geometry_segments(explanation)
    if referenced_segments and not referenced_segments.issubset(allowed_segments):
        return False

    if not str(answer or '').strip() or not str(explanation or '').strip():
        return False
    if not answer_value_appears_in_explanation(answer, explanation):
        return False

    return True


def solve_canonical_geometry_question(question_text: str) -> dict | None:
    normalized = re.sub(r'\s+', '', str(question_text or ''))
    if '△ABC' not in normalized or 'AB=AC' not in normalized:
        return None

    angle_map = {}
    vertex_angle_map: dict[str, float] = {}
    for match in re.finditer(r'∠([A-D]{3})=([0-9]+(?:\.[0-9]+)?)°', normalized):
        angle_name = match.group(1)
        value = float(match.group(2))
        angle_map[f'∠{angle_name}'] = value
        vertex_angle_map[angle_name[1]] = value
    for match in re.finditer(r'∠([A-D])=([0-9]+(?:\.[0-9]+)?)°', normalized):
        vertex_angle_map[match.group(1)] = float(match.group(2))

    target_match = re.search(r'求∠([A-D])', normalized)
    if not target_match:
        return None
    target_vertex = target_match.group(1)

    result: float | None = None
    reason = ''

    if target_vertex in ('B', 'C') and vertex_angle_map.get('A') is not None:
        result = (180 - vertex_angle_map['A']) / 2
        reason = (
            f'因为 \\(AB=AC\\)，所以△ABC 是等腰三角形，底角相等，'
            f'\\(\\angle B=\\angle C\\)。已知 \\(\\angle A={format_degree(vertex_angle_map["A"])}^\\circ\\)，'
            f'所以 \\(\\angle B=\\angle C=(180^\\circ-{format_degree(vertex_angle_map["A"])}^\\circ)/2\\)。'
        )
    elif target_vertex == 'A' and (
        vertex_angle_map.get('B') is not None or vertex_angle_map.get('C') is not None
    ):
        base_angle = vertex_angle_map.get('B') if vertex_angle_map.get('B') is not None else vertex_angle_map.get('C')
        result = 180 - 2 * base_angle
        reason = (
            f'因为 \\(AB=AC\\)，所以△ABC 的两个底角相等，'
            f'\\(\\angle B=\\angle C={format_degree(base_angle)}^\\circ\\)。'
            f'三角形内角和为 \\(180^\\circ\\)，所以 \\(\\angle A=180^\\circ-2\\times {format_degree(base_angle)}^\\circ\\)。'
        )
    elif target_vertex in ('B', 'C') and (
        vertex_angle_map.get('B') is not None or vertex_angle_map.get('C') is not None
    ):
        other_base = 'C' if target_vertex == 'B' else 'B'
        if vertex_angle_map.get(other_base) is not None:
            result = vertex_angle_map[other_base]
            reason = (
                f'因为 \\(AB=AC\\)，所以△ABC 的底角相等，'
                f'\\(\\angle B=\\angle C\\)。已知 \\(\\angle {other_base}={format_degree(result)}^\\circ\\)，'
                f'所以 \\(\\angle {target_vertex}={format_degree(result)}^\\circ\\)。'
            )
    elif target_vertex == 'C' and angle_map.get('∠ABD') is not None:
        result = angle_map['∠ABD']
        reason = '因为点 D 在 BC 上，所以 \\(\\angle ABD = \\angle ABC\\)。又因为 \\(AB = AC\\)，底角相等，\\(\\angle ABC = \\angle ACB\\)。所以 \\(\\angle C = \\angle ABD\\)。'
    elif target_vertex == 'B' and angle_map.get('∠BAD') is not None and angle_map.get('∠ADC') is not None:
        result = (180 - angle_map['∠ADC'] + angle_map['∠BAD']) / 2
        reason = '设 \\(\\angle B = \\angle C = x\\)。则顶角 \\(\\angle A = 180^\\circ - 2x\\)，而 \\(\\angle DAC = 180^\\circ - 2x - \\angle BAD\\)。在三角形 \\(ADC\\) 中，\\(\\angle ADC + \\angle DAC + \\angle ACD = 180^\\circ\\)，解得 \\(x = \\\\frac{{180^\\circ - \\angle ADC + \\angle BAD}}{{2}}\\)。'

    if result is None:
        return None

    answer = normalize_answer_value(str(result))
    return {
        'referenceAnswer': f'{answer}°',
        'explanation': reason,
    }


def solve_parallel_quadrilateral_question(question_text: str) -> dict | None:
    normalized = re.sub(r'\s+', '', str(question_text or ''))
    if '四边形ABCD' not in normalized or 'AB∥CD' not in normalized:
        return None

    vertex_angle_map: dict[str, float] = {}
    for match in re.finditer(r'∠([A-D])=([0-9]+(?:\.[0-9]+)?)°', normalized):
        vertex_angle_map[match.group(1)] = float(match.group(2))
    for match in re.finditer(r'∠([A-D]{3})=([0-9]+(?:\.[0-9]+)?)°', normalized):
        vertex_angle_map[match.group(1)[1]] = float(match.group(2))

    target_match = re.search(r'求∠([A-D])', normalized)
    if not target_match:
        return None
    target = target_match.group(1)

    paired_vertex = {'A': 'D', 'D': 'A', 'B': 'C', 'C': 'B'}.get(target)
    if not paired_vertex or vertex_angle_map.get(paired_vertex) is None:
        return None

    known = vertex_angle_map[paired_vertex]
    result = 180 - known
    if result <= 0:
        return None

    answer = format_degree(result)
    known_text = format_degree(known)
    explanation = (
        f'因为 \\(AB\\parallel CD\\)，所以沿着同一条腰形成的同旁内角互补。'
        f'\\(\\angle {target}\\) 与 \\(\\angle {paired_vertex}\\) 在同一侧，'
        f'所以 \\(\\angle {target}+\\angle {paired_vertex}=180^\\circ\\)。'
        f'已知 \\(\\angle {paired_vertex}={known_text}^\\circ\\)，'
        f'因此 \\(\\angle {target}=180^\\circ-{known_text}^\\circ={answer}°\\)。'
    )
    return {
        'referenceAnswer': f'{answer}°',
        'explanation': explanation,
    }


def solve_diameter_circle_question(question_text: str) -> dict | None:
    normalized = re.sub(r'\s+', '', str(question_text or ''))
    if '圆O' not in normalized or not ('AB是直径' in normalized or 'AB为直径' in normalized) or '点C在圆' not in normalized:
        return None

    vertex_angle_map: dict[str, float] = {}
    for match in re.finditer(r'∠([A-C])=([0-9]+(?:\.[0-9]+)?)°', normalized):
        vertex_angle_map[match.group(1)] = float(match.group(2))
    for match in re.finditer(r'∠([A-C]{3})=([0-9]+(?:\.[0-9]+)?)°', normalized):
        vertex_angle_map[match.group(1)[1]] = float(match.group(2))

    target_match = re.search(r'求∠([A-C])', normalized)
    if not target_match:
        return None
    target = target_match.group(1)

    if target == 'C':
        result = 90.0
        explanation = (
            '因为 \\(AB\\) 是圆 O 的直径，点 C 在圆上，所以 \\(\\angle ACB\\) 是直径所对的圆周角，'
            '由圆周角定理可得 \\(\\angle C=90^\\circ\\)。'
        )
    elif target in ('A', 'B'):
        other = 'B' if target == 'A' else 'A'
        if vertex_angle_map.get(other) is None:
            return None
        known = vertex_angle_map[other]
        result = 90 - known
        if result <= 0:
            return None
        known_text = format_degree(known)
        answer = format_degree(result)
        explanation = (
            '因为 \\(AB\\) 是圆 O 的直径，点 C 在圆上，所以 \\(\\angle C=90^\\circ\\)。'
            f'在△ABC中，已知 \\(\\angle {other}={known_text}^\\circ\\)，'
            f'由三角形内角和得 \\(\\angle {target}=180^\\circ-90^\\circ-{known_text}^\\circ={answer}°\\)。'
        )
    else:
        return None

    answer = format_degree(result)
    return {
        'referenceAnswer': f'{answer}°',
        'explanation': explanation,
    }


def is_supported_geometry_source(question_text: str) -> bool:
    normalized = re.sub(r'\s+', '', str(question_text or ''))
    return (
        ('△ABC' in normalized or '三角形ABC' in normalized)
        and 'AB=AC' in normalized
    )


def format_degree(value: float) -> str:
    if abs(value - round(value)) < 1e-6:
        return str(int(round(value)))
    return f'{value:.2f}'.rstrip('0').rstrip('.')


def build_isosceles_triangle_similar_questions(count: int, difficulty: str) -> list[dict]:
    variants = [
        {'abd': 42, 'ask': 'C'},
        {'abd': 48, 'ask': 'C'},
        {'bad': 24, 'adc': 108, 'ask': 'B'},
        {'bad': 30, 'adc': 112, 'ask': 'B'},
        {'abd': 36, 'ask': 'C'},
    ]

    questions = []
    for index, variant in enumerate(variants[:count]):
        if variant['ask'] == 'C':
            answer = format_degree(float(variant['abd']))
            question_text = (
                f'如图，在△ABC中，AB=AC，点D在BC上，连接AD，'
                f'若∠ABD={answer}°，求∠C的度数。'
            )
            explanation = (
                f'因为点 D 在 BC 上，所以射线 BD 与 BC 在同一直线上，'
                f'\\(\\angle ABD=\\angle ABC\\)，且它们都等于 {answer}°。'
                f'又因为 \\(AB=AC\\)，所以△ABC 是等腰三角形，底角相等，'
                f'\\(\\angle ABC=\\angle ACB\\)。因此 \\(\\angle C={answer}°\\)。'
            )
        else:
            bad = float(variant['bad'])
            adc = float(variant['adc'])
            answer_value = (180 - adc + bad) / 2
            answer = format_degree(answer_value)
            bad_text = format_degree(bad)
            adc_text = format_degree(adc)
            question_text = (
                f'如图，在△ABC中，AB=AC，点D在BC上，连接AD，'
                f'若∠BAD={bad_text}°，∠ADC={adc_text}°，求∠B的度数。'
            )
            explanation = (
                f'设 \\(\\angle B=\\angle C=x\\)。因为 \\(AB=AC\\)，所以△ABC 的底角相等，'
                f'顶角 \\(\\angle A=180^\\circ-2x\\)。已知 \\(\\angle BAD={bad_text}^\\circ\\)，'
                f'所以 \\(\\angle DAC=180^\\circ-2x-{bad_text}^\\circ\\)。'
                f'在△ACD中，\\(\\angle ADC={adc_text}^\\circ\\)，\\(\\angle ACD=x\\)，'
                f'由内角和得 \\((180^\\circ-2x-{bad_text}^\\circ)+x+{adc_text}^\\circ=180^\\circ\\)，'
                f'解得 \\(x={answer}°\\)。因此 \\(\\angle B={answer}°\\)。'
            )

        diagram_svg = render_canonical_geometry_svg(question_text)
        questions.append({
            'questionText': question_text,
            'diagramSvg': diagram_svg,
            'difficulty': difficulty,
            'answer': f'{answer}°',
            'explanation': explanation,
            'source': 'deterministic_geometry',
            'variantIndex': index,
        })

    return questions


def build_basic_isosceles_triangle_similar_questions(count: int, difficulty: str) -> list[dict]:
    variants = [
        {'known': 'A', 'value': 46, 'ask': 'B'},
        {'known': 'A', 'value': 52, 'ask': 'C'},
        {'known': 'B', 'value': 64, 'ask': 'A'},
        {'known': 'C', 'value': 58, 'ask': 'B'},
        {'known': 'B', 'value': 50, 'ask': 'C'},
    ]

    questions = []
    for index, variant in enumerate(variants[:count]):
        known = variant['known']
        ask = variant['ask']
        value = float(variant['value'])
        value_text = format_degree(value)

        if known == 'A' and ask in ('B', 'C'):
            answer_value = (180 - value) / 2
            answer = format_degree(answer_value)
            explanation = (
                f'因为 \\(AB=AC\\)，所以△ABC 是等腰三角形，底角相等，'
                f'\\(\\angle B=\\angle C\\)。已知 \\(\\angle A={value_text}^\\circ\\)，'
                f'所以 \\(\\angle B=\\angle C=(180^\\circ-{value_text}^\\circ)/2={answer}°\\)。'
                f'因此 \\(\\angle {ask}={answer}°\\)。'
            )
        elif ask == 'A' and known in ('B', 'C'):
            answer_value = 180 - 2 * value
            answer = format_degree(answer_value)
            explanation = (
                f'因为 \\(AB=AC\\)，所以△ABC 的底角相等，'
                f'\\(\\angle B=\\angle C={value_text}^\\circ\\)。'
                f'三角形内角和为 \\(180^\\circ\\)，所以 '
                f'\\(\\angle A=180^\\circ-2\\times {value_text}^\\circ={answer}°\\)。'
            )
        else:
            answer = value_text
            explanation = (
                f'因为 \\(AB=AC\\)，所以△ABC 的底角相等，\\(\\angle B=\\angle C\\)。'
                f'已知 \\(\\angle {known}={value_text}^\\circ\\)，因此 \\(\\angle {ask}={answer}°\\)。'
            )

        question_text = (
            f'如图，在△ABC中，AB=AC，若∠{known}={value_text}°，求∠{ask}的度数。'
        )
        diagram_svg = render_canonical_geometry_svg(question_text)
        questions.append({
            'questionText': question_text,
            'diagramSvg': diagram_svg,
            'difficulty': difficulty,
            'answer': f'{answer}°',
            'explanation': explanation,
            'source': 'deterministic_basic_isosceles',
            'variantIndex': index,
        })

    return questions


def is_supported_parallel_quadrilateral_source(question_text: str) -> bool:
    normalized = re.sub(r'\s+', '', str(question_text or ''))
    return '四边形ABCD' in normalized and 'AB∥CD' in normalized


def build_parallel_quadrilateral_similar_questions(count: int, difficulty: str) -> list[dict]:
    variants = [
        {'known': 'A', 'value': 70, 'ask': 'D'},
        {'known': 'D', 'value': 112, 'ask': 'A'},
        {'known': 'B', 'value': 64, 'ask': 'C'},
        {'known': 'C', 'value': 118, 'ask': 'B'},
        {'known': 'A', 'value': 76, 'ask': 'D'},
    ]

    questions = []
    for index, variant in enumerate(variants[:count]):
        known = variant['known']
        ask = variant['ask']
        known_text = format_degree(float(variant['value']))
        answer = format_degree(180 - float(variant['value']))
        question_text = (
            f'如图，在四边形ABCD中，AB∥CD，若∠{known}={known_text}°，'
            f'求∠{ask}的度数。'
        )
        explanation = (
            f'因为 \\(AB\\parallel CD\\)，所以沿着同一条腰形成的同旁内角互补。'
            f'\\(\\angle {known}\\) 与 \\(\\angle {ask}\\) 在同一侧，'
            f'所以 \\(\\angle {known}+\\angle {ask}=180^\\circ\\)。'
            f'已知 \\(\\angle {known}={known_text}^\\circ\\)，'
            f'因此 \\(\\angle {ask}=180^\\circ-{known_text}^\\circ={answer}°\\)。'
        )
        diagram_svg = render_canonical_geometry_svg(question_text)
        questions.append({
            'questionText': question_text,
            'diagramSvg': diagram_svg,
            'difficulty': difficulty,
            'answer': f'{answer}°',
            'explanation': explanation,
            'source': 'deterministic_parallel_quadrilateral',
            'variantIndex': index,
        })

    return questions


def is_supported_diameter_circle_source(question_text: str) -> bool:
    normalized = re.sub(r'\s+', '', str(question_text or ''))
    return '圆O' in normalized and ('AB是直径' in normalized or 'AB为直径' in normalized) and '点C在圆' in normalized


def build_diameter_circle_similar_questions(count: int, difficulty: str) -> list[dict]:
    variants = [
        {'known': 'A', 'value': 38, 'ask': 'B'},
        {'known': 'B', 'value': 56, 'ask': 'A'},
        {'known': 'A', 'value': 47, 'ask': 'C'},
        {'known': 'B', 'value': 35, 'ask': 'A'},
        {'known': 'A', 'value': 62, 'ask': 'B'},
    ]

    questions = []
    for index, variant in enumerate(variants[:count]):
        known = variant['known']
        ask = variant['ask']
        known_text = format_degree(float(variant['value']))
        if ask == 'C':
            answer = '90'
            explanation = (
                '因为 \\(AB\\) 是圆 O 的直径，点 C 在圆上，所以 \\(\\angle ACB\\) 是直径所对的圆周角。'
                '由圆周角定理可得 \\(\\angle C=90°\\)。'
            )
        else:
            answer = format_degree(90 - float(variant['value']))
            explanation = (
                '因为 \\(AB\\) 是圆 O 的直径，点 C 在圆上，所以 \\(\\angle C=90^\\circ\\)。'
                f'在△ABC中，已知 \\(\\angle {known}={known_text}^\\circ\\)，'
                f'由三角形内角和得 \\(\\angle {ask}=180^\\circ-90^\\circ-{known_text}^\\circ={answer}°\\)。'
            )
        question_text = (
            f'如图，在圆O中，AB是直径，点C在圆上，若∠{known}={known_text}°，'
            f'求∠{ask}的度数。'
        )
        diagram_svg = render_canonical_geometry_svg(question_text)
        questions.append({
            'questionText': question_text,
            'diagramSvg': diagram_svg,
            'difficulty': difficulty,
            'answer': f'{answer}°',
            'explanation': explanation,
            'source': 'deterministic_diameter_circle',
            'variantIndex': index,
        })

    return questions


def build_deterministic_similar_questions(question: dict, count: int) -> list[dict]:
    question_text = str(question.get('question_text') or '')
    difficulty = str(question.get('difficulty') or '中等')
    normalized = re.sub(r'\s+', '', question_text)
    if is_supported_diameter_circle_source(question_text):
        return build_diameter_circle_similar_questions(count, difficulty)
    if is_supported_parallel_quadrilateral_source(question_text):
        return build_parallel_quadrilateral_similar_questions(count, difficulty)
    if is_supported_geometry_source(question_text) and '点D在BC上' in normalized and '连接AD' in normalized:
        return build_isosceles_triangle_similar_questions(count, difficulty)
    if is_supported_geometry_source(question_text):
        return build_basic_isosceles_triangle_similar_questions(count, difficulty)
    return []


def normalize_knowledge_points(value) -> list[str]:
    loaded = json_loads(value, value) if isinstance(value, str) else value
    if not isinstance(loaded, list):
        return []
    normalized = []
    seen = set()
    for item in loaded:
        text = str(item or '').strip()
        if not text or text in seen:
            continue
        normalized.append(text)
        seen.add(text)
    return normalized


def same_knowledge_points(left, right) -> bool:
    return normalize_knowledge_points(left) == normalize_knowledge_points(right)


def generate_diagram_svg(question_text: str, user_id: str) -> str:
    if not looks_like_geometry_question(question_text):
        return ''

    canonical_svg = render_canonical_geometry_svg(question_text)
    if canonical_svg:
        return canonical_svg

    prompt = f'''请根据下面这道中文几何题，输出一张可直接渲染的 SVG 示意图。

要求：
1. 只输出 SVG 字符串，不要解释，不要 Markdown 代码块。
2. SVG 必须包含 `<svg ...>...</svg>`，并设置合适的 `viewBox`。
3. 白色或浅米色背景，深灰色线条，橙色标出角，清楚标记点名、边名、角度和已知数字。
4. 图形要和题意匹配，但可以是示意图，不要求严格按比例。
5. 不要包含脚本，不要引用外部资源。

题目：
{question_text}
'''

    try:
        svg = chat_completion(
            [{'role': 'user', 'content': prompt}],
            temperature=0.2,
            model=config.TEXT_MODEL,
            user_id=user_id,
        )
    except Exception:
        return ''

    return normalize_diagram_svg(svg)


def get_personalized_context(user_id: str) -> str:
    profile_context = get_user_profile_context(user_id).strip()
    memory_context = load_user_memory(user_id).strip()
    parts = []
    if profile_context:
        parts.append(profile_context)
    if memory_context:
        parts.append(
            '## 用户记忆信息\n以下是与该用户相关的历史记忆，请在不生硬引用原文的前提下，用它调整讲解风格、鼓励方式和举例偏好：\n\n'
            f'{memory_context}'
        )
    return '\n\n'.join(parts)


def humanize_ai_error(error: Exception) -> str:
    message = str(error or '').strip()
    lowered = message.lower()
    if 'timed out' in lowered or 'timeout' in lowered:
        return 'AI识别超时，请稍后重试'
    if 'api key' in lowered or 'incorrect api key' in lowered or 'invalid api key' in lowered:
        return 'AI 服务认证失败，请检查当前服务端配置'
    if 'model' in lowered and ('not found' in lowered or 'unknown' in lowered or 'does not exist' in lowered):
        return '当前视觉模型不可用，请检查模型名称配置'
    if 'insufficient_quota' in lowered or 'quota' in lowered or '余额' in message:
        return 'AI 服务额度不足，请检查账号配额'
    if message:
        return f'AI识别失败：{message}'
    return 'AI识别失败，请稍后重试'


@bp.post('/upload')
@login_required
def upload_wrong_question():
    """上传错题图片，AI识别并分析"""
    if 'image' not in request.files:
        return jsonify({'message': '请上传图片', 'code': 'VALIDATION_ERROR'}), 400

    file = request.files['image']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({'message': '不支持的图片格式', 'code': 'VALIDATION_ERROR'}), 400

    user_id = current_user_id()
    question_id = new_id()
    filename = secure_filename(f'{question_id}_{file.filename}')
    filepath = os.path.join(config.UPLOAD_FOLDER, filename)

    os.makedirs(config.UPLOAD_FOLDER, exist_ok=True)
    file.save(filepath)

    if os.path.getsize(filepath) > config.MAX_IMAGE_SIZE:
        os.remove(filepath)
        return jsonify({'message': '图片超过 10MB 限制，请压缩后再上传', 'code': 'FILE_TOO_LARGE'}), 413

    # 读取图片并转换为base64
    with open(filepath, 'rb') as f:
        image_data = base64.b64encode(f.read()).decode('utf-8')
    mime_type = file.mimetype or mimetypes.guess_type(filename)[0] or 'image/jpeg'

    # 获取用户档案上下文
    personalized_context = get_personalized_context(user_id)

    # AI识别错题并用教师口吻分析
    messages = [
        {'role': 'user', 'content': personalized_context} if personalized_context else None,
        {
            'role': 'user',
            'content': [
                {
                    'type': 'image_url',
                    'image_url': {'url': f'data:{mime_type};base64,{image_data}'}
                },
                {
                    'type': 'text',
                    'text': '''请仔细识别图片中的错题，像一位专业、耐心的数学老师一样提取信息并返回JSON格式：

{
  "questionText": "题目内容（只包含题干，不包含选项）",
  "options": ["A. 选项A内容", "B. 选项B内容", "C. 选项C内容", "D. 选项D内容"],
  "subject": "科目（如数学、物理、化学等）",
  "difficulty": "简单/中等/困难",
  "userAnswer": "学生图片中的错误答案（只写字母，如B）",
  "correctAnswer": "正确答案（只写字母，如A）",
  "errorType": "错误类型（如概念理解错误、计算错误、审题不清等）",
  "errorAnalysis": "用第二人称写给学生看的出错原因分析",
  "knowledgePoints": ["相关知识点1", "相关知识点2"],
  "explanation": "像数学老师板书一样的分步讲解"
}

**重要说明**：
1. questionText：只包含题干部分，不要包含选项内容
2. options：**必须仔细查看图片中的所有选项**，完整提取每个选项，格式为"字母. 内容"（如"A. 3"、"B. -2"）
   - 如果是选择题，options数组必须包含所有选项（通常是A、B、C、D四个）
   - 如果是填空题、解答题等没有选项的题目，options才设为空数组[]
3. userAnswer和correctAnswer：只写选项字母（如"A"、"B"），不要写完整选项内容
4. errorAnalysis 必须直接对学生说话，主语用“你”，不要写“用户”“学生”“他/她”。语气要像老师当面讲评：先指出你选错在哪里，再一步步说明误区，最后点出下次怎么避免。
5. errorAnalysis 需要是“结论明确、条理清晰、没有自我怀疑”的讲解，不要出现“可能”“也许”“我认为”“我觉得”“不确定”“似乎”“好像”等措辞，不要写推理过程或模型视角。
6. errorAnalysis 请按固定结构输出，推荐三段或三条要点：第一句直接定性错误，第二部分解释为什么错，第三部分给出如何避免。不要写得过短，也不要写成冗长散文。
7. explanation 要按步骤讲清楚正确解法，使用“第一步、第二步、第三步”或清晰分段，不要暴露“AI分析/模型推理”的口吻。
8. 数学公式统一使用LaTeX格式：行内公式只用\\(...\\)，块级公式只用\\[...\\]。不要使用美元符号$或$$包裹公式，避免渲染错误。'''
                }
            ]
        }
    ]
    messages = [m for m in messages if m]

    try:
        ai_response = chat_completion_json(messages, temperature=0.3, model=config.VISION_MODEL, user_id=user_id)
    except Exception as e:
        current_app.logger.exception('Wrong question image recognition failed')
        if isinstance(e, AIServiceError):
            message = humanize_ai_error(e)
            status = 504 if '超时' in message else 502
            code = 'AI_TIMEOUT' if status == 504 else 'AI_ERROR'
            return jsonify({'message': message, 'code': code}), status
        return jsonify({'message': '上传处理失败，请稍后重试', 'code': 'UPLOAD_ERROR'}), 500

    polished_error_analysis = finalize_error_analysis(ai_response)

    # 保存到数据库
    with transaction() as conn:
        conn.execute(
            '''INSERT INTO wrong_questions
               (id, user_id, image_path, question_text, options, subject, difficulty, user_answer, correct_answer,
                error_type, error_analysis, knowledge_points, ai_explanation, status, next_review_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                question_id,
                user_id,
                filepath,
                ai_response.get('questionText', ''),
                json_dumps(ai_response.get('options', [])),
                ai_response.get('subject', ''),
                ai_response.get('difficulty', ''),
                ai_response.get('userAnswer', ''),
                ai_response.get('correctAnswer', ''),
                ai_response.get('errorType', ''),
                polished_error_analysis,
                json_dumps(ai_response.get('knowledgePoints', [])),
                ai_response.get('explanation', ''),
                'pending',
                (datetime.now() + timedelta(days=1)).isoformat()
            )
        )

    # 更新薄弱点
    knowledge_points = ai_response.get('knowledgePoints', [])
    if knowledge_points:
        upsert_weak_points(user_id, knowledge_points, source='wrong_questions', correct=False)

    interaction = {
        'id': new_id(),
        'user_id': user_id,
        'source_type': 'wrong_questions',
        'source_id': question_id,
        'user_input': f"错题上传：{ai_response.get('questionText', '')}",
        'ai_response': f"{polished_error_analysis}\n\n{ai_response.get('explanation', '')}",
        'extracted_knowledge': json_dumps(knowledge_points),
        'summary': f"错题分析：{', '.join(knowledge_points[:3]) if knowledge_points else ai_response.get('subject', '未识别知识点')}",
    }
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO interaction_logs
            (id, user_id, source_type, source_id, user_input, ai_response, extracted_knowledge, summary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                interaction['id'],
                interaction['user_id'],
                interaction['source_type'],
                interaction['source_id'],
                interaction['user_input'],
                interaction['ai_response'],
                interaction['extracted_knowledge'],
                interaction['summary'],
            ),
        )
    try:
        from services.knowledge_memory_service import auto_capture_from_interaction

        auto_capture_from_interaction(user_id, interaction)
    except Exception:
        current_app.logger.exception('Auto-capture from wrong question failed')

    return jsonify({
        'message': '错题上传成功',
        'data': {
            'id': question_id,
            'questionText': ai_response.get('questionText', ''),
            'subject': ai_response.get('subject', ''),
            'errorAnalysis': polished_error_analysis,
            'explanation': ai_response.get('explanation', ''),
            'knowledgePoints': knowledge_points
        }
    }), 201


@bp.get('')
@login_required
def get_wrong_questions():
    """获取错题列表"""
    user_id = current_user_id()
    status = request.args.get('status')
    subject = request.args.get('subject')

    query = 'SELECT * FROM wrong_questions WHERE user_id = ?'
    params = [user_id]

    if status:
        query += ' AND status = ?'
        params.append(status)

    if subject:
        query += ' AND subject = ?'
        params.append(subject)

    query += ' ORDER BY created_at DESC'

    with transaction() as conn:
        rows = rows_to_dicts(conn.execute(query, params).fetchall())

    # 转换字段名为camelCase
    result = []
    for row in rows:
        result.append({
            'id': row['id'],
            'questionText': row['question_text'],
            'imageUrl': f"/api/v1/wrong-questions/{row['id']}/image",
            'options': json_loads(row.get('options', '[]'), []),
            'subject': row['subject'],
            'difficulty': row['difficulty'],
            'userAnswer': row['user_answer'],
            'correctAnswer': row['correct_answer'],
            'errorType': row['error_type'],
            'errorAnalysis': row['error_analysis'],
            'knowledgePoints': json_loads(row.get('knowledge_points', '[]'), []),
            'aiExplanation': row['ai_explanation'],
            'status': row['status'],
            'masteryLevel': row['mastery_level'],
            'reviewCount': row['review_count'],
            'createdAt': row['created_at']
        })

    return jsonify({'data': result})


@bp.get('/<question_id>')
@login_required
def get_wrong_question(question_id):
    """获取单个错题详情"""
    user_id = current_user_id()

    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM wrong_questions WHERE id = ? AND user_id = ?',
            (question_id, user_id)
        ).fetchone()

    if not row:
        return jsonify({'message': '错题不存在', 'code': 'NOT_FOUND'}), 404

    question_dict = row_to_dict(row)

    if needs_error_analysis_refresh(question_dict.get('error_analysis', '')):
        refreshed_analysis = finalize_error_analysis(
            {
                'questionText': question_dict.get('question_text', ''),
                'subject': question_dict.get('subject', ''),
                'errorType': question_dict.get('error_type', ''),
                'userAnswer': question_dict.get('user_answer', ''),
                'correctAnswer': question_dict.get('correct_answer', ''),
                'knowledgePoints': json_loads(question_dict.get('knowledge_points', '[]'), []),
                'explanation': question_dict.get('ai_explanation', ''),
                'errorAnalysis': question_dict.get('error_analysis', ''),
            }
        )
        with transaction() as conn:
            conn.execute(
                'UPDATE wrong_questions SET error_analysis = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?',
                (refreshed_analysis, question_id, user_id),
            )
        question_dict['error_analysis'] = refreshed_analysis

    # 转换为camelCase
    question = {
        'id': question_dict['id'],
        'questionText': question_dict['question_text'],
        'imageUrl': f"/api/v1/wrong-questions/{question_dict['id']}/image",
        'options': json_loads(question_dict.get('options', '[]'), []),
        'subject': question_dict['subject'],
        'difficulty': question_dict['difficulty'],
        'userAnswer': question_dict['user_answer'],
        'correctAnswer': question_dict['correct_answer'],
        'errorType': question_dict['error_type'],
        'errorAnalysis': question_dict['error_analysis'],
        'knowledgePoints': json_loads(question_dict.get('knowledge_points', '[]'), []),
        'aiExplanation': question_dict['ai_explanation'],
        'status': question_dict['status'],
        'masteryLevel': question_dict['mastery_level'],
        'reviewCount': question_dict['review_count'],
        'createdAt': question_dict['created_at']
    }

    # 获取相似题目
    with transaction() as conn:
        similar_rows = rows_to_dicts(conn.execute(
            'SELECT * FROM similar_questions WHERE wrong_question_id = ? ORDER BY created_at',
            (question_id,)
        ).fetchall())

    # 转换相似题目为camelCase
    similar_questions = []
    for sq in similar_rows:
        effective_diagram_svg = get_effective_similar_diagram_svg(
            sq.get('question_text', ''),
            sq.get('diagram_svg', ''),
        )
        similar_questions.append({
            'id': sq['id'],
            'questionText': sq['question_text'],
            'diagramSvg': effective_diagram_svg,
            'answer': sq['answer'],
            'explanation': sq.get('explanation', ''),
            'knowledgePoints': json_loads(sq.get('knowledge_points', '[]'), []),
            'difficulty': sq['difficulty'],
            'userAnswer': sq['user_answer'],
            'isCorrect': sq['is_correct']
        })

    question['similarQuestions'] = similar_questions

    return jsonify({'data': question})


@bp.get('/<question_id>/image')
@login_required
def get_wrong_question_image(question_id):
    """返回错题原图，供详情页展示几何图等题面信息"""
    user_id = current_user_id()

    with transaction() as conn:
        row = conn.execute(
            'SELECT image_path FROM wrong_questions WHERE id = ? AND user_id = ?',
            (question_id, user_id)
        ).fetchone()

    if not row:
        return jsonify({'message': '错题不存在', 'code': 'NOT_FOUND'}), 404

    image_path = row['image_path']
    if not image_path or not os.path.exists(image_path):
        return jsonify({'message': '题目原图不存在', 'code': 'NOT_FOUND'}), 404

    return send_file(image_path)


@bp.post('/<question_id>/generate-similar')
@login_required
def generate_similar_questions(question_id):
    """生成相似题目"""
    user_id = current_user_id()
    data = request.get_json(silent=True) or {}
    count = min(int(data.get('count', 3)), 5)

    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM wrong_questions WHERE id = ? AND user_id = ?',
            (question_id, user_id)
        ).fetchone()

    if not row:
        return jsonify({'message': '错题不存在', 'code': 'NOT_FOUND'}), 404

    question = row_to_dict(row)
    personalized_context = get_personalized_context(user_id)
    source_knowledge_points = normalize_knowledge_points(question.get('knowledge_points', '[]'))
    source_knowledge_points_json = json_dumps(source_knowledge_points)
    deterministic_questions = build_deterministic_similar_questions(question, count)

    if deterministic_questions:
        questions = deterministic_questions
    else:
        messages = [
            {'role': 'user', 'content': personalized_context} if personalized_context else None,
            {
                'role': 'user',
                'content': f'''基于以下错题，生成{count}道相似的练习题：

原题：{question['question_text']}
知识点：{source_knowledge_points}
难度：{question['difficulty']}

请以JSON格式返回：
{{
  "questions": [
    {{
      "questionText": "题目内容",
      "diagramSvg": "<svg ...>...</svg>",
      "difficulty": "难度"
    }}
  ]
}}

要求：
1. 每一道题必须检验这些完全相同的知识点：{source_knowledge_points}，不要加入原错题没有涉及的新知识点或新薄弱点
2. 难度与原题相当或略简单
3. 题目要有变化，不要完全一样
4. 如果题目是几何题，必须同时返回一张可以直接渲染的几何示意图 `diagramSvg`
5. 几何题的 `diagramSvg` 只能画题干中出现的点、线段、角和已知数字；点在线段上、延长线上、连接关系必须与题干一致
6. `diagramSvg` 必须是完整可用的 SVG 字符串，不要放在 Markdown 代码块里；如果你无法稳定生成，就返回空字符串
7. 此阶段不要提供答案、解析或解题思路，只负责出题
8. 文字题或不需要图形的题目，`diagramSvg` 可以为空字符串'''
            }
        ]
        messages = [m for m in messages if m]

        try:
            ai_response = chat_completion_json(messages, temperature=0.7, user_id=user_id)
        except Exception as e:
            return jsonify({'message': f'生成失败: {str(e)}', 'code': 'AI_ERROR'}), 500

        questions = ai_response.get('questions', [])
    similar_ids = []
    accepted_questions = []

    with transaction() as conn:
        for q in questions:
            similar_id = new_id()
            raw_diagram_svg = normalize_diagram_svg(q.get('diagramSvg', ''))
            effective_diagram_svg = get_effective_similar_diagram_svg(q.get('questionText', ''), raw_diagram_svg)
            solved = {
                'referenceAnswer': str(q.get('answer') or q.get('referenceAnswer') or '').strip(),
                'explanation': str(q.get('explanation') or '').strip(),
            }
            if not solved['referenceAnswer'] or not solved['explanation']:
                solved = solve_similar_question_with_ai(q.get('questionText', ''), effective_diagram_svg, user_id)
            if not validate_geometry_consistency(
                q.get('questionText', ''),
                effective_diagram_svg,
                solved.get('referenceAnswer', ''),
                solved.get('explanation', ''),
            ):
                current_app.logger.warning(
                    'Skip inconsistent generated geometry question: %s',
                    q.get('questionText', ''),
                )
                continue
            conn.execute(
            '''INSERT INTO similar_questions
                   (id, wrong_question_id, user_id, question_text, diagram_svg, answer, explanation, knowledge_points, difficulty)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    similar_id,
                    question_id,
                    user_id,
                    q.get('questionText', ''),
                    effective_diagram_svg,
                    solved.get('referenceAnswer', ''),
                    solved.get('explanation', ''),
                    source_knowledge_points_json,
                    q.get('difficulty', question['difficulty'])
                )
            )
            similar_ids.append(similar_id)
            accepted_questions.append({
                **q,
                'diagramSvg': effective_diagram_svg,
                'answer': solved.get('referenceAnswer', ''),
                'explanation': solved.get('explanation', ''),
                'knowledgePoints': source_knowledge_points,
            })

    return jsonify({
        'message': f'已生成{len(similar_ids)}道相似题目',
        'data': {'questionIds': similar_ids, 'questions': accepted_questions}
    })


@bp.post('/<question_id>/similar/<similar_id>/submit')
@login_required
def submit_similar_answer(question_id, similar_id):
    """提交相似题答案"""
    user_id = current_user_id()
    data = request.get_json(silent=True) or {}
    user_answer = data.get('answer', '').strip()

    if not user_answer:
        return jsonify({'message': '答案不能为空', 'code': 'VALIDATION_ERROR'}), 400

    with transaction() as conn:
        row = conn.execute(
            'SELECT * FROM similar_questions WHERE id = ? AND user_id = ?',
            (similar_id, user_id)
        ).fetchone()

    if not row:
        return jsonify({'message': '题目不存在', 'code': 'NOT_FOUND'}), 404

    similar = row_to_dict(row)

    personalized_context = get_personalized_context(user_id)
    effective_diagram_svg = get_effective_similar_diagram_svg(
        similar.get('question_text', ''),
        similar.get('diagram_svg', ''),
    )
    solved = {
        'referenceAnswer': str(similar.get('answer') or '').strip(),
        'explanation': str(similar.get('explanation') or '').strip(),
    }
    if not solved['referenceAnswer'] or not solved['explanation']:
        solved = solve_similar_question_with_ai(similar.get('question_text', ''), effective_diagram_svg, user_id)

    reference_answer = str(solved.get('referenceAnswer') or '').strip()
    explanation = str(solved.get('explanation') or '').strip()
    if not reference_answer:
        fallback = solve_geometry_family(similar.get('question_text', '')) or solve_canonical_geometry_question(
            similar.get('question_text', '')
        )
        if fallback:
            reference_answer = str(fallback.get('referenceAnswer') or '').strip()
            explanation = str(fallback.get('explanation') or fallback.get('feedback') or '').strip()
    if not explanation:
        explanation = '根据题目条件先找等量关系，再由角度和性质推导目标角。'

    judge_messages = [
        {'role': 'user', 'content': personalized_context} if personalized_context else None,
        {
            'role': 'user',
            'content': f'''请判断学生答案是否与标准答案等价，并给出简洁反馈。

题目：{similar['question_text']}
标准答案：{reference_answer}
参考解析：{explanation}
学生答案：{user_answer}

请以 JSON 返回：
{{
  "isCorrect": true/false,
  "feedback": "面向学生的讲解反馈"
}}'''
        }
    ]
    judge_messages = [m for m in judge_messages if m]

    try:
        judge_response = chat_completion_json(judge_messages, temperature=0.2, model=config.TEXT_MODEL, user_id=user_id)
    except Exception:
        expected_value = parse_numeric_answer(reference_answer)
        user_value = parse_numeric_answer(user_answer)
        is_correct = expected_value is not None and user_value is not None and abs(expected_value - user_value) < 1e-6
        judge_response = {
            'isCorrect': is_correct,
            'feedback': explanation or '暂时无法判断，请稍后重试。',
        }

    is_correct = bool(judge_response.get('isCorrect', False))
    feedback = str(judge_response.get('feedback') or explanation or '暂时无法判断，请稍后重试。').strip()

    with transaction() as conn:
        conn.execute(
            '''UPDATE similar_questions
               SET user_answer = ?, answer = ?, explanation = ?, diagram_svg = ?, is_correct = ?, answered_at = datetime('now')
               WHERE id = ?''',
            (user_answer, reference_answer, explanation, effective_diagram_svg, 1 if is_correct else 0, similar_id)
        )

        # 更新原错题的掌握度
        if is_correct:
            conn.execute(
                '''UPDATE wrong_questions
                   SET mastery_level = mastery_level + 10, review_count = review_count + 1,
                       last_reviewed_at = datetime('now'), updated_at = datetime('now')
                   WHERE id = ?''',
                (question_id,)
            )

    return jsonify({
        'message': '提交成功',
        'data': {
            'isCorrect': is_correct,
            'feedback': feedback
        }
    })


@bp.delete('/<question_id>')
@login_required
def delete_wrong_question(question_id):
    """删除错题"""
    user_id = current_user_id()

    with transaction() as conn:
        result = conn.execute(
            'DELETE FROM wrong_questions WHERE id = ? AND user_id = ?',
            (question_id, user_id)
        )

        if result.rowcount == 0:
            return jsonify({'message': '错题不存在', 'code': 'NOT_FOUND'}), 404

    return jsonify({'message': '删除成功'})


@bp.get('/review/plan')
@login_required
def get_review_plan():
    """获取复习计划"""
    user_id = current_user_id()

    with transaction() as conn:
        # 获取需要复习的错题
        rows = rows_to_dicts(conn.execute(
            '''SELECT * FROM wrong_questions
               WHERE user_id = ? AND status != 'mastered' AND next_review_at <= datetime('now')
               ORDER BY next_review_at
               LIMIT 10''',
            (user_id,)
        ).fetchall())

    # 转换为camelCase
    questions = []
    for row in rows:
        questions.append({
            'id': row['id'],
            'questionText': row['question_text'],
            'subject': row['subject'],
            'difficulty': row['difficulty'],
            'errorType': row['error_type'],
            'knowledgePoints': json_loads(row.get('knowledge_points', '[]'), []),
            'createdAt': row['created_at']
        })

    return jsonify({
        'data': {
            'reviewCount': len(questions),
            'questions': questions
        }
    })


@bp.post('/review/summary')
@login_required
def generate_review_summary():
    """生成复盘总结"""
    user_id = current_user_id()
    data = request.get_json(silent=True) or {}
    days = int(data.get('days', 7))

    with transaction() as conn:
        # 获取最近的错题
        rows = rows_to_dicts(conn.execute(
            '''SELECT * FROM wrong_questions
               WHERE user_id = ? AND created_at >= datetime('now', ?)
               ORDER BY created_at DESC''',
            (user_id, f'-{days} days')
        ).fetchall())

    if not rows:
        return jsonify({'message': '暂无错题数据', 'code': 'NO_DATA'}), 404

    # 统计分析
    subjects = {}
    error_types = {}
    knowledge_points = []

    for row in rows:
        subject = row.get('subject', '未分类')
        subjects[subject] = subjects.get(subject, 0) + 1

        error_type = row.get('error_type', '未分类')
        error_types[error_type] = error_types.get(error_type, 0) + 1

        kps = json_loads(row.get('knowledge_points', '[]'), [])
        knowledge_points.extend(kps)

    profile_context = get_user_profile_context(user_id)

    # AI生成复盘总结
    messages = [
        {'role': 'user', 'content': profile_context} if profile_context else None,
        {
            'role': 'user',
            'content': f'''请基于以下错题数据生成复盘总结：

错题总数：{len(rows)}
科目分布：{json.dumps(subjects, ensure_ascii=False)}
错误类型分布：{json.dumps(error_types, ensure_ascii=False)}
涉及知识点：{list(set(knowledge_points))}

请以JSON格式返回：
{{
  "summary": "总体分析",
  "weaknesses": ["薄弱点1", "薄弱点2"],
  "suggestions": ["建议1", "建议2"],
  "focusAreas": ["重点关注领域1", "重点关注领域2"]
}}'''
        }
    ]
    messages = [m for m in messages if m]

    try:
        ai_response = chat_completion_json(messages, temperature=0.7, user_id=user_id)
    except Exception as e:
        return jsonify({'message': f'生成失败: {str(e)}', 'code': 'AI_ERROR'}), 500

    return jsonify({
        'data': {
            'period': f'最近{days}天',
            'totalCount': len(rows),
            'subjects': subjects,
            'errorTypes': error_types,
            'summary': ai_response.get('summary', ''),
            'weaknesses': ai_response.get('weaknesses', []),
            'suggestions': ai_response.get('suggestions', []),
            'focusAreas': ai_response.get('focusAreas', [])
        }
    }), 200


@bp.route('/practice/generate', methods=['POST'])
@login_required
def generate_practice():
    """根据错题生成专项练习"""
    user_id = current_user_id()
    data = request.get_json() or {}
    count = data.get('count', 5)

    if not isinstance(count, int) or count < 1 or count > 20:
        return jsonify({'message': '题目数量必须在1-20之间', 'code': 'INVALID_COUNT'}), 400

    # 获取用户的错题，优先选择最近的、掌握度低的
    with transaction() as conn:
        rows = conn.execute(
            '''SELECT id, question_text, options, subject, difficulty, error_type,
                      knowledge_points, correct_answer, mastery_level
               FROM wrong_questions
               WHERE user_id = ? AND status != 'archived'
               ORDER BY mastery_level ASC, created_at DESC
               LIMIT 10''',
            (user_id,)
        ).fetchall()

    if not rows:
        return jsonify({'message': '暂无错题记录，无法生成练习', 'code': 'NO_WRONG_QUESTIONS'}), 400

    # 提取知识点和错误类型
    knowledge_points = []
    error_types = []
    subjects = []
    for row in rows:
        kps = json_loads(row['knowledge_points'], [])
        knowledge_points.extend(kps)
        if row['error_type']:
            error_types.append(row['error_type'])
        if row['subject']:
            subjects.append(row['subject'])

    knowledge_points = list(set(knowledge_points))[:5]
    error_types = list(set(error_types))[:3]
    subjects = list(set(subjects))

    profile_context = get_user_profile_context(user_id)

    # AI生成专项练习题
    messages = [
        {'role': 'user', 'content': profile_context} if profile_context else None,
        {
            'role': 'user',
            'content': f'''请根据学生的错题情况，生成{count}道针对性的练习题。

学生的薄弱知识点：{', '.join(knowledge_points) if knowledge_points else '无'}
常见错误类型：{', '.join(error_types) if error_types else '无'}
科目：{', '.join(subjects) if subjects else '数学'}

要求：
1. 题目要针对学生的薄弱点，难度适中
2. 每道题必须是选择题，有4个选项（A、B、C、D）
3. 题目要有区分度，能检验学生是否真正掌握了知识点
4. 返回JSON格式

{{
  "questions": [
    {{
      "questionText": "题目内容",
      "options": ["A. 选项A", "B. 选项B", "C. 选项C", "D. 选项D"],
      "correctAnswer": "A",
      "explanation": "详细解析",
      "knowledgePoints": ["知识点1", "知识点2"],
      "difficulty": "中等"
    }}
  ]
}}

注意：
- questionText只包含题干，不包含选项
- options必须是4个选项的数组，格式为"字母. 内容"
- correctAnswer只写字母（A/B/C/D）
- explanation要详细说明解题思路
- 数学公式使用LaTeX格式：行内用\\(...\\)，块级用\\[...\\]'''
        }
    ]
    messages = [m for m in messages if m]

    try:
        ai_response = chat_completion_json(messages, temperature=0.7, user_id=user_id)
    except Exception as e:
        current_app.logger.exception('Generate practice questions failed')
        return jsonify({'message': '生成练习失败，请稍后重试', 'code': 'AI_ERROR'}), 500

    questions = ai_response.get('questions', [])
    if not questions:
        return jsonify({'message': '生成练习失败，请稍后重试', 'code': 'NO_QUESTIONS'}), 500

    # 保存到数据库
    session_id = new_id()
    question_ids = []

    with transaction() as conn:
        for q in questions:
            q_id = new_id()
            question_ids.append(q_id)
            conn.execute(
                '''INSERT INTO practice_questions
                   (id, user_id, knowledge_name, question_text, choices, correct_answer, explanation, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    q_id,
                    user_id,
                    ', '.join(q.get('knowledgePoints', [])),
                    q.get('questionText', ''),
                    json_dumps(q.get('options', [])),
                    q.get('correctAnswer', ''),
                    q.get('explanation', ''),
                    datetime.now().isoformat()
                )
            )

    return jsonify({
        'data': {
            'sessionId': session_id,
            'questions': [
                {
                    'id': question_ids[i],
                    'questionText': q.get('questionText', ''),
                    'options': q.get('options', []),
                    'knowledgePoints': q.get('knowledgePoints', []),
                    'difficulty': q.get('difficulty', '中等')
                }
                for i, q in enumerate(questions)
            ]
        }
    }), 200


@bp.route('/practice/submit', methods=['POST'])
@login_required
def submit_practice_answer():
    """提交专项练习答案"""
    user_id = current_user_id()
    data = request.get_json() or {}

    question_id = data.get('questionId')
    user_answer = data.get('answer', '').strip()

    if not question_id:
        return jsonify({'message': '缺少题目ID', 'code': 'MISSING_QUESTION_ID'}), 400

    # 获取题目信息
    with transaction() as conn:
        question = conn.execute(
            '''SELECT id, question_text, choices, correct_answer, explanation, knowledge_name
               FROM practice_questions
               WHERE id = ? AND user_id = ?''',
            (question_id, user_id)
        ).fetchone()

        if not question:
            return jsonify({'message': '题目不存在', 'code': 'QUESTION_NOT_FOUND'}), 404

        correct_answer = question['correct_answer']
        is_correct = user_answer.upper() == correct_answer.upper()

        # 保存提交记录
        submission_id = new_id()
        conn.execute(
            '''INSERT INTO practice_submissions
               (id, user_id, question_id, answer, is_correct, created_at)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (submission_id, user_id, question_id, user_answer, 1 if is_correct else 0, datetime.now().isoformat())
        )

        # 如果答错了，自动加入错题本
        if not is_correct:
            wrong_q_id = new_id()
            conn.execute(
                '''INSERT INTO wrong_questions
                   (id, user_id, question_text, options, subject, difficulty, user_answer, correct_answer,
                    error_type, error_analysis, knowledge_points, ai_explanation, status, next_review_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    wrong_q_id,
                    user_id,
                    question['question_text'],
                    question['choices'],
                    '数学',  # 默认科目
                    '中等',
                    user_answer,
                    correct_answer,
                    '练习错误',
                    f'在专项练习中答错了这道题，你选择了{user_answer}，正确答案是{correct_answer}。',
                    json_dumps([question['knowledge_name']]) if question['knowledge_name'] else '[]',
                    question['explanation'],
                    'pending',
                    (datetime.now() + timedelta(days=1)).isoformat(),
                    datetime.now().isoformat()
                )
            )

    return jsonify({
        'data': {
            'isCorrect': is_correct,
            'correctAnswer': correct_answer,
            'explanation': question['explanation'],
            'addedToWrongQuestions': not is_correct
        }
    }), 200
