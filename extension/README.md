# Obsidian TradingView Companion — Chrome Manifest V3

A local Chrome extension for US stock/ETF research. It detects visible Supercharts ticker/interval controls, retrieves authorized Alpaca/IEX data, computes transparent multi-factor setups and displays a small chart-page badge plus a synchronized companion candlestick chart in Chrome's side panel. No browser install of Node/Python or repository checkout is needed to use the release ZIP.

## Install (desktop Chrome 120+)

1. Download `obsidian-extension-v1.0.0.zip` from this repository's **Obsidian extension v1.0.0** GitHub release. Download the extension asset, not GitHub's automatic source-code archive. Extract it into a permanent folder. The selected folder must directly contain `manifest.json`, `background.js` and `panel.html`.
2. In **desktop Google Chrome**, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that extracted folder. Pin **Obsidian TradingView Companion** from Chrome's Extensions menu. This is not installed in ChatGPT's embedded browser or on mobile. No Chrome Web Store registration/fee is required for unpacked installation. An organization-managed browser may prohibit it; use an approved personal/development Chrome profile or obtain administrator permission. Do not bypass managed policy.
3. Open the extension's **Details → Extension options**, or its **Connection & settings** button. Enter an Alpaca **paper API key ID and secret** with IEX market-data entitlement. These are API credentials, never your brokerage login/password. The free IEX feed is used explicitly; the extension does not buy subscriptions or choose paid SIP data. Provider eligibility/access depends on your account and region.
4. Open `https://www.tradingview.com/chart/`, select a US stock or ETF and a single standard time-based chart, then click the pinned **Obsidian** toolbar icon. The small **Obsidian · WAIT/BUY/SELL** page badge can also open the side panel. Switch ticker/interval normally; context refreshes automatically. If the badge covers something, hide it in extension settings and keep using the toolbar icon.

Only these browser installation steps and your data credentials require your action. GitHub Pages, a server, the repository's paper broker worker, GitHub secrets, paid AI APIs and broker passwords are **not** required by this extension. It cannot place real or broker-paper orders; its own forward portfolio is a separate local simulation.

## How the TradingView integration works

The content script runs only on the `www.tradingview.com/chart/*` and `tradingview.com/chart/*` Supercharts paths. It reads visible **ticker and interval metadata**, not TradingView price feeds, private JS objects, canvas pixels, WebSocket messages, account sessions or restricted APIs. Both current toolbar IDs and older `data-name` controls are supported. DOM adapters can break if TradingView changes its UI; unsupported context becomes WAIT rather than guessing.

There is no supported extension API for mapping a TradingView canvas timestamp/price to pixel coordinates. Consequently **no false aligned markers are painted on TradingView's canvas**. The page badge is only a summary. BUY/SELL markers and entry/target/stop lines are aligned to exact provider bar timestamps and prices on the **independent companion chart**. Its x-axis is completed provider bars, with actual UTC timestamps; hover for OHLC/volume and use the visible-bars slider to zoom. It uses standard provider candles even when session/price adjustments differ from TradingView. Chrome's side panel leaves TradingView chart controls unobstructed.

Automatic mode supports one chart pane with intervals 1, 5, 15, 30, 60, 240 minutes, daily and weekly. It rejects unreadable context, multi-pane layouts, known synthetic/non-time styles, seconds/tick/range intervals and non-US exchange namespaces. If context cannot be verified, an explicitly labeled **manual companion context** can be selected in the panel; it does not claim to represent a selected TradingView pane. No SPX→SPY or crypto→stock substitutions are made. Bare tickers are labeled US ticker inference; provider coverage still must exist. Listed stock coverage is determined by Alpaca/IEX, not guaranteed for every symbol.

## Authorized market data and credentials

The only cross-origin data host in the extension manifest is `https://data.alpaca.markets/*`. The adapter permits only GET on stock bars and latest-quote endpoints, fixes `feed=iex` and uses `adjustment=split`. It rejects redirects and invalid/future/duplicate/nonfinite bars. It never contains a configurable broker/trading endpoint or a POST order API. Alpaca IEX is a **single exchange**, not consolidated TradingView/SIP market coverage. Volume, candles, sessions and prices can differ. Provider bars may include extended-session activity. Split-adjusted history is not dividend-inclusive total-return data.

Up to 600 latest native bars are fetched per base and higher timeframe. Only completed intervals are used: minute/hour bars after their duration, daily bars after the following New York midnight, weekly bars after the following week's boundary, monthly higher bars after the next month boundary. Calendar boundaries handle New York daylight saving changes. This conservative calendar completion can delay daily/weekly setups beyond the exchange close. No incomplete higher bar is used to confirm an earlier decision.

Fresh current quotes (≤120 seconds old, not more than five seconds in the future, uncrossed, ≤50 bp spread) and sufficiently recent completed bars are required for an actionable current setup. A closed market, illiquid IEX ticker, unavailable entitlement, empty history, stale quote, bad payload or HTTP failure produces **WAIT** with a reason; no demo data or archived prices are substituted. Data is sampled about once a minute while Chrome and a tracked TradingView tab are open. Refresh is not tick streaming; background alarms/timers may be delayed, and Chrome must remain running. Rate limits back off rather than selecting paid data. Source/as-of timestamps stay visible.

Keys live by default in `chrome.storage.session` and disappear after browser restart. The optional **Remember** checkbox stores them in extension-local Chrome profile storage, not an encrypted OS vault. Both storage areas are restricted to trusted extension contexts. Keys are handled only by the extension-owned settings page and service worker and sent in HTTPS authentication headers to Alpaca's data host. They are not returned to the page/side panel, copied from GitHub/cloud bindings, included in exports, written to source, or logged. Use paper keys; live-key prefixes are rejected. Remove credentials using settings. No externally connectable messaging or web-page message bridge is exposed.

## Transparent rule model (not a calibrated profit predictor)

Five directional checks must all agree:

1. Base SMA20 versus SMA50, with 10 bp separation.
2. Higher-timeframe SMA20 versus SMA50 with the same separation (1m→5m, 5m→15m, 15m→1h, 30m→4h, 1h/4h→daily, daily→weekly, weekly→monthly).
3. Wilder RSI14: BUY 50 ≤ RSI <70; SELL 30 < RSI ≤50.
4. Completed-bar volume ≥1.10 times the average of the **preceding** 20 bars.
5. Close breaks the preceding 20-bar resistance for BUY or support for SELL.

A simple mean of the last 14 true ranges provides ATR. Zero ATR or ATR >8% of price suspends setups; 60 completed bars are required on both timeframes. All quantities are computed, not random or fixed ticker recommendations. Incomplete inputs are distinguished from uncertain/contradictory setups. **Rule agreement N/5 is not a probability of profit, statistically calibrated confidence, or trained ML model output.** No LLM/paid AI service is called.

BUY reference entry is the completed close, protective stop = entry −2 ATR and target = entry +3 ATR. These are educational scenarios, not executable quotes. SELL means exit an existing long, never short. WAIT clears actionable levels. Historical strategy results are shown alongside this reasoning as separate sample context; they do not retroactively filter or optimize earlier signals. Repeated testing, old/sparse histories and survivor selection can overfit. Nothing guarantees profits.

## Historical versus forward performance

**Historical backtest:** recalculated from authorized provider history using the same rule and time-aligned higher-timeframe data. Decisions through the preceding completed bar can execute at the next bar's open. A $10,000 book invests up to 10% per entry without stacking, borrowing, shorts or leverage. Both sides model 10 bp commission plus 10 bp adverse slippage. Invalid gaps beyond a proposed stop/target skip entries. Stops use the worse gap-open price; when a bar touches both stop and target, stop is assumed first. Benchmark invests 10% once, keeps remaining cash idle and pays the same costs. Both liquidate at the final close. Actual historical executions, spread, liquidity, taxes, interest and dividends are not reconstructed. Daily timestamps identify provider bars, not a broker fill's wall-clock time. No genuine results exist until provider data is available; a zero-trade result is not evidence of strategy success.

**Forward-observed simulation:** a separate $10,000 virtual book for each symbol/interval, starting when that watch is first observed. It never imports earlier historical fills or reconstructs trades during offline/unobserved bars. New setups fill only using a fresh quote actually observed after analysis: buys at ask plus modeled slippage/fees, sells at bid minus those costs. Repeated polling of the same signal bar does not duplicate entries. Protective levels trigger only at subsequently observed quotes; intervening prices are not assumed to have filled stops/targets. The contemporaneous benchmark invests 10% on its first observed quote and is marked alongside the strategy. Open holdings are marked at bid without imaginary exit fees. Large price discontinuities pause the book for split/data review rather than fabricating corporate-action adjustments. Export and explicitly reset after reviewing such events.

Win rate counts closed simulated positions, including modeled costs; no closed trades means no win-rate estimate. Maximum drawdown includes starting equity and observed running peaks. Recent 1,000 signals/trades and 5,000 equity samples are retained; lifetime fee/win/drawdown aggregates persist. Up to eight independent watches are stored. Histories are Chrome-profile-local, not cloud-synced and can be lost when the extension/profile is removed. Export JSON before reset/removal. Historical and forward exports are distinct and exclude API credentials. Corrupt ledgers fail validation and are not silently reset. This simulation is unrelated to the repository's separate broker-paper worker and browser historical replay.

## Developer checks and packaging

```sh
npm ci
npm test
npm run extension:build
npx playwright install --with-deps chromium
npm run extension:test
```

The extension build does not replace the existing dashboard build. It produces `extension/build/` (load this folder unpacked), `releases/obsidian-extension-v1.0.0.zip`, and a SHA-256 checksum. The ZIP contains only the built extension and dependency notices, never `.env`, source tests, browser profiles or runtime state. Production extension CSP uses self-hosted scripts and the data API only. CI builds/tests and uploads the ZIP independently of Pages. Extension integration tests use an isolated Playwright Chrome for Testing profile and **explicit synthetic provider fixtures only in tests**, with no broker credentials or real requests. They must not be represented as authenticated live-data tests. The system-managed browser's policies must remain unchanged.
