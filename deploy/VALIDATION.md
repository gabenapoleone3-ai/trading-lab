# Validation record — October 25, 2026

- Preserved existing historical research, indicators, backtesting and browser paper portfolio. The original engine remains unchanged.
- `npm test`: **55 passed**, covering indicator reference values, next-session fills, cost accounting, risk sizing, paper-only endpoints, stale quotes/clocks, missing bars, manual-order rejection, duplicate/unknown order acknowledgements, same-session re-entry prevention, daily/max drawdown controls, account identity isolation, persistence, Git state restoration, and the read-only worker HTTP interface.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`: **12 passed**, desktop and mobile, including the original working flows and automation blocked/error states.
- TypeScript / Vite production builds passed, including the Pages prefix. Runtime browser bundle checked to exclude broker authentication-header implementation and test keys.
- `npm audit`: **0 vulnerabilities** after upgrading the existing Vitest development dependency to a compatible patched release. No forced audit fix or TLS/checksum bypass was used.
- Multi-stage Docker image built with the complete test suite. Actual non-root container startup, historical research app, automation page, historical report and truthful missing-credential state were checked in Chromium without browser exceptions. The test container is temporary validation, not continuous hosting. Proxy-based builds used the platform CA through an ephemeral BuildKit secret; it is not part of the source or final image.
- Native worker HTTP smoke: missing credentials return health 503 and blocked status; public mutation requests are rejected; static path traversal cannot read outside the build root. State writes and per-process locking were exercised.
- Current-machine `npm run bot:once` returned **blocked: missing paper API credentials**, with no broker writes. Broker response/order behavior is tested with synthetic test fixtures only; this does not establish a real Alpaca connection or real broker paper fills.
- Repository is public. GitHub API confirms Pages is not enabled. Its prior website build passed, and deployment failed specifically at `actions/configure-pages@v5`. Attempting to enable Pages and list repository secrets returned **403 Resource not accessible by integration**. Those administration/secret permissions require the account owner; source pushes alone do not resolve them.

## Reproducible historical simulation

`npm run backtest:report` on the genuine bundled archive, 2010-01-04 through 2016-01-04:

| Metric | Risk-limited strategy | Initially allocated buy & hold |
| --- | ---: | ---: |
| Starting virtual capital | $10,000.00 | $10,000.00 |
| Final equity, after modeled costs | $10,833.27 | $13,833.17 |
| Total return | 8.33% | 38.33% |
| CAGR | 1.34% | 5.56% |
| Maximum closing-equity drawdown | -2.40% | -10.13% |

Strategy: 93 historical fills; 51 closed sell fills; 56.86% sell-fill win rate; $79.65 modeled commissions. There are no broker-paper performance results to substitute for these simulations. The strategy underperformed the allocated benchmark over this sample. The benchmark's exposures can grow beyond initial weights, while the strategy remains capped. Idealized historical fills, old adjusted data and selection bias limit comparisons; future profits are not guaranteed. Full assumptions, curves and fills are in `public/automation/backtest.json`.
