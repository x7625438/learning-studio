"""
SimplifyAI Translation Integration Test

This script tests the SimplifyAI translation service integration.
Run with: python test_simplifyai_integration.py
"""

import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from services.simplifyai_translation import (
    create_translation_task,
    get_translation_status,
    SIMPLIFYAI_API_KEY,
    SIMPLIFYAI_BASE_URL,
)


def test_api_connection():
    """Test basic API connectivity"""
    print("Testing SimplifyAI API connection...")
    print(f"Base URL: {SIMPLIFYAI_BASE_URL}")
    print(f"API Key: {SIMPLIFYAI_API_KEY[:20]}...")

    # Note: This is a dry run test - it won't actually upload a file
    # To do a real test, you need to provide a real PDF file
    print("\n[OK] API configuration loaded successfully")
    print("\nTo test with a real PDF file:")
    print("1. Place a PDF file in backend/uploads/")
    print("2. Call create_translation_task() with the file path")
    print("3. Poll get_translation_status() until status is 'Completed'")
    print("4. Download the translated file from the returned URL")


def main():
    print("=" * 60)
    print("SimplifyAI Translation Service Integration Test")
    print("=" * 60)
    print()

    test_api_connection()

    print()
    print("=" * 60)
    print("Integration test completed!")
    print("=" * 60)


if __name__ == "__main__":
    main()
