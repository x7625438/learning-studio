from __future__ import annotations

import base64
import json
import mimetypes
import re
import urllib.request
from pathlib import Path
from collections.abc import Generator
from typing import Any
from uuid import uuid4

from openai import OpenAI

import config
from services.personalization import with_learning_context, with_knowledge_context


class AIServiceError(RuntimeError):
    pass


client = OpenAI(
    api_key=config.AI_API_KEY,
    base_url=config.AI_BASE_URL,
    timeout=120.0  # 120秒超时
)


def normalize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for message in messages:
        role = message.get('role') or 'user'
        content = message.get('content')

        if isinstance(content, list):
            if role == 'system':
                role = 'user'
            if role == 'ai':
                role = 'assistant'
            if role not in {'user', 'assistant'}:
                role = 'user'
            if content:
                normalized.append({'role': role, 'content': content})
            continue

        content = str(content or '')
        if not content.strip():
            continue
        if role == 'system':
            normalized.append({'role': 'user', 'content': f'系统指令：{content}'})
            continue
        if role == 'ai':
            role = 'assistant'
        if role not in {'user', 'assistant'}:
            role = 'user'
        normalized.append({'role': role, 'content': content})

    return normalized or [{'role': 'user', 'content': '请继续。'}]


def strip_thinking(text: str) -> str:
    text = re.sub(r'<think>.*?</think>', '', text or '', flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'</?think>', '', text, flags=re.IGNORECASE)
    return text.strip()


def chat_completion(messages: list[dict[str, Any]], temperature: float = 0.7, model: str | None = None, user_id: str | None = None) -> str:
    try:
        contextualized = with_knowledge_context(with_learning_context(messages, user_id), user_id)
        response = client.chat.completions.create(
            model=model or config.TEXT_MODEL,
            messages=normalize_messages(contextualized),
            temperature=temperature,
        )
        return strip_thinking(response.choices[0].message.content or '')
    except Exception as exc:
        raise AIServiceError(str(exc)) from exc


def chat_completion_json(
    messages: list[dict[str, Any]],
    fallback: dict[str, Any] | None = None,
    temperature: float = 0.4,
    model: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    prompted = [dict(message) for message in messages]
    prompted.append({'role': 'user', 'content': '只返回合法 JSON，不要使用 markdown 代码块。'})
    try:
        content = chat_completion(prompted, temperature, model=model, user_id=user_id).strip()
        return parse_json_object(content)
    except Exception:
        if fallback is not None:
            return fallback
        raise


def parse_json_object(content: str) -> dict[str, Any]:
    cleaned = strip_thinking(content).strip()
    if cleaned.startswith('```'):
        cleaned = re.sub(r'^```(?:json)?\s*|\s*```$', '', cleaned, flags=re.DOTALL).strip()
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find('{')
        end = cleaned.rfind('}')
        if start < 0 or end <= start:
            raise
        try:
            payload = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            # Try to fix common escape issues in LaTeX formulas
            fixed = cleaned[start : end + 1]
            # Replace unescaped backslashes in string values (but not already escaped ones)
            fixed = re.sub(r'(?<!\\)\\(?!["\\/bfnrtu])', r'\\\\', fixed)
            payload = json.loads(fixed)
    if not isinstance(payload, dict):
        raise AIServiceError('AI response JSON must be an object')
    return payload


def stream_chat(
    messages: list[dict[str, Any]],
    final_payload: dict[str, Any] | None = None,
    temperature: float = 0.7,
    model: str | None = None,
    extra_body: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> Generator[str, None, None]:
    try:
        contextualized = with_knowledge_context(with_learning_context(messages, user_id), user_id)
        response = client.chat.completions.create(
            model=model or config.TEXT_MODEL,
            messages=normalize_messages(contextualized),
            temperature=temperature,
            stream=True,
            extra_body=extra_body,
        )
        cleaner = ThinkingStreamCleaner()
        for chunk in response:
            token = ''
            if chunk.choices and chunk.choices[0].delta.content:
                token = chunk.choices[0].delta.content
            if not token:
                continue
            visible = cleaner.feed(token)
            if visible:
                yield sse('stream', {'type': 'text', 'content': visible})
        tail = cleaner.flush()
        if tail:
            yield sse('stream', {'type': 'text', 'content': tail})
        if final_payload:
            yield sse('final', final_payload)
        yield sse('done', {'type': 'done'})
    except Exception as exc:
        yield sse('error', {'type': 'error', 'message': f'AI 服务暂时不可用：{exc}'})


def upload_ai_file(path: str | Path) -> int:
    file_path = Path(path)
    boundary = f'----AIProviderBoundary{uuid4().hex}'
    mime_type = mimetypes.guess_type(file_path.name)[0] or 'application/octet-stream'
    file_bytes = file_path.read_bytes()

    body = bytearray()
    body.extend(f'--{boundary}\r\n'.encode('utf-8'))
    body.extend(b'Content-Disposition: form-data; name="purpose"\r\n\r\n')
    body.extend(b'file-extract\r\n')
    body.extend(f'--{boundary}\r\n'.encode('utf-8'))
    body.extend(
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'.encode('utf-8')
    )
    body.extend(f'Content-Type: {mime_type}\r\n\r\n'.encode('utf-8'))
    body.extend(file_bytes)
    body.extend(b'\r\n')
    body.extend(f'--{boundary}--\r\n'.encode('utf-8'))

    request = urllib.request.Request(
        url=f'{config.AI_BASE_URL}/files/upload',
        data=bytes(body),
        headers={
            'Authorization': f'Bearer {config.AI_API_KEY}',
            'Content-Type': f'multipart/form-data; boundary={boundary}',
        },
        method='POST',
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode('utf-8'))

    file_id = payload.get('file', {}).get('file_id') or payload.get('file_id')
    if file_id is None:
        raise AIServiceError(f'Upload file failed: {payload}')
    return int(file_id)


def delete_ai_file(file_id: int) -> None:
    request = urllib.request.Request(
        url=f'{config.AI_BASE_URL}/files/retrieve?file_id={file_id}',
        headers={'Authorization': f'Bearer {config.AI_API_KEY}'},
        method='DELETE',
    )
    try:
        with urllib.request.urlopen(request, timeout=30):
            return
    except Exception:
        return


def stream_pdf_attachment_chat(
    prompt: str,
    pdf_path: str | Path,
    final_payload: dict[str, Any] | None = None,
    temperature: float = 0.3,
    user_id: str | None = None,
) -> Generator[str, None, None]:
    try:
        file_id = upload_ai_file(pdf_path)
    except Exception as exc:
        yield sse('error', {'type': 'error', 'message': f'PDF 附件上传失败：{exc}'})
        return
    try:
        kwargs = {'user_id': user_id} if user_id else {}
        yield from stream_chat(
            [{'role': 'user', 'content': prompt}],
            final_payload=final_payload,
            temperature=temperature,
            extra_body={'file_id': file_id},
            **kwargs,
        )
    finally:
        delete_ai_file(file_id)


def stream_vision_chat(
    prompt: str,
    images: list[bytes],
    final_payload: dict[str, Any] | None = None,
    temperature: float = 0.2,
    user_id: str | None = None,
) -> Generator[str, None, None]:
    content: list[dict[str, Any]] = [{'type': 'text', 'text': prompt}]
    for image_bytes in images:
        content.append(
            {
                'type': 'image_url',
                'image_url': {
                    'url': f"data:image/png;base64,{base64.b64encode(image_bytes).decode('utf-8')}"
                },
            }
        )

    messages = [{'role': 'user', 'content': content}]
    primary_events = list(
        stream_chat(
            messages,
            final_payload=final_payload,
            temperature=temperature,
            model=config.VISION_MODEL,
            user_id=user_id,
        )
    )

    if any('unknown model' in event.lower() for event in primary_events) and config.VISION_MODEL != config.TEXT_MODEL:
        yield sse(
            'stream',
            {
                'type': 'text',
                'content': '当前视觉模型不可用，正在切换到兼容模型重试...',
            },
        )
        yield from stream_chat(
            messages,
            final_payload=final_payload,
            temperature=temperature,
            model=config.TEXT_MODEL,
            user_id=user_id,
        )
        return

    for event in primary_events:
        yield event


class ThinkingStreamCleaner:
    def __init__(self) -> None:
        self.buffer = ''
        self.inside_think = False

    def feed(self, token: str) -> str:
        self.buffer += token
        output: list[str] = []
        while self.buffer:
            lower = self.buffer.lower()
            if self.inside_think:
                close_index = lower.find('</think>')
                if close_index == -1:
                    self.buffer = self.buffer[-7:]
                    return ''
                self.buffer = self.buffer[close_index + len('</think>'):]
                self.inside_think = False
                continue

            open_index = lower.find('<think>')
            partial_index = find_partial_tag_prefix(lower, '<think>')
            if open_index == -1:
                if partial_index >= 0:
                    output.append(self.buffer[:partial_index])
                    self.buffer = self.buffer[partial_index:]
                    return ''.join(output)
                output.append(self.buffer)
                self.buffer = ''
                return ''.join(output)

            output.append(self.buffer[:open_index])
            self.buffer = self.buffer[open_index + len('<think>'):]
            self.inside_think = True
        return ''.join(output)

    def flush(self) -> str:
        if self.inside_think:
            self.buffer = ''
            self.inside_think = False
            return ''
        visible = strip_thinking(self.buffer)
        self.buffer = ''
        return visible


def find_partial_tag_prefix(text: str, tag: str) -> int:
    max_len = min(len(text), len(tag) - 1)
    for length in range(max_len, 0, -1):
        if tag.startswith(text[-length:]):
            return len(text) - length
    return -1


def sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def compact_prompt(title: str, body: str) -> list[dict[str, str]]:
    return [
        {'role': 'user', 'content': f'系统指令：{title}'},
        {'role': 'user', 'content': body},
    ]
