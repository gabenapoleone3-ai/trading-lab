// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { autonomousBacktest } from './backtest';
import type { Market } from '../src/engine';
const market:Market=Object.fromEntries(['SPY','AGG','AAPL'].map(s=>[s,JSON.parse(readFileSync(`public/data/${s}.json`,'utf8'))]));
describe('risk-limited historical automation simulation',()=>{
 it('reconciles liquidation equity with net realized fill P&L and models costs',()=>{const run=autonomousBacktest(market);expect(run.strategy.final).toBeCloseTo(10000+run.performance.realizedPnl,7);expect(run.performance.modeledCosts).toBeGreaterThan(0);expect(run.performance.winRate).toBeGreaterThanOrEqual(0);expect(run.performance.winRate).toBeLessThanOrEqual(1);expect(run.fills.every(f=>f.qty>0&&f.price>0)).toBe(true);});
 it('does not change earlier equity when the test end is extended',()=>{const short=autonomousBacktest(market,'2014-01-02','2014-06-02'),long=autonomousBacktest(market,'2014-01-02','2015-06-02');expect(short.curve.slice(0,-1)).toEqual(long.curve.slice(0,short.curve.length-1));});
 it('has no strategy trades on flat prices; benchmark still pays entry and exit costs',()=>{const data=Object.fromEntries(Object.entries(market).map(([s,b])=>[s,b.map(bar=>({...bar,open:100,high:100,low:100,close:100,rawClose:100}))]));const run=autonomousBacktest(data,'2014-01-02','2014-06-02');expect(run.strategy.final).toBe(10000);expect(run.fills).toHaveLength(0);expect(run.benchmark.final).toBeLessThan(10000);expect(run.performance.winRate).toBeNull();});
});
