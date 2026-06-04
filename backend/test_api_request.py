"""
Test SimplifyAI API with actual request
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from services.simplifyai_translation import create_translation_task
import requests

# Test with a minimal PDF
test_pdf = Path(__file__).parent / "test_sample.pdf"
test_pdf.write_bytes(b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000056 00000 n\n0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n210\n%%EOF")

print("Testing SimplifyAI API...")
print(f"Test PDF created: {test_pdf}")

try:
    print("\nAttempting to create translation task...")
    task = create_translation_task(
        str(test_pdf),
        from_lang="en",
        to_lang="zh-CN",
        client_task_id="test-task-001"
    )
    print(f"[OK] Success! Task ID: {task.task_id}")
    print(f"  Status: {task.status}")
    print(f"  Progress: {task.progress}")
except requests.exceptions.HTTPError as e:
    print(f"[X] HTTP Error: {e}")
    if hasattr(e, 'response'):
        print(f"  Status Code: {e.response.status_code}")
        print(f"  Response: {e.response.text}")
        print(f"  Request URL: {e.response.url}")
except Exception as e:
    print(f"[X] Error: {e}")
finally:
    if test_pdf.exists():
        test_pdf.unlink()
        print(f"\nTest PDF cleaned up")
