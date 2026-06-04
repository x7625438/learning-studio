# AI Starfield Knowledge Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI-generated starfield knowledge graph from a user-entered topic.

**Architecture:** Keep the existing Flask endpoint and Zustand store. Add backend graph-building helpers around `chat_completion_json`, then replace the React page's card-like layout with a deterministic starfield SVG/HTML composition.

**Tech Stack:** Flask, SQLite persistence, DeepSeek/OpenAI-compatible chat JSON, React, TypeScript, Vite, Tailwind CSS, Vitest/pytest.

---

### Task 1: Backend Graph Builder

**Files:**
- Modify: `backend/blueprints/writing_documents_graph.py`
- Test: `backend/tests/test_knowledge_graph_ai_generation.py`

- [ ] Write tests that monkeypatch `chat_completion_json` and assert generated nodes/edges are normalized.
- [ ] Run `python -m pytest tests/test_knowledge_graph_ai_generation.py -q` from `backend` and confirm the new test fails because helper functions do not exist yet.
- [ ] Add helpers for prompt creation, fallback graph creation, node normalization, edge normalization, and graph assembly.
- [ ] Update `/knowledge-graph/generate` to call the helper and persist `summary`, `nodes`, and `edges`.
- [ ] Re-run the backend test and confirm it passes.

### Task 2: Frontend Starfield

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/pages/KnowledgeGraph.tsx`
- Modify: `frontend/src/store/index.ts`

- [ ] Extend graph types with optional `summary` and node `description`.
- [ ] Add a longer request timeout for graph generation.
- [ ] Replace the current absolute card layout with a deterministic starfield layout, dashed SVG edges, selectable stars, and a detail panel.
- [ ] Run `npm run build` from `frontend` and fix any TypeScript/build issues.

### Task 3: Verification

**Files:**
- Read: test/build outputs only.

- [ ] Run the targeted backend test.
- [ ] Run the frontend production build.
- [ ] Summarize changed files and any unverified areas.
