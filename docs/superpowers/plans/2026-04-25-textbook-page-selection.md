# Textbook Page Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable textbook page selection so chosen pages are highlighted and sent as the preferred AI attachment scope.

**Architecture:** Expose backend page-image endpoints for textbook PDFs, render those pages as a scrollable image list in the frontend, and carry selected page numbers through the textbook query request. The backend query path will prefer user-selected pages when building the vision request.

**Tech Stack:** Flask, PyMuPDF, React, Vite, Vitest, Testing Library

---

### Task 1: Backend page image helpers

**Files:**
- Modify: `D:\learning_website\backend\services\textbook_service.py`
- Test: `D:\learning_website\backend\tests\test_textbook_full_pdf_vision.py`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add helper for selected-page normalization**
- [ ] **Step 4: Run test to verify it passes**

### Task 2: Backend textbook page image endpoint and selected-page query support

**Files:**
- Modify: `D:\learning_website\backend\blueprints\textbook.py`
- Test: `D:\learning_website\backend\tests\test_textbook_retrieval.py`

- [ ] **Step 1: Write failing tests for selected page precedence**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Add page image endpoint and selectedPages query handling**
- [ ] **Step 4: Run tests to verify pass**

### Task 3: Frontend page selection UI

**Files:**
- Modify: `D:\learning_website\frontend\src\pages\Textbook.tsx`
- Modify: `D:\learning_website\frontend\src\test\textbook.test.tsx`

- [ ] **Step 1: Write failing tests for page selection and selected-page sending**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Replace PDF iframe with selectable page image list and selected page state**
- [ ] **Step 4: Run tests to verify pass**

### Task 4: Verification

**Files:**
- Modify: `D:\learning_website\backend\blueprints\textbook.py`
- Modify: `D:\learning_website\frontend\src\pages\Textbook.tsx`

- [ ] **Step 1: Run backend targeted tests**
- [ ] **Step 2: Run frontend targeted tests**
- [ ] **Step 3: Run frontend build**
