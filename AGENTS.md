# Repository guidance

Keep all future development for Trading Lab in this repository. Use the existing checkout; cloud tasks are already isolated and do not need a new worktree unless requested.

Preserve the static React/TypeScript GitHub Pages architecture and paper-only boundary: never add brokerage order execution or real-money connections. Do not invent market observations or promise returns. Label source, coverage dates and adjustment methodology. Make unavailable data explicit.

Strategy signals at session close can execute only on a later session. Compare against a benchmark with equivalent cost treatment. Document any changes to price basis or accounting and test them against hand-calculated fixtures.

Use Node 24. Install with npm ci; run npm test, npm run test:e2e, and npm run build for relevant changes. In this cloud machine, Chromium can be selected with PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium and npm can use --cache /workspace/.npm-cache. Test both mobile and desktop. Update README when behavior or deployment changes.
