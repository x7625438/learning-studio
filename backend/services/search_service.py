from __future__ import annotations

import os
from typing import Any

import requests


def search_web(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    """
    使用 Tavily API 进行网络搜索

    Args:
        query: 搜索查询
        max_results: 最大结果数量

    Returns:
        搜索结果列表，每个结果包含 title, url, content
    """
    api_key = os.getenv('TAVILY_API_KEY', '').strip()
    if not api_key:
        return []

    try:
        response = requests.post(
            'https://api.tavily.com/search',
            json={
                'api_key': api_key,
                'query': query,
                'max_results': max_results,
                'search_depth': 'basic',
                'include_answer': True,
                'include_raw_content': False,
            },
            timeout=10,
        )

        if response.status_code != 200:
            return []

        data = response.json()
        results = []

        # 如果有直接答案，添加到结果中
        if data.get('answer'):
            results.append({
                'title': '搜索摘要',
                'url': '',
                'content': data['answer'],
            })

        # 添加搜索结果
        for item in data.get('results', []):
            results.append({
                'title': item.get('title', ''),
                'url': item.get('url', ''),
                'content': item.get('content', ''),
            })

        return results[:max_results]

    except Exception:
        return []


def format_search_results(results: list[dict[str, Any]]) -> str:
    """
    将搜索结果格式化为文本，供 AI 使用

    Args:
        results: 搜索结果列表

    Returns:
        格式化的搜索结果文本
    """
    if not results:
        return ''

    lines = ['网络搜索结果：\n']

    for i, result in enumerate(results, 1):
        title = result.get('title', '无标题')
        content = result.get('content', '')
        url = result.get('url', '')

        lines.append(f'{i}. {title}')
        if content:
            # 限制内容长度
            content_preview = content[:300] + ('...' if len(content) > 300 else '')
            lines.append(f'   {content_preview}')
        if url:
            lines.append(f'   来源: {url}')
        lines.append('')

    return '\n'.join(lines)


def should_search(user_input: str) -> bool:
    """
    判断用户输入是否需要进行网络搜索

    Args:
        user_input: 用户输入

    Returns:
        是否需要搜索
    """
    # 关键词触发
    search_keywords = [
        '最新', '最近', '现在', '当前', '今年', '2025', '2026',
        '搜索', '查找', '查询', '找一下',
        '新闻', '动态', '趋势', '发展',
    ]

    user_input_lower = user_input.lower()

    for keyword in search_keywords:
        if keyword in user_input_lower:
            return True

    return False
