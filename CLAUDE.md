# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack insurance customer acquisition platform (保险智能获客). The frontend is a React + TypeScript + Vite SPA in Chinese. The backend is Node.js + Express + SQLite. Features include AI-assisted customer intake (DeepSeek), expert matching, order tracking, team management, and an admin dashboard.

## Development Commands

Root `package.json` scripts orchestrate both frontend and backend:

| Command | What it does |
|---------|-------------|
| `npm run dev` | Starts both frontend and backend concurrently |
| `npm run dev:frontend` | Vite dev server only (port 5175) |
| `npm run dev:backend` | Backend with `tsx watch` only (port 3001) |
| `npm run build` | Builds both frontend (`tsc -b && vite build`) and backend (`cd backend && tsc`) |
| `npm start` | Production server: runs compiled backend which serves `dist/` static files |
| `npm run db:seed` | Seeds experts and test users into SQLite |
| `npm run lint` | ESLint on entire project |
| `npm run preview` | Vite preview of production frontend build |

**First-time setup:**
```bash
npm install && cd backend && npm install && cd ..
npm run db:seed
npm run dev
```

- Frontend: `http://localhost:5175`
- Backend API: `http://localhost:3001/api`

No test framework is configured.

## Architecture

### Frontend

The entire UI lives in a single file: **[src/App.tsx](src/App.tsx)** (~4000 lines). All page components, types, and page-level logic are defined within this file. There is no component directory structure.

- **[src/main.tsx](src/main.tsx)** — Entry point. Renders `<App />` inside `React.StrictMode` with an error boundary.
- **[src/index.css](src/index.css)** — All global and component styles (~6800 lines). No CSS-in-JS or CSS modules; everything is plain CSS class selectors.
- **[src/LoginPage.tsx](src/LoginPage.tsx)** — Standalone login/register page (separate from App.tsx).
- **[src/api/](src/api/)** — Typed API clients. One file per domain (`auth.ts`, `orders.ts`, etc.). Uses axios with interceptors for JWT auth and 401 handling.

**Routing:** Manual client-side routing via `window.history.pushState`/`popstate` (no React Router). The `Route` type union defines all routes, mapped to paths in `routePaths`. The `App` component holds `route` state and renders the corresponding page in `<main>`.

**State Management:** All state is local React state (`useState`, `useRef`, `useEffect`) within `App.tsx`. No external state library.

### Backend

- **[backend/src/index.ts](backend/src/index.ts)** — Express entry. Registers all route modules, applies middleware (helmet, cors, rate limiting, JSON parsing), serves frontend static files in production, and handles the SPA fallback.
- **[backend/src/db.ts](backend/src/db.ts)** — SQLite database via `better-sqlite3` with WAL mode and foreign keys enabled. Schema is defined inline in `initDatabase()`. Migration pattern: `ensureColumn()` adds missing columns to existing tables (no traditional migration files).
- **[backend/src/auth.ts](backend/src/auth.ts)** — JWT token generation/verification, bcrypt password hashing, and login rate limiting (5 failed attempts within 15 minutes locks the account).
- **[backend/src/deepseek.ts](backend/src/deepseek.ts)** — DeepSeek API integration for AI customer info extraction and conversational intake.
- **[backend/src/routes/](backend/src/routes/)** — Express routers, one per domain (`auth.ts`, `orders.ts`, `ai.ts`, `admin.ts`, etc.). Most protected routes use `authMiddleware` which expects a `Bearer` token in the `Authorization` header and sets `req.userId`.
- **[backend/src/seed.ts](backend/src/seed.ts)** — Seeds expert profiles and test users (password: `password123`).

### Database Schema (Key Tables)

- `users` — Accounts with roles, platform roles, and invite codes
- `customers` — Client intake records (demographics, needs, budget)
- `experts` — Insurance advisor profiles with tags and specialties
- `orders` — Case/work orders linking customer + expert with status tracking
- `order_timeline` / `case_status_history` / `case_notes` — Order lifecycle tracking
- `messages` — Chat between users
- `notifications` — User notification inbox
- `team_members` — Leader/member relationship for team management
- `earnings` / `commissions` — Payout tracking
- `ai_conversations` / `conversation_messages` — AI chat sessions
- `client_locks` — Phone-based client exclusivity locks

### Authentication Flow

1. User logs in via `/api/auth/login` → receives JWT token
2. Token stored in `localStorage` as `token`
3. Axios interceptor attaches `Authorization: Bearer <token>` to every API request
4. Backend `authMiddleware` verifies token and sets `req.userId`
5. On 401 response, axios interceptor removes token and reloads the page

### Platform Role System

Separate from the UI-facing `role` (`'介绍人' | '合伙人'`), each user has a `platform_role`:

| Platform Role | Description |
|--------------|-------------|
| `a_side` | Client introducer (推荐人) — introduces customers |
| `b_side` | Insurance broker/advisor — claims and handles cases |
| `admin` | Platform administrator — accesses `/admin` dashboard |

`a_side` users have an `a_side_type` (`regular_a` | `small_a` | `big_a`) and an `override_rate`. `is_licensed` indicates whether the user holds an insurance license (relevant for B-side eligibility).

### Vite Proxy

`vite.config.ts` proxies `/api` requests to `http://localhost:3001` during development. The dev server runs on port 5175 (not the default 5173). `preview.allowedHosts` has two Cloudflare tunnel domains configured.

### AI Integration

The platform integrates DeepSeek API (`deepseek-chat` model) for:
- **Smart intake:** Users describe customers in natural language; AI extracts structured fields (name, age, needs, budget, etc.)
- **Conversational mode:** AI guides users to fill missing information, then generates a customer record and order on completion
- Backend stores AI conversations in `ai_conversations` + `conversation_messages` tables

## TypeScript Constraints

- `tsconfig.app.json` uses `verbatimModuleSyntax: true` — type imports must use `import type` syntax
- `noUnusedLocals` and `noUnusedParameters` are enabled; unused variables will fail the build
- Backend uses `tsx` for dev and `tsc` for production builds; it compiles to `backend/dist/`

## Adding a New Page

Follow the existing single-file pattern:

1. Add route ID to the `Route` type union in `App.tsx`
2. Add path mapping to `routePaths`
3. Create page component as a top-level function in `App.tsx`
4. Add conditional render block in `<main>`
5. Add CSS styles in `index.css` under a `.*-page` namespace
6. Add nav item to `navItems` array if it should appear in top navigation
7. If the page needs backend data, add API client methods in `src/api/` and route handlers in `backend/src/routes/`

## Role-Based Feature Gating

The `role` state (`'介绍人' | '合伙人'`) controls feature visibility:
- Navigation items are dynamically filtered: `'我的团队'` only appears when `role === '合伙人'`
- Home page shows "团队概览" card only for 合伙人
- The `RolePill` button at bottom-right toggles between roles
