"""
Essay grading service — rubric templates, prompt builder, validation helpers.
"""
from __future__ import annotations

from typing import Any

from services.user_profile_service import get_user_profile_context

# ---------------------------------------------------------------------------
# Preset rubric definitions (mirrored in database.py migration)
# ---------------------------------------------------------------------------

PRESET_RUBRICS: list[dict[str, Any]] = [
    {
        'id': 'rubric-primary-chinese',
        'name': '小学语文作文评分标准',
        'examType': '小学',
        'dimensions': [
            {'name': '内容完整', 'maxScore': 12, 'description': '是否把事情的起因、经过、结果写清楚，内容是否具体'},
            {'name': '语言通顺', 'maxScore': 10, 'description': '语句是否通顺，用词是否恰当，能否用上积累的好词好句'},
            {'name': '结构清晰', 'maxScore': 5, 'description': '段落是否分明，是否有开头和结尾，叙述顺序是否清楚'},
            {'name': '书写规范', 'maxScore': 3, 'description': '标点符号是否正确，字迹是否工整，格式是否规范'},
        ],
        'totalScore': 30,
        'isPreset': True,
    },
    {
        'id': 'rubric-primary-english',
        'name': '小学英语作文评分标准',
        'examType': '小学',
        'dimensions': [
            {'name': '内容要点', 'maxScore': 6, 'description': '是否写出题目要求的要点，意思是否清楚'},
            {'name': '语言准确', 'maxScore': 5, 'description': '基本单词拼写和简单语法是否正确'},
            {'name': '书写规范', 'maxScore': 4, 'description': '字母大小写、标点和格式是否正确'},
        ],
        'totalScore': 15,
        'isPreset': True,
    },
    {
        'id': 'rubric-middle-chinese',
        'name': '初中语文作文评分标准',
        'examType': '初中',
        'dimensions': [
            {'name': '内容立意', 'maxScore': 15, 'description': '中心是否明确，内容是否充实，选材是否恰当，思想是否积极向上'},
            {'name': '结构层次', 'maxScore': 12, 'description': '结构是否完整，层次是否清楚，过渡是否自然'},
            {'name': '语言表达', 'maxScore': 13, 'description': '语言是否流畅，表达是否准确生动，修辞手法运用是否恰当'},
            {'name': '卷面书写', 'maxScore': 10, 'description': '字迹是否工整，卷面是否整洁，标点格式是否正确'},
        ],
        'totalScore': 50,
        'isPreset': True,
    },
    {
        'id': 'rubric-middle-english',
        'name': '初中英语作文评分标准',
        'examType': '初中',
        'dimensions': [
            {'name': '内容完整', 'maxScore': 8, 'description': '是否包含所有内容要点，能否适当发挥'},
            {'name': '语言准确', 'maxScore': 6, 'description': '语法结构是否正确，词汇使用是否恰当多样'},
            {'name': '结构连贯', 'maxScore': 4, 'description': '段落衔接是否自然，逻辑是否连贯'},
            {'name': '书写工整', 'maxScore': 2, 'description': '拼写是否正确，标点和大小写是否规范'},
        ],
        'totalScore': 20,
        'isPreset': True,
    },
    {
        'id': 'rubric-high-chinese',
        'name': '高中语文作文评分标准',
        'examType': '高中',
        'dimensions': [
            {'name': '内容立意', 'maxScore': 20, 'description': '立意是否深刻新颖，内容是否充实丰富，思想是否健康向上'},
            {'name': '结构逻辑', 'maxScore': 15, 'description': '结构是否完整清晰，层次是否分明，逻辑是否严密'},
            {'name': '语言表达', 'maxScore': 15, 'description': '语言是否流畅生动，表达是否准确得体，修辞是否恰当'},
            {'name': '论证充分', 'maxScore': 10, 'description': '论据是否典型有力，论证是否充分深入，分析是否透彻'},
        ],
        'totalScore': 60,
        'isPreset': True,
    },
    {
        'id': 'rubric-high-english',
        'name': '高中英语作文评分标准',
        'examType': '高中',
        'dimensions': [
            {'name': '内容要点', 'maxScore': 10, 'description': '是否覆盖所有内容要点，表达是否清楚，能否适当发挥'},
            {'name': '语言准确', 'maxScore': 8, 'description': '语法结构是否正确多样，词汇使用是否丰富恰当'},
            {'name': '结构连贯', 'maxScore': 4, 'description': '段落衔接是否自然，逻辑是否连贯，过渡是否流畅'},
            {'name': '书写规范', 'maxScore': 3, 'description': '拼写是否正确，标点大小写是否规范，格式是否整洁'},
        ],
        'totalScore': 25,
        'isPreset': True,
    },
]


def validate_dimensions(dimensions: list[dict], total_score: float) -> str | None:
    """Return an error message if dimensions are invalid, or None if valid."""
    if not dimensions:
        return '评分维度不能为空'
    if len(dimensions) < 2:
        return '至少需要2个评分维度'
    if len(dimensions) > 8:
        return '评分维度不能超过8个'
    seen: set[str] = set()
    for dim in dimensions:
        if not isinstance(dim, dict):
            return '每个评分维度必须是对象'
        name = (dim.get('name') or '').strip()
        if not name:
            return '评分维度名称不能为空'
        if name in seen:
            return f'评分维度名称重复：{name}'
        seen.add(name)
        max_score = dim.get('maxScore')
        if not isinstance(max_score, (int, float)) or max_score <= 0:
            return f'维度"{name}"的满分值必须为正数'
    dim_sum = sum(d['maxScore'] for d in dimensions)
    if abs(dim_sum - total_score) > 0.01:
        return f'各维度满分之和({dim_sum})与总分({total_score})不一致'
    return None


def build_grading_prompt(
    rubric_snapshot: dict,
    essay_text: str,
    user_id: str,
) -> list[dict[str, Any]]:
    """Build messages for the AI grading call."""
    exam_type = rubric_snapshot.get('examType', '自定义')
    rubric_name = rubric_snapshot.get('name', '评分标准')
    dimensions = rubric_snapshot.get('dimensions', [])
    total_score = rubric_snapshot.get('totalScore', 100)

    # Build dimension descriptions for the prompt
    dim_lines: list[str] = []
    for i, dim in enumerate(dimensions, 1):
        dim_lines.append(
            f'{i}. {dim["name"]}（满分 {dim["maxScore"]} 分）：{dim.get("description", "")}'
        )
    dim_text = '\n'.join(dim_lines)

    # Build JSON schema for the expected response
    dim_schema_lines: list[str] = []
    for dim in dimensions:
        dim_schema_lines.append(
            f'    {{{{"name": "{dim["name"]}", "score": 得分, "maxScore": {dim["maxScore"]}, '
            f'"feedback": "结合原文的具体评语，150字以内", "evidence": ["引用的原文关键句1", "引用的原文关键句2"]}}}}'
        )
    dim_schema_text = ',\n'.join(dim_schema_lines)

    total_score_int = int(total_score) if total_score == int(total_score) else total_score

    prompt = f"""你是【{exam_type}】的资深语文/英语老师，请严格按照以下【{rubric_name}】对学生的作文进行逐维度批改。

【评分标准】
总分：{total_score_int} 分
各维度及满分：
{dim_text}

【学生文章】
{essay_text}

【批改要求】
1. 对每个评分维度独立打分，分数必须在 0 到该维度满分之间，要有区分度（不要全给满分或全给低分）
2. 每个维度的评语必须结合文章中的具体内容作为例证，引用原文关键句
3. 总体评价要真诚，指出 2-3 个优点和 2-3 个可改进之处
4. 改进建议要具体可操作，能帮助学生真正提高
5. 语言风格：直接对学生说话，用"你"，不使用"学生""用户""考生"等第三人称
6. 语气：鼓励为主，但问题要明确指出；不用"可能""也许""似乎"等模糊措辞
7. 总分 = 各维度得分之和，不要超过 {total_score_int} 分

只返回合法 JSON（不要 markdown 代码块）：
{{
  "dimensionScores": [
{dim_schema_text}
  ],
  "totalScore": 总分（数字）,
  "overallFeedback": "总体评价，200字以内，直接对学生说话",
  "strengths": ["具体优点1", "具体优点2", "具体优点3"],
  "weaknesses": ["具体不足1", "具体不足2"],
  "suggestions": ["具体可操作的改进建议1", "具体可操作的改进建议2", "具体可操作的改进建议3"]
}}"""

    profile_context = get_user_profile_context(user_id)
    messages: list[dict[str, Any]] = []
    if profile_context:
        messages.append({'role': 'user', 'content': f'{profile_context}\n\n请结合以上学生档案信息，调整批改用词和难度，使反馈对该学生更有针对性。'})
    messages.append({'role': 'user', 'content': prompt})
    return messages


def normalize_grading_response(raw: dict, rubric_snapshot: dict) -> dict:
    """Validate and normalize the AI grading response."""
    dimensions = rubric_snapshot.get('dimensions', [])
    total_score = rubric_snapshot.get('totalScore', 100)

    # Normalize dimension scores
    raw_dims = raw.get('dimensionScores', [])
    if not isinstance(raw_dims, list):
        raw_dims = []

    normalized_dims: list[dict] = []
    for i, dim_template in enumerate(dimensions):
        raw_dim = raw_dims[i] if i < len(raw_dims) else {}
        if not isinstance(raw_dim, dict):
            raw_dim = {}
        score = raw_dim.get('score', 0)
        if not isinstance(score, (int, float)):
            score = 0
        max_score = dim_template['maxScore']
        # Clamp score to valid range
        score = max(0, min(float(score), max_score))
        normalized_dims.append({
            'name': dim_template['name'],
            'score': score,
            'maxScore': max_score,
            'feedback': str(raw_dim.get('feedback', '')).strip(),
            'evidence': raw_dim.get('evidence', []) if isinstance(raw_dim.get('evidence'), list) else [],
        })

    # Normalize total score
    raw_total = raw.get('totalScore')
    if isinstance(raw_total, (int, float)):
        computed_total = min(float(raw_total), float(total_score))
    else:
        computed_total = sum(d['score'] for d in normalized_dims)

    return {
        'dimensionScores': normalized_dims,
        'totalScore': round(computed_total, 1),
        'overallFeedback': str(raw.get('overallFeedback', '')).strip(),
        'strengths': raw.get('strengths', []) if isinstance(raw.get('strengths'), list) else [],
        'weaknesses': raw.get('weaknesses', []) if isinstance(raw.get('weaknesses'), list) else [],
        'suggestions': raw.get('suggestions', []) if isinstance(raw.get('suggestions'), list) else [],
    }
