# Repository Guidelines

## Project Structure & Module Organization
This repository is split into `frontend/` and `backend/`. The frontend is a Vite + React + TypeScript app; main code lives in `frontend/src/`, with route pages in `src/pages/`, reusable UI in `src/components/`, shared state in `src/store/`, API calls in `src/utils/api-client.ts`, and tests in `src/test/`. The backend is a Flask app rooted at `backend/app.py`, with feature endpoints under `backend/blueprints/`, AI integration in `backend/services/ai_service.py`, helpers in `backend/utils/`, and schema/bootstrap files in `backend/schema.sql` and `backend/database.py`.

## Build, Test, and Development Commands
Frontend:
- `cd frontend && npm install` installs dependencies.
- `cd frontend && npm run dev` starts the Vite dev server on `http://localhost:5173`.
- `cd frontend && npm run build` runs `tsc` and produces a production build.
- `cd frontend && npm run lint` runs ESLint.
- `cd frontend && npm run test` runs Vitest once.

Backend:
- `cd backend && pip install -r requirements.txt` installs Flask and document-processing dependencies.
- `cd backend && python app.py` starts the API on `http://localhost:5000`.
- `curl http://localhost:5000/api/health` verifies the backend is up.

## Coding Style & Naming Conventions
Frontend formatting is defined by `frontend/.eslintrc.cjs` and `.prettierrc`: 2-space indentation, no semicolons, single quotes, trailing commas where valid, and 100-character lines. Use PascalCase for React components and page files (`BookReader.tsx`), camelCase for functions and utilities, and keep shared exports explicit. Backend Python currently follows straightforward Flask module patterns: `snake_case` for functions/files and one blueprint per feature module.

## Testing Guidelines
Frontend tests use Vitest with Testing Library and `src/test/setup.ts`. Keep tests near the existing suite in `frontend/src/test/` and name them `*.test.ts` or `*.test.tsx`. Add tests for new routes, state logic, and API-driven UI states before merging. There is no backend test suite yet; for backend changes, at minimum run the health check and exercise the affected endpoint locally.

## Commit & Pull Request Guidelines
Recent history favors short conventional subjects such as `feat: ...` plus occasional versioned summaries. Prefer imperative, scoped commit messages, for example `feat: add notes export endpoint` or `fix: guard empty brainstorm input`. Pull requests should include a concise summary, impacted areas (`frontend`, `backend`, or both), linked issues if available, and screenshots/GIFs for UI changes.

## Security & Configuration Tips
Do not commit real API keys or generated database files. Move secrets out of `backend/config.py` into environment variables before production work, and keep uploads confined to `backend/uploads/`.
