import pytest
from unittest.mock import patch, MagicMock

from services.simplifyai_translation import (
    create_translation_task,
    get_translation_status,
    download_translated_file,
    wait_for_translation,
    translate_pdf_stream,
    TranslationTask,
)


@pytest.fixture
def mock_pdf_file(tmp_path):
    """Create a temporary PDF file for testing"""
    pdf_file = tmp_path / "test.pdf"
    pdf_file.write_bytes(b"%PDF-1.4\n%%EOF")
    return str(pdf_file)


def test_create_translation_task_success(mock_pdf_file):
    """Test creating a translation task"""
    mock_response = MagicMock()
    mock_response.status_code = 201
    mock_response.json.return_value = {
        "taskId": "task-123",
        "status": "Analyzing",
        "progress": 0
    }

    with patch('services.simplifyai_translation.SIMPLIFYAI_API_KEY', 'test-key'):
        with patch('services.simplifyai_translation.requests.post', return_value=mock_response):
            task = create_translation_task(mock_pdf_file, "en", "zh-CN")

            assert task.task_id == "task-123"
            assert task.status == "Analyzing"
            assert task.progress == 0


def test_create_translation_task_uses_simplifyai_language_values(mock_pdf_file):
    """SimplifyAI expects full language names, not locale-style aliases."""
    mock_response = MagicMock()
    mock_response.status_code = 201
    mock_response.json.return_value = {
        "taskId": "task-123",
        "status": "Analyzing",
        "progress": 0
    }

    with patch('services.simplifyai_translation.SIMPLIFYAI_API_KEY', 'test-key'):
        with patch('services.simplifyai_translation.requests.post', return_value=mock_response) as mock_post:
            create_translation_task(mock_pdf_file, "en", "zh-CN")

            form_data = mock_post.call_args.kwargs["data"]
            assert form_data["fromLang"] == "English"
            assert form_data["toLang"] == "Simplified Chinese"


def test_create_translation_task_http_error_includes_response_body(mock_pdf_file):
    """400 responses should expose the API's validation message."""
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.reason = "Bad Request"
    mock_response.url = "https://translate.simplifyai.cn/api/v1/translations"
    mock_response.text = '{"message":"参数不全"}'

    with patch('services.simplifyai_translation.SIMPLIFYAI_API_KEY', 'test-key'):
        with patch('services.simplifyai_translation.requests.post', return_value=mock_response):
            with pytest.raises(Exception, match="参数不全"):
                create_translation_task(mock_pdf_file, "en", "zh-CN")


def test_create_translation_task_requires_api_key(mock_pdf_file):
    with patch('services.simplifyai_translation.SIMPLIFYAI_API_KEY', ''):
        with pytest.raises(RuntimeError, match="SIMPLIFYAI_API_KEY"):
            create_translation_task(mock_pdf_file, "en", "zh-CN")


def test_create_translation_task_file_not_found():
    """Test creating task with non-existent file"""
    with pytest.raises(FileNotFoundError):
        create_translation_task("/nonexistent/file.pdf")


def test_get_translation_status():
    """Test getting translation status"""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "taskId": "task-123",
        "status": "Processing",
        "progress": 50,
        "translatedFileUrl": "https://example.com/translated.pdf",
        "price": 10.5,
        "totalPrice": 10.5
    }

    with patch('services.simplifyai_translation.SIMPLIFYAI_API_KEY', 'test-key'):
        with patch('services.simplifyai_translation.requests.get', return_value=mock_response):
            task = get_translation_status("task-123")

            assert task.task_id == "task-123"
            assert task.status == "Processing"
            assert task.progress == 50
            assert task.translated_file_url == "https://example.com/translated.pdf"
            assert task.price == 10.5


def test_get_translation_status_requires_api_key():
    with patch('services.simplifyai_translation.SIMPLIFYAI_API_KEY', ''):
        with pytest.raises(RuntimeError, match="SIMPLIFYAI_API_KEY"):
            get_translation_status("task-123")


def test_get_translation_status_http_error_includes_response_body():
    mock_response = MagicMock()
    mock_response.status_code = 404
    mock_response.reason = "Not Found"
    mock_response.url = "https://translate.simplifyai.cn/api/v1/translations/task-123"
    mock_response.text = '{"message":"任务不存在"}'

    with patch('services.simplifyai_translation.SIMPLIFYAI_API_KEY', 'test-key'):
        with patch('services.simplifyai_translation.requests.get', return_value=mock_response):
            with pytest.raises(Exception, match="任务不存在"):
                get_translation_status("task-123")


def test_download_translated_file(tmp_path):
    """Test downloading translated file"""
    output_path = tmp_path / "output.pdf"
    mock_response = MagicMock()
    mock_response.iter_content.return_value = [b"%PDF-1.4\n", b"%%EOF"]
    mock_response.raise_for_status = MagicMock()

    with patch('services.simplifyai_translation.requests.get', return_value=mock_response):
        download_translated_file("https://example.com/file.pdf", str(output_path))

        assert output_path.exists()
        assert output_path.read_bytes() == b"%PDF-1.4\n%%EOF"


def test_wait_for_translation_success():
    """Test waiting for translation to complete"""
    call_count = [0]

    def mock_get_status(task_id):
        call_count[0] += 1
        if call_count[0] < 3:
            return TranslationTask("task-123", "Processing", progress=50)
        return TranslationTask("task-123", "Completed", progress=100)

    with patch('services.simplifyai_translation.get_translation_status', side_effect=mock_get_status):
        with patch('services.simplifyai_translation.time.sleep'):
            task = wait_for_translation("task-123", poll_interval=1, max_wait=60)

            assert task.status == "Completed"
            assert task.progress == 100


def test_wait_for_translation_timeout():
    """Test timeout when waiting for translation"""
    def mock_get_status(task_id):
        return TranslationTask("task-123", "Processing", progress=10)

    with patch('services.simplifyai_translation.get_translation_status', side_effect=mock_get_status):
        with patch('services.simplifyai_translation.time.time', side_effect=[0, 100, 700]):
            with pytest.raises(TimeoutError):
                wait_for_translation("task-123", poll_interval=1, max_wait=600)


def test_wait_for_translation_failure():
    """Test handling translation failure"""
    def mock_get_status(task_id):
        return TranslationTask("task-123", "Cancelled", progress=0)

    with patch('services.simplifyai_translation.get_translation_status', side_effect=mock_get_status):
        with pytest.raises(RuntimeError, match="Translation failed"):
            wait_for_translation("task-123")


def test_translate_pdf_stream_success(mock_pdf_file, tmp_path):
    """Test streaming translation progress"""
    output_path = tmp_path / "output.pdf"

    mock_create_response = MagicMock()
    mock_create_response.status_code = 201
    mock_create_response.json.return_value = {
        "taskId": "task-123",
        "status": "Analyzing",
        "progress": 0
    }

    call_count = [0]
    def mock_get_status_response(*args, **kwargs):
        call_count[0] += 1
        response = MagicMock()
        response.status_code = 200
        if call_count[0] == 1:
            response.json.return_value = {
                "taskId": "task-123",
                "status": "Processing",
                "progress": 50
            }
        else:
            response.json.return_value = {
                "taskId": "task-123",
                "status": "Completed",
                "progress": 100,
                "translatedFileUrl": "https://example.com/translated.pdf",
                "price": 10.5,
                "totalPrice": 10.5
            }
        return response

    mock_download_response = MagicMock()
    mock_download_response.iter_content.return_value = [b"%PDF-1.4\n%%EOF"]
    mock_download_response.raise_for_status = MagicMock()

    with patch('services.simplifyai_translation.SIMPLIFYAI_API_KEY', 'test-key'):
        with patch('services.simplifyai_translation.requests.post', return_value=mock_create_response):
            with patch('services.simplifyai_translation.requests.get', side_effect=[
                mock_get_status_response(),
                mock_get_status_response(),
                mock_download_response
            ]):
                with patch('services.simplifyai_translation.time.sleep'):
                    events = list(translate_pdf_stream(mock_pdf_file, str(output_path)))

                    assert len(events) >= 3
                    assert events[0]['status'] == 'uploading'
                    assert events[-1]['status'] == 'completed'
                    assert events[-1]['message'] == '翻译完成'
                    assert output_path.exists()


def test_translate_pdf_stream_error(mock_pdf_file, tmp_path):
    """Test error handling in streaming translation"""
    output_path = tmp_path / "output.pdf"

    with patch('services.simplifyai_translation.SIMPLIFYAI_API_KEY', 'test-key'):
        with patch('services.simplifyai_translation.requests.post', side_effect=Exception("Network error")):
            with pytest.raises(Exception, match="Network error"):
                list(translate_pdf_stream(mock_pdf_file, str(output_path)))
