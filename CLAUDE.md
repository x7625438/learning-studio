# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered learning platform with 11 active modules for exam prep and university students. Frontend is React 18 + TypeScript + Vite (port 5173); Backend is Flask + SQLite (port 5001 for local Vite proxy). AI uses Qwen models via Aliyun DashScope API (OpenAI-compatible).

**Active modules**: QA (instant Q&A), Profile (learning profile + weak points), Textbook (document chat), Practice (active recall training), WrongQuestions (error analysis + similar questions), Calendar (study calendar), Feynman (explanation training), LearningPath (path generation), Writing (canvas-style editor), DocumentEvolution, KnowledgeGraph.

## Development Commands

**Environment Setup**:
Project uses `.env` files for local configuration. Copy `.env.example` and set AI/API credentials locally before using AI-powered features.

**Backend** (requires Python 3.9+):
```bash
cd backend
pip install -r requirements.txt
python3 app.py                   # Start Flask + SocketIO on port 5001 (reads from ../.env)
python -m pytest                 # Run all tests
python -m pytest tests/test_auth.py  # Run single test file
curl http://127.0.0.1:5001/api/health  # Health check
```

**Frontend** (requires Node.js 18+):
```bash
cd frontend
npm install
npm run dev          # Start Vite dev server on port 5173
npm run build        # TypeScript compile + production build
npm run lint         # ESLint check
npm run test         # Vitest single run
npm run test:watch   # Vitest watch mode
npm run preview      # Preview production build
```

**Verification workflow** after changes:
```bash
cd frontend && npm run lint && npm run test && npm run build
cd ../backend && python -m pytest
```

## Backend Architecture

**Stack**: Flask 3.0, SQLite (WAL mode), OpenAI SDK (DeepSeek API)

**Database** (`backend/database.py`):
- `get_db()` — creates connection with `row_factory=sqlite3.Row`, WAL mode, foreign keys ON
- `init_db()` — reads `schema.sql` and executes on startup
- All endpoints must call `db.close()` manually after use

**Schema** (`backend/schema.sql`): 13 tables — `books`, `reading_progress`, `quotes`, `problem_sessions`, `pomodoro_sessions`, `relaxation_sessions`, `documents`, `resource_searches`, `brainstorm_sessions`, `essays`, `error_questions`, `notes`, `user_profile_document`, `wrong_questions`, `similar_questions`, `review_plans`. DB columns use `snake_case`.

**Blueprint pattern**: Each feature module is a Flask Blueprint in `backend/blueprints/`, registered in `app.py`. Most use `/api/v1/<module>` prefix; pomodoro uses `/api/pomodoro`. Each blueprint has a `_format_*()` helper to convert snake_case DB rows to camelCase JSON responses.

**AI Service** (`backend/services/ai_service.py`):
- `chat_completion(messages, temperature)` — standard completion, strips `<think>...</think>` reasoning tags
- `chat_completion_stream(messages, temperature)` — SSE streaming, buffers and strips thinking tags before output
- `chat_completion_json(messages, temperature)` — JSON response, strips markdown fences and thinking tags, raises `ValueError` if not JSON
- `translate_long_text(text, chunk_size=2000)` — splits by paragraphs, translates in chunks

**Learning Service** (`backend/services/learning_service.py`):
- Manages user learning profiles, weak point tracking, and personalized recommendations
- `get_learning_profile(user_id)` — retrieves user's learning stats and weak points
- `update_weak_point(user_id, topic, performance)` — tracks performance on specific topics
- Integrates with practice and textbook modules for adaptive learning

**User Profile Service** (`backend/services/user_profile_service.py`):
- Manages user profile document for AI personalization
- `get_user_profile_context(user_id)` — retrieves formatted user profile for AI context
- `should_include_profile(source_type)` — determines if a module should include profile context
- Profile document contains user's learning style, personality traits, interests, and AI observations
- All major interaction modules (QA, Feynman, Textbook, Practice, etc.) automatically include profile context
- Users can manually edit profile via Profile page; AI can also update it during interactions

**Wrong Questions Module** (`backend/blueprints/wrong_questions.py`):
- Complete error analysis system with diagnosis → practice → review loop
- `POST /upload` — upload wrong question image, AI recognizes and analyzes using vision model
- `GET /` — list all wrong questions with filtering by status/subject
- `GET /<id>` — get detailed question info including similar questions
- `POST /<id>/generate-similar` — AI generates 3-5 similar practice questions
- `POST /<id>/similar/<similar_id>/submit` — submit answer to similar question, AI judges correctness
- `GET /review/plan` — get questions due for review based on spaced repetition
- `POST /review/summary` — generate AI-powered review summary with weaknesses and suggestions
- Automatically updates weak points and mastery levels
- Supports long-term review planning with next_review_at scheduling

**Textbook Service** (`backend/services/textbook_service.py`):
- Handles document processing and context-aware Q&A for uploaded course materials
- Extracts text from PDF/DOCX/TXT files
- Maintains conversation context for multi-turn document discussions

**Personalization Service** (`backend/services/personalization.py`):
- Provides personalized learning recommendations based on user history and weak points
- Adapts difficulty and content selection for practice sessions

**Config** (`backend/config.py`): `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `TEXT_MODEL`, `VISION_MODEL`, `CORS_ORIGINS`, `DATABASE_PATH`, `UPLOAD_FOLDER`, `JWT_SECRET`, `JWT_EXPIRES_HOURS`, `MAX_CONTENT_LENGTH` (50MB default, 10MB for image uploads). 

**Current AI Configuration**:
- API Provider: Aliyun DashScope (OpenAI-compatible)
- Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- API Key: configured via `AI_API_KEY`, `DASHSCOPE_API_KEY`, or `DEEPSEEK_API_KEY`
- Text Model: `qwen-plus`
- Vision Model: `qwen-vl-max`

Sensitive values should use environment variables in production.

**Auth** (`backend/auth.py`): 
- `hash_password()`, `verify_password()` — Werkzeug password hashing
- `create_access_token(user)` — JWT with `sub`, `email`, `username`, expires in `JWT_EXPIRES_HOURS`
- `@login_required` decorator — validates Bearer token, sets `g.current_user`, returns 401 if invalid

**Real-time** (`backend/extensions.py`): Flask-SocketIO for WebSocket connections. APScheduler for background jobs (reminder system in `backend/scheduler/reminder.py`). Both initialized in `app.py`.

## Frontend Architecture

**Stack**: React 18, TypeScript, Vite 5, Tailwind CSS 3, Zustand, React Query v5, React Router v6, Axios, Framer Motion

**State** (`frontend/src/store/index.ts`): 4 Zustand stores:
- `useUserStore` — auth user, persisted to `localStorage('user-storage')`
- `useUIStore` — sidebar, theme, loading, persisted
- `useNotificationStore` — toast notifications, auto-dismiss after 5s (duration=0 to disable)
- `useLearningProgressStore` — study metrics, persisted

**API layer** (`frontend/src/utils/api-client.ts`):
- Singleton `apiClient` wrapping Axios
- Bearer token from `localStorage('auth_token')` via request interceptor
- Response interceptor auto-dispatches errors to `useNotificationStore` and removes token on 401
- All endpoints in `API_ENDPOINTS` constant (camelCase keys, `/api/v1/` prefix except pomodoro)
- 30s timeout; error notification messages mapped by HTTP status code

**Routing** (`frontend/src/App.tsx`): Flat Routes inside `Layout`, no nested routes. Current pages: Home, Textbook, Practice, Writing, Calendar, LearningPath, Feynman, QA, Profile, DocumentEvolution, KnowledgeGraph, WrongQuestions. Auth routes: Login, Register.

**WebSocket** (`frontend/src/hooks/useSocket.ts`): Socket.IO client hook for real-time features. Connects to backend SocketIO server, handles reconnection and event listeners.

**Tailwind** (`frontend/tailwind.config.js`): `primary` blue palette, custom animations (`fade-in`, `slide-up`, `slide-down`, `pulse-slow`), `xs` breakpoint at 475px.

## Conventions

- UI text in Chinese (Simplified)
- Feature pages in `frontend/src/pages/`, components in `frontend/src/components/`
- User ID fallback: `useUserStore((s) => s.user)?.id || 'demo-user'`
- Tab-based pages use `useState` for active tab + conditional rendering
- React Query: 5-min stale time, single retry, `refetchOnWindowFocus: false`
- Vite dev server proxies `/api` and `/socket.io` to Flask (configured in `vite.config.ts`)
- Adding a new feature: blueprint → schema.sql table → register in `app.py` → page → route → nav item
- File uploads: max 50MB for documents (PDF/DOCX/TXT), 10MB for images. Saved to `backend/uploads/`
- Vector store: ChromaDB in `backend/vector_store/` for document embeddings and semantic search
- All blueprints registered via `BLUEPRINTS` list in `backend/blueprints/__init__.py`
- Error responses follow format: `{'message': 'user-facing message', 'code': 'ERROR_CODE'}` with appropriate HTTP status

## Production Build

**Frontend** (`frontend/Dockerfile`): Multi-stage — `node:18-alpine` builds, `nginx:alpine` serves. `nginx.conf` handles SPA routing (`try_files $uri $uri/ /index.html`) and proxies `/api` to `http://backend:3000`.

**Docker networking**: Frontend container names its backend `http://backend:3000` in nginx.conf. No docker-compose at root — containers must be on same network.

## Key Files

- `backend/app.py` — Flask entry, blueprint registration, `init_db()` on startup, SocketIO + scheduler initialization
- `backend/auth.py` — JWT creation/validation, password hashing, `@login_required` decorator
- `backend/extensions.py` — SocketIO and APScheduler instances
- `backend/schema.sql` — all table definitions
- `backend/services/ai_service.py` — all LLM calls, streaming, JSON parsing
- `backend/services/vector_service.py` — ChromaDB operations for document embeddings
- `backend/services/learning_service.py` — learning profile and weak point tracking
- `backend/services/textbook_service.py` — document processing and context-aware Q&A
- `backend/services/personalization.py` — personalized recommendations based on user history
- `backend/scheduler/reminder.py` — APScheduler jobs for review reminders
- `backend/config.py` — API credentials and paths
- `frontend/src/App.tsx` — route definitions
- `frontend/src/utils/api-client.ts` — Axios singleton with interceptors
- `frontend/src/utils/sse.ts` — Server-Sent Events parser for streaming responses
- `frontend/src/store/index.ts` — all Zustand stores
- `frontend/src/hooks/useSocket.ts` — Socket.IO client hook
- `frontend/vite.config.ts` — Vite config with `/api` and `/socket.io` proxy to `localhost:5001`
