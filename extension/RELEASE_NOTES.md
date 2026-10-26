Installable Chrome Manifest V3 release. Download **obsidian-extension-v1.0.0.zip**, extract it, then in desktop Chrome open **chrome://extensions → Developer mode → Load unpacked** and select the extracted folder containing manifest.json. Pin Obsidian, open TradingView Supercharts, and click the extension icon.

In **Connection & settings**, enter your own Alpaca **paper** API key ID and secret with IEX market-data access. Never provide a brokerage password or live key. Session storage is the default; optional Remember stores credentials in your Chrome profile. No paid service or API key is included.

Features: automatic single-chart ticker/interval detection, on-page signal badge, synchronized companion candles with exact provider-time/price markers, trend/momentum/volume/ATR/support-resistance/higher-timeframe rules, educational reference levels, historical backtesting, separate quote-observed forward paper simulation, fees/slippage, benchmark, drawdown/win statistics, histories and exports. Stale/unsupported/insufficient data produces WAIT. Evidence counts are not profit probabilities. There is no order-execution endpoint.

The independent companion chart is intentional: TradingView exposes no supported extension API for accurate canvas coordinates. The badge is not a marker on TradingView's candles. IEX is one exchange; its sessions/adjusted history can differ from TradingView.

Validation: 77 unit/integration tests; packaged Chrome extension tests including a real public Supercharts badge/context smoke passed in GitHub run 40247452628. Synthetic provider fixtures are confined to tests. Authenticated live Alpaca access was not exercised because no paper data credentials were supplied. No profits or broker fills are claimed.

Source and complete installation/methodology: extension/README.md. SHA-256 checksum is attached. This extension is independent of GitHub Pages and the repository's separate broker-paper worker.
