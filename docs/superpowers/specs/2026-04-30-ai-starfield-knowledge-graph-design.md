# AI Starfield Knowledge Graph Design

## Goal

Upgrade the knowledge graph feature so a learner enters a topic, AI summarizes the major knowledge points and relationships, and the app renders them as a starfield where each star is a knowledge point and dashed lines show relationships.

## Scope

- The graph is generated from the user-entered topic only.
- Existing graph persistence, node mastery updates, and route structure stay in place.
- The backend must tolerate invalid AI output by returning a valid fallback graph.

## Backend Design

`POST /api/v1/knowledge-graph/generate` will call `chat_completion_json` with a strict JSON prompt. The expected payload includes a concise summary, 12-18 nodes, and 18-28 edges. Normalization will generate stable node IDs, clamp levels and hours, remove invalid edges, derive parent IDs, and cap the final graph size.

## Frontend Design

The existing Knowledge Graph page will become a starfield view. It will show topic input and graph stats on the left, and a dark starfield canvas on the right. SVG dashed lines connect nodes. Each node is an absolute-positioned button styled as a star with a label; clicking a star toggles mastery status and selects it for detail display.

## Testing

Backend tests will cover AI payload normalization and fallback behavior. Frontend verification will use the production build to catch TypeScript and bundling issues.
