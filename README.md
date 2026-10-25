# Trading Lab

A responsive React + TypeScript stock and ETF research dashboard for GitHub Pages, now with the Obsidian **paper-only** Alpaca automation worker. Website visitors need no local installation or API keys. Automated simulated broker orders run in a separate scheduled GitHub worker or resident container; GitHub Pages itself cannot run a trading process. There is no real-money trading mode.

## Autonomous paper trading

See [the deployment guide](deploy/README.md) for the supported paper integration, risk rules, free scheduled worker, resident container, secure credential setup, stop/recovery instructions, and limitations. The Automation tab shows real worker observations separately from historical simulations and stays explicitly blocked until a paper account is connected. Two repository secrets (`APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`) are the unavoidable account prerequisite; never send their values in chat. No paid service is provisioned.

## Publish the permanent website

The included Actions workflow tests and builds every push to `main`, then deploys to GitHub Pages. In this repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Ensure Actions is enabled, then push to `main` or run **Test and deploy GitHub Pages** from the Actions tab. The expected project URL is `https://gabenapoleone3-ai.github.io/trading-lab/` **after a successful deployment**. Deployment is not established merely by this file existing. Repository visibility/plan must support Pages; environment protection rules may require approval.

The workflow uses `/trading-lab/` as the asset base. For a renamed repository, update `VITE_BASE_PATH` in the workflow. No custom domain or paid data service is needed. Portfolio storage is specific to browser and website origin; switching domains does not migrate it.

## Features

- SPY equity ETF, AGG bond ETF, and AAPL stock, with genuine archived daily observations and linked provenance.
- Interactive adjusted-price, SMA 20/50 and Wilder RSI 14 charts; hover/touch tooltips and a draggable date navigator.
- Educational BUY / SELL / WAIT rules, explicitly distinguished from recommendations and forecasts.
- Date-filtered, long-only backtests versus buy-and-hold, $10,000 starting cash, fractional adjusted units, configurable commission and adverse slippage, daily equity, returns, calendar-time CAGR, closing-equity drawdown, complete fills and JSON exports.
- A separate $10,000 virtual paper portfolio with simulated buy/sell orders, no leverage or shorts, 10 bp commission, forward historical replay, positions, daily equity, trade history, local browser persistence, export and explicit reset.
- Automated daily SMA decisions, Alpaca paper-only limit orders, idempotent recovery, cash/exposure limits, risk controls, broker reconciliation, persistent audit state and observed paper performance.
- Responsive mobile and desktop interfaces, accessible form labels, visible loading/error/retry states, invalid-ledger recovery.

## Data: an old archive, not a live feed

The bundled data is pinned to QuantStart QSTrader revision `e6d86a3ac3dc507b26e27b1f20c2949a69438ef7`, under its included MIT notice. The original upstream market vendor and adjustment completeness are not independently certified. See [`public/data/manifest.json`](public/data/manifest.json) for exact source links, original CSV SHA-256 hashes, retrieval date and row counts.

| Instrument | Type | Available sessions |
| --- | --- | --- |
| SPY | ETF | 2000-01-03 – 2016-01-04 |
| AGG | ETF | 2006-11-01 – 2016-10-13 |
| AAPL | Stock | 2000-01-03 – 2016-01-04 |

The site makes **no claims of current quotes**. All data is bundled, so users need no API key, CORS proxy or vendor account. `npm run data:refresh` validates and reimports the same pinned archive; it does not make it current. To add a new licensed historical provider, update the importer and manifest with explicit provenance, verified schema, price basis and adjustment policy, then rerun the tests. Never fill gaps with invented observations.

Adjusted close is used directly. OHLC is scaled by `adjusted close / raw close`. Raw close and volume are retained. Charts, backtests and paper holdings use fractional **adjusted research units**, not executable brokerage shares. Dividend and split effects are only those embedded in the provider's adjustments; dividends are not added again.

## Timing and accounting

SMA signals use 20- and 50-session arithmetic means. BUY when fast > slow, SELL when fast < slow, WAIT for equality or insufficient history. RSI uses Wilder's seeded 14-session smoothed gains/losses; BUY below 30, SELL above 70, otherwise WAIT (retain holdings). RSI is 50 for a flat series, 100 with only gains and 0 with only losses.

Backtests use only data through session `t-1` for a fill at session `t` open. Earlier data outside the requested window is allowed for indicator warmup. If there is insufficient history, remain in cash until warmed up. Buy-and-hold invests at the first selected open. Commission applies to execution notional on entry and exit. Slippage increases buy prices and reduces sell prices. Both portfolios liquidate at the selected final close and pay exit costs, even if the strategy had entered that morning. Intermediate equity marks open holdings at adjusted closes. There is no leverage, shorting, cash interest, separate dividend cash, taxes or liquidity modeling.

Back-adjusted data may include later corporate-action information in historical price levels; this is not a point-in-time institutional feed. Scale-invariant rules and period returns do not use future signals, but provider adjustment revisions remain a data limitation. Archive selection and survivorship bias, overfitting, execution approximations, and intraday drawdowns are additional limitations. CAGR is based on elapsed calendar days and can be extreme over short windows. Nothing guarantees profits.

Paper replay starts at the 2010-01-04 close and advances only through sessions common to all three assets, ending 2016-01-04. Orders fill immediately at the displayed historical adjusted close with 10 bp commission. This manual historical exercise allows hindsight and is **not** an unbiased trading-performance experiment. Valuation and the paper equity curve use no dates beyond the replay date. Invalid ledgers are not silently overwritten. Exports are backups for inspection; importing untrusted portfolios is not supported. Browser storage is not an account or cross-device sync.

## Development (optional; website visitors do not need this)

Keep future development in this repository. Node.js 24 and npm are used in CI.

```sh
npm ci
npm test
npm run backtest:report
npx playwright install --with-deps chromium
npm run test:e2e
npm run build
npm run dev
```

In the prepared cloud machine, Chromium is already at `/usr/bin/chromium`; use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`. If the npm home cache is unwritable, use `npm ci --cache /workspace/.npm-cache`. If a proxy is required for refreshing data under Node 24, use `NODE_USE_ENV_PROXY=1 npm run data:refresh`; TLS verification stays enabled.

To check the production Pages prefix locally:

```sh
VITE_BASE_PATH=/trading-lab/ npm run build
VITE_BASE_PATH=/trading-lab/ npm run preview -- --port 4174
# Request /trading-lab/ and /trading-lab/data/manifest.json on that server.
```

Tests cover indicator reference values and edge cases, next-session fills, future-data independence, warmup, both sides of fees/slippage, benchmark parity, drawdown, invalid inputs, overspending/overselling, replay chronology, current-date-only valuation, source archive integrity, mobile/desktop browser flows, persistence, corrupted storage, and network failure/retry. Synthetic fixtures exist only in tests and are not shipped as market data.

The new worker uses the existing indicator and risk-planning code; it does not replace the functioning historical research or browser portfolio. Run `npm run bot:once` for a single cycle or `npm run bot:start` for the resident worker. Missing credentials produce a truthful blocked status and no broker writes. Runtime state is ignored by Git; only the deployment workflow publishes sanitized paper observations to its state branch.
