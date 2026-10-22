import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { advancePaper, backtest, commonDates, initialPaper, metrics, paperAccount, paperCurve, placeOrder, rsi, signals, sma, validateBars } from './engine';
import type { Bar, BacktestOptions, Market, PaperState } from './engine';
// Synthetic prices appear only in tests, never in the shipped market archive.
const bars=(prices:number[],opens=prices):Bar[]=>prices.map((close,i)=>({date:`2020-01-${String(i+1).padStart(2,'0')}`,open:opens[i],high:Math.max(close,opens[i]),low:Math.min(close,opens[i]),close,rawClose:close,volume:100}));
const opts=(data:Bar[],extra:Partial<BacktestOptions>={}):BacktestOptions=>({strategy:'ma',start:data[0].date,end:data.at(-1)!.date,feeBps:0,slippageBps:0,fast:2,slow:3,...extra});
describe('indicators',()=>{
 it('calculates SMA and warmup without future values',()=>{expect(sma([1,2,3,4,5],3)).toEqual([null,null,2,3,4]);expect(sma([1,2,3,100],3).slice(0,3)).toEqual([null,null,2]);});
 it('matches a published Wilder RSI seed and following smoothed value',()=>{const prices=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00];const result=rsi(prices);expect(result.slice(0,14)).toEqual(Array(14).fill(null));expect(result[14]).toBeCloseTo(70.4641,3);expect(result[15]).toBeCloseTo(66.2496,3);});
 it('handles flat, all-positive and all-negative RSI',()=>{expect(rsi(Array(16).fill(10))[14]).toBe(50);expect(rsi(Array.from({length:16},(_,i)=>i+1))[14]).toBe(100);expect(rsi(Array.from({length:16},(_,i)=>20-i))[14]).toBe(0);});
 it('uses warmup and explicit trend regimes',()=>{expect(signals(bars([1,2,3,2,1]),'ma',2,3)).toEqual(['WAIT','WAIT','BUY','BUY','SELL']);});
 it('rejects invalid periods',()=>{expect(()=>sma([1],0)).toThrow();expect(()=>rsi([1],-1)).toThrow();expect(()=>signals(bars([1,2]),'ma',3,2)).toThrow();});
});
describe('backtest execution and accounting',()=>{
 it('cannot act at the signal close; fills at the next open',()=>{const data=bars([10,11,12,20,21],[10,11,12,30,21]);const run=backtest(data,opts(data));expect(run.fills[0]).toMatchObject({signalDate:'2020-01-03',date:'2020-01-04',price:30,side:'BUY'});expect(run.fills[0].units).toBeCloseTo(10000/30);expect(run.strategy.final).toBeCloseTo(7000);});
 it('does not let an appended future session change prior signals or executions',()=>{const data=bars([10,11,12,13,14,15]);const extended=[...data,...bars([999]).map(b=>({...b,date:'2020-01-07'}))];const a=backtest(data,opts(data)),b=backtest(extended,opts(extended));expect(a.curve.slice(0,-1)).toEqual(b.curve.slice(0,5));expect(a.fills.filter(f=>f.reason!=='End-of-test liquidation')).toEqual(b.fills.filter(f=>f.reason!=='End-of-test liquidation'));expect(signals(extended,'ma',2,3).slice(0,6)).toEqual(signals(data,'ma',2,3));});
 it('charges entry and exit commission and adverse slippage equally to benchmark',()=>{const data=bars([10,11,12,20,20]);const run=backtest(data,opts(data,{start:'2020-01-04',feeBps:10,slippageBps:20}));const expected=10000/(20*1.002*1.001)*(20*.998*.999);expect(run.strategy.final).toBeCloseTo(expected,8);expect(run.benchmark.final).toBeCloseTo(expected,8);expect(run.fills).toHaveLength(2);expect(run.fills.every(f=>f.fee>0)).toBe(true);});
 it('stays cash on WAIT and lets benchmark invest',()=>{const data=bars([10,20,30]);const run=backtest(data,opts(data,{fast:20,slow:50}));expect(run.strategy.final).toBe(10000);expect(run.fills).toHaveLength(0);expect(run.benchmark.final).toBe(30000);expect(run.warmup).toBe(false);});
 it('uses historical warmup before the selected start',()=>{const data=bars([10,11,12,13,14]);expect(backtest(data,opts(data,{start:'2020-01-04'})).fills[0].date).toBe('2020-01-04');});
 it('validates date ranges and costs rather than fabricating results',()=>{const data=bars([10,11,12]);for(const extra of [{start:'2020-02-01'},{feeBps:-1},{slippageBps:NaN},{end:'2030-01-01'},{start:''}])expect(()=>backtest(data,opts(data,extra))).toThrow();});
 it('includes initial equity in maximum drawdown',()=>{expect(metrics([9000,11000,8800],['2020-01-01','2020-06-01','2021-01-01']).maxDrawdown).toBeCloseTo(-.2);expect(metrics([9000,8000],['2020-01-01','2021-01-01']).totalReturn).toBeCloseTo(-.2);});
});
describe('paper ledger',()=>{
 const market:Market={SPY:bars([100,110,90,120]),AGG:bars([50,51,52,53])};
 const initial:PaperState={version:1,date:'2020-01-01',orders:[]};
 const order={id:'1',symbol:'SPY',date:'2020-01-01',side:'BUY' as const,units:10};
 it('starts with $10,000 and accounts for fees and market movement',()=>{const bought=placeOrder(initial,order,market);expect(paperAccount(bought,market).cash).toBe(8999);const advanced=advancePaper(bought,market,1);expect(paperAccount(advanced,market).equity).toBe(10099);const sold=placeOrder(advanced,{...order,id:'2',date:advanced.date,side:'SELL'},market);expect(paperAccount(sold,market).cash).toBeCloseTo(10097.9);expect(paperAccount(sold,market).positions.SPY).toBe(0);expect(paperCurve(sold,market).at(-1)!.equity).toBeCloseTo(10097.9);});
 it('prevents overspending, overselling, future fills, shorts and nonfinite quantities',()=>{for(const change of [{units:101},{units:-1},{units:NaN},{side:'SELL' as const},{date:'2020-01-02'},{symbol:'FAKE'}])expect(()=>placeOrder(initial,{...order,...change},market)).toThrow();});
 it('advances forward only and clamps to the last shared date',()=>{expect(advancePaper(initial,market,999).date).toBe('2020-01-04');expect(()=>advancePaper(initial,market,-1)).toThrow();});
 it('does not use future observations to mark a position',()=>{const bought=placeOrder(initial,order,market);const poisoned={...market,SPY:bars([100,99999,99999,99999])};expect(paperAccount(bought,market).equity).toBe(paperAccount(bought,poisoned).equity);expect(paperCurve(bought,poisoned)).toHaveLength(1);});
 it('rejects corrupted saved state and duplicate order IDs',()=>{expect(()=>paperAccount({...initial,version:2} as unknown as PaperState,market)).toThrow();const bought=placeOrder(initial,order,market);expect(()=>placeOrder(bought,order,market)).toThrow();expect(()=>paperAccount({...bought,date:'2019-01-01'},market)).toThrow();});
 it('finds only shared sessions',()=>{expect(commonDates({...market,AGG:market.AGG.slice(1)})).toEqual(['2020-01-02','2020-01-03','2020-01-04']);expect(initialPaper(market)).toEqual(initial);});
});
describe('shipped archive',()=>{
 const manifest=JSON.parse(readFileSync('public/data/manifest.json','utf8'));
 for(const asset of manifest.assets)it(`${asset.symbol} has validated real archive rows matching provenance`,()=>{const data=validateBars(JSON.parse(readFileSync(`public/data/${asset.symbol}.json`,'utf8')));expect(data).toHaveLength(asset.rows);expect(data[0].date).toBe(asset.firstDate);expect(data.at(-1)!.date).toBe(asset.lastDate);expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);expect(asset.sourceUrl).toContain(manifest.archiveCommit);});
 it('rejects duplicated, unordered or negative bars',()=>{const data=bars([10,11]);expect(()=>validateBars([data[0],data[0]])).toThrow();expect(()=>validateBars([...data].reverse())).toThrow();expect(()=>validateBars([{...data[0],close:-1},data[1]])).toThrow();});
});
