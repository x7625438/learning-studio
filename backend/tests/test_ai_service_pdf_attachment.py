from pathlib import Path

from services import ai_service


def test_stream_chat_passes_extra_body_to_client(monkeypatch):
    captured = {}

    class Delta:
        content = '你好'

    class Choice:
        delta = Delta()

    class Chunk:
        choices = [Choice()]

    def fake_create(**kwargs):
        captured.update(kwargs)
        return [Chunk()]

    monkeypatch.setattr(ai_service.client.chat.completions, 'create', fake_create)

    events = list(
        ai_service.stream_chat(
            [{'role': 'user', 'content': 'hello'}],
            extra_body={'file_id': 12345},
        )
    )

    assert captured['extra_body'] == {'file_id': 12345}
    assert any('你好' in event for event in events)


def test_stream_pdf_attachment_chat_uploads_then_cleans_up(monkeypatch, tmp_path):
    pdf_path = tmp_path / 'lesson.pdf'
    pdf_path.write_bytes(b'%PDF-1.4 demo')
    calls = []

    monkeypatch.setattr(ai_service, 'upload_ai_file', lambda path: calls.append(('upload', path)) or 999)
    monkeypatch.setattr(ai_service, 'delete_ai_file', lambda file_id: calls.append(('delete', file_id)))

    def fake_stream_chat(messages, final_payload=None, temperature=0.7, model=None, extra_body=None):
        calls.append(('stream', messages, extra_body))
        yield 'event: done\ndata: {"type":"done"}\n\n'

    monkeypatch.setattr(ai_service, 'stream_chat', fake_stream_chat)

    events = list(ai_service.stream_pdf_attachment_chat('解释这份教材', pdf_path))

    assert ('upload', pdf_path) in calls
    assert any(call[0] == 'stream' and call[2] == {'file_id': 999} for call in calls)
    assert ('delete', 999) in calls
    assert events[-1].startswith('event: done')


def test_stream_pdf_attachment_chat_returns_error_event_when_upload_fails(monkeypatch, tmp_path):
    pdf_path = tmp_path / 'lesson.pdf'
    pdf_path.write_bytes(b'%PDF-1.4 demo')

    monkeypatch.setattr(ai_service, 'upload_ai_file', lambda path: (_ for _ in ()).throw(RuntimeError('upload failed')))

    events = list(ai_service.stream_pdf_attachment_chat('解释这份教材', pdf_path))

    assert any('event: error' in event for event in events)
    assert any('upload failed' in event for event in events)
