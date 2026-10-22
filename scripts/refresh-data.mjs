// Reproducible historical archive, deliberately pinned: this is not a live quote feed.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const commit = 'e6d86a3ac3dc507b26e27b1f20c2949a69438ef7';
const assets = [ ['SPY', 'SPDR S&P 500 ETF Trust', 'ETF'], ['AGG', 'iShares Core U.S. Aggregate Bond ETF', 'ETF'], ['AAPL', 'Apple Inc.', 'Stock'] ];
await mkdir('public/data', { recursive: true });
const manifest = { schemaVersion: 1, retrievedAt: new Date().toISOString(), archiveCommit: commit, assets: [] };
for (const [symbol, name, type] of assets) {
  const sourceUrl = `https://raw.githubusercontent.com/quantstart/qstrader/${commit}/data/${symbol}.csv`;
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);
  const csv = await response.text();
  const lines = csv.trim().split(/\r?\n/);
  if (lines.shift() !== 'Date,Open,High,Low,Close,Volume,Adj Close') throw new Error('Unexpected CSV schema');
  const bars = lines.map(line => {
    const [date, o, h, l, c, v, a] = line.split(',');
    const [open, high, low, rawClose, volume, close] = [o,h,l,c,v,a].map(Number);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ![open,high,low,rawClose,close].every(n => Number.isFinite(n) && n > 0) || !Number.isFinite(volume) || volume < 0 || high < low || high < Math.max(open,rawClose) - .001 || low > Math.min(open,rawClose) + .001) throw new Error(`Invalid bar ${symbol} ${date}`);
    const factor = close / rawClose;
    return { date, open: open * factor, high: high * factor, low: low * factor, close, rawClose, volume };
  }).sort((a,b) => a.date.localeCompare(b.date));
  if (bars.length < 250 || new Set(bars.map(b=>b.date)).size !== bars.length) throw new Error(`Invalid series ${symbol}`);
  await writeFile(`public/data/${symbol}.json`, JSON.stringify(bars));
  manifest.assets.push({ symbol, name, type, source: 'QuantStart QSTrader historical CSV archive', sourceUrl, sha256: createHash('sha256').update(csv).digest('hex'), firstDate: bars[0].date, lastDate: bars.at(-1).date, rows: bars.length, priceBasis: 'Provider adjusted close; OHLC scaled by adjusted close / raw close' });
  console.log(`${symbol}: ${bars.length} verified rows, ${bars[0].date} through ${bars.at(-1).date}`);
}
await writeFile('public/data/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
