export interface Bar { date: string; open: number; high: number; low: number; close: number; rawClose: number; volume: number }
export interface Asset { symbol: string; name: string; type: string; source: string; sourceUrl: string; sha256: string; firstDate: string; lastDate: string; rows: number; priceBasis: string }
export type Signal = 'BUY' | 'SELL' | 'WAIT';
export type Strategy = 'ma' | 'rsi';
export const INITIAL_CASH = 10_000;
export const PAPER_FEE_BPS = 10;
export function validateBars(input: unknown): Bar[] {
  if (!Array.isArray(input) || input.length < 2) throw new Error('Market data must contain at least two sessions.');
  let previous = '';
  for (const bar of input) {
    if (!bar || typeof bar.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || new Date(bar.date).toISOString().slice(0,10) !== bar.date || bar.date <= previous || !['open','high','low','close','rawClose'].every(key => typeof bar[key] === 'number' && Number.isFinite(bar[key]) && bar[key] > 0) || !Number.isFinite(bar.volume) || bar.volume < 0 || bar.high + 1e-6 < Math.max(bar.open,bar.close) || bar.low - 1e-6 > Math.min(bar.open,bar.close)) throw new Error('Invalid, duplicate, or unordered market data.');
    previous = bar.date;
  }
  return input as Bar[];
}
export function sma(values: number[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new Error('Invalid moving average period.');
  let sum = 0;
  return values.map((value,i) => { sum += value; if(i >= period) sum -= values[i-period]; return i >= period-1 ? sum/period : null; });
}
// Wilder smoothing; first RSI needs period changes (period + 1 closes).
export function rsi(values: number[], period = 14): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new Error('Invalid RSI period.');
  const result: (number | null)[] = Array(values.length).fill(null);
  let gain = 0, loss = 0;
  for(let i=1;i<values.length;i++) {
    const change = values[i]-values[i-1];
    if(i<=period) { gain += Math.max(change,0)/period; loss += Math.max(-change,0)/period; }
    else { gain = (gain*(period-1)+Math.max(change,0))/period; loss = (loss*(period-1)+Math.max(-change,0))/period; }
    if(i>=period) result[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100-100/(1+gain/loss);
  }
  return result;
}
export function signals(bars: Bar[], strategy: Strategy, fast=20, slow=50): Signal[] {
  const prices=bars.map(b=>b.close), a=sma(prices,fast), b=sma(prices,slow), strength=rsi(prices);
  if(fast>=slow) throw new Error('Fast moving average must be shorter than slow.');
  return bars.map((_,i) => strategy==='ma' ? (a[i]===null || b[i]===null ? 'WAIT' : a[i]!>b[i]! ? 'BUY' : a[i]!<b[i]! ? 'SELL' : 'WAIT') : (strength[i]===null ? 'WAIT' : strength[i]!<30 ? 'BUY' : strength[i]!>70 ? 'SELL' : 'WAIT'));
}
export interface BacktestOptions { strategy: Strategy; start: string; end: string; feeBps: number; slippageBps: number; fast: number; slow: number }
export interface Fill { date: string; signalDate: string; side: 'BUY'|'SELL'; price: number; units: number; fee: number; reason: string }
export interface CurvePoint { date: string; strategy: number; benchmark: number }
export interface Metrics { final: number; totalReturn: number; cagr: number; maxDrawdown: number }
export function metrics(values: number[], dates: string[]): Metrics {
  let peak=INITIAL_CASH, maxDrawdown=0;
  for(const v of values) { peak=Math.max(peak,v); maxDrawdown=Math.min(maxDrawdown,v/peak-1); }
  const final=values.at(-1) ?? INITIAL_CASH;
  const years=(Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / (365.25*86400000);
  return { final, totalReturn: final/INITIAL_CASH-1, cagr: years>0 ? (final/INITIAL_CASH)**(1/years)-1 : 0, maxDrawdown };
}
export function backtest(bars: Bar[], options: BacktestOptions) {
  const {strategy,start,end,feeBps,slippageBps,fast,slow}=options;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !bars.length || start<bars[0].date || end>bars.at(-1)!.date) throw new Error('Choose dates within the instrument’s available history.');
  if(![feeBps,slippageBps].every(v=>Number.isFinite(v)&&v>=0&&v<=500) || start>end || !['ma','rsi'].includes(strategy)) throw new Error('Invalid backtest settings. Costs must be 0–500 bps.');
  const indexes=bars.map((_,i)=>i).filter(i=>bars[i].date>=start&&bars[i].date<=end);
  if(indexes.length<2) throw new Error('Choose a date range containing at least two sessions.');
  const actions=signals(bars,strategy,fast,slow), fee=feeBps/10000, slip=slippageBps/10000;
  let cash=INITIAL_CASH, units=0, benchCash=INITIAL_CASH, benchUnits=0;
  const fills: Fill[]=[], curve: CurvePoint[]=[];
  for(const [n,i] of indexes.entries()) {
    const bar=bars[i], signal=i>0 ? actions[i-1] : 'WAIT';
    if(n===0) { const price=bar.open*(1+slip); benchUnits=benchCash/(price*(1+fee)); benchCash=0; }
    if(signal==='BUY'&&units===0) {
      const price=bar.open*(1+slip); units=cash/(price*(1+fee));
      fills.push({date:bar.date,signalDate:bars[i-1].date,side:'BUY',price,units,fee:units*price*fee,reason:'Previous session signal'}); cash=0;
    } else if(signal==='SELL'&&units>0) {
      const price=bar.open*(1-slip);
      cash=units*price*(1-fee); fills.push({date:bar.date,signalDate:bars[i-1].date,side:'SELL',price,units,fee:units*price*fee,reason:'Previous session signal'}); units=0;
    }
    if(n===indexes.length-1) {
      // Explicit liquidation at final close for both portfolios, including all costs.
      const price=bar.close*(1-slip);
      if(units>0) { cash=units*price*(1-fee); fills.push({date:bar.date,signalDate:bar.date,side:'SELL',price,units,fee:units*price*fee,reason:'End-of-test liquidation'}); units=0; }
      benchCash=benchUnits*price*(1-fee); benchUnits=0;
    }
    curve.push({date:bar.date,strategy:cash+units*bar.close,benchmark:benchCash+benchUnits*bar.close});
  }
  return {curve,fills,strategy:metrics(curve.map(v=>v.strategy),curve.map(v=>v.date)),benchmark:metrics(curve.map(v=>v.benchmark),curve.map(v=>v.date)),warmup: indexes[0] >= (strategy==='ma'?slow:15)};
}
export interface Order { id: string; date: string; symbol: string; side: 'BUY'|'SELL'; units: number }
export interface PaperState { version: 1; date: string; orders: Order[] }
export type Market = Record<string,Bar[]>;
export function commonDates(data: Market): string[] {
  const series=Object.values(data); if(!series.length) return [];
  const sets=series.slice(1).map(bars=>new Set(bars.map(b=>b.date)));
  return series[0].map(b=>b.date).filter(d=>sets.every(set=>set.has(d)));
}
export function initialPaper(data: Market): PaperState {
  const dates=commonDates(data); const date=dates.find(d=>d>='2010-01-04') ?? dates[0];
  if(!date) throw new Error('No shared trading sessions.');
  return { version:1, date, orders:[] };
}
export function paperAccount(state: PaperState, data: Market) {
  const dates=commonDates(data), start=initialPaper(data).date;
  if(!state || state.version!==1 || !Array.isArray(state.orders) || !dates.includes(state.date) || state.date<start) throw new Error('Invalid saved portfolio. Export or reset it to continue.');
  const prices=Object.fromEntries(Object.entries(data).map(([symbol,bars])=>[symbol,new Map(bars.map(b=>[b.date,b.close]))]));
  const positions: Record<string,number>={}; const trades: (Order & {price:number; fee:number})[]=[];
  let cash=INITIAL_CASH, previous=start;
  const ids=new Set<string>();
  for(const order of state.orders) {
    if(!order || typeof order.id!=='string' || ids.has(order.id) || !['BUY','SELL'].includes(order.side) || !Number.isFinite(order.units) || order.units<=0 || order.date<previous || order.date>state.date || !dates.includes(order.date)) throw new Error('Invalid saved trade.');
    const price=prices[order.symbol]?.get(order.date); if(!price) throw new Error('Unknown instrument or unavailable historical price.');
    const notional=order.units*price, fee=notional*PAPER_FEE_BPS/10000;
    const held=positions[order.symbol]??0;
    if(order.side==='BUY') { if(notional+fee>cash+1e-8) throw new Error('Insufficient virtual cash, including fees.'); cash-=notional+fee; positions[order.symbol]=held+order.units; }
    else { if(order.units>held+1e-10) throw new Error('Cannot sell more units than you hold.'); cash+=notional-fee; positions[order.symbol]=Math.max(0,held-order.units); }
    ids.add(order.id); previous=order.date; trades.push({...order,price,fee});
  }
  const equity=cash+Object.entries(positions).reduce((sum,[symbol,units])=>sum+units*prices[symbol].get(state.date)!,0);
  return {cash,positions,equity,trades};
}
export function placeOrder(state: PaperState, order: Order, data: Market): PaperState {
  if(order.date!==state.date) throw new Error('Orders must use the current replay session.');
  const next={...state,orders:[...state.orders,order]}; paperAccount(next,data); return next;
}
export function advancePaper(state: PaperState, data: Market, sessions: number): PaperState {
  if(!Number.isInteger(sessions)||sessions<1) throw new Error('Advance must be positive.');
  paperAccount(state,data); const dates=commonDates(data), index=dates.indexOf(state.date);
  return {...state,date:dates[Math.min(index+sessions,dates.length-1)]};
}
export function paperCurve(state: PaperState, data: Market) {
  const account=paperAccount(state,data), dates=commonDates(data).filter(d=>d>=initialPaper(data).date&&d<=state.date);
  const lookup=Object.fromEntries(Object.entries(data).map(([s,b])=>[s,new Map(b.map(v=>[v.date,v.close]))]));
  const positions: Record<string,number>={}; let cash=INITIAL_CASH, index=0;
  return dates.map(date=> {
    while(index<account.trades.length && account.trades[index].date===date) { const t=account.trades[index++]; const sign=t.side==='BUY'?1:-1; positions[t.symbol]=(positions[t.symbol]??0)+sign*t.units; cash-=sign*t.units*t.price+t.fee; }
    return {date,equity:cash+Object.entries(positions).reduce((sum,[s,u])=>sum+u*lookup[s].get(date)!,0)};
  });
}
