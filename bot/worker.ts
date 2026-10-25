import { z } from 'zod';
import { createHash } from 'node:crypto';
import { signals } from '../src/engine.ts';
import { ApiError, marketDate } from './alpaca.ts';
import type { Alpaca, Position, OrderRequest, Account } from './alpaca.ts';
import { RULES, SYMBOLS } from './config.ts';
import type { Config } from './config.ts';
import type { State } from './state.ts';
export type Broker=Pick<Alpaca,'account'|'clock'|'calendar'|'positions'|'asset'|'orders'|'fills'|'byClientId'|'submit'|'cancel'|'bars'|'quote'>;
export function safeError(e:unknown){return e instanceof z.ZodError?'Broker response validation failed; no response values logged.':e instanceof Error?e.message:'Unexpected worker failure.';}
function audit(state:State,now:Date,symbol:string,action:string,reason:string){state.events.push({date:now.toISOString(),symbol,action,reason});state.events=state.events.slice(-2000);}
function validateAccount(account:Account,positions:Position[]){
  if(account.status!=='ACTIVE'||account.currency!=='USD'||account.trading_blocked||account.account_blocked)throw new Error('Paper account is inactive, blocked or not USD.');
  if(account.cash<0||positions.some(p=>p.qty<0||p.side!=='long'||p.market_value<0))throw new Error('Negative cash or short exposure detected. No margin-funded trading is allowed.');
  if(positions.some(p=>!(SYMBOLS as readonly string[]).includes(p.symbol)))throw new Error('Unsupported holdings: use a dedicated paper account with only SPY, AGG and AAPL.');
}
export function quotePrice(quote:{t:string;bp:number;ap:number},now:Date,side:'buy'|'sell'){
  const age=now.getTime()-Date.parse(quote.t),spread=(quote.ap-quote.bp)/((quote.ap+quote.bp)/2)*10000;
  if(!Number.isFinite(age)||age< -5000||age>RULES.quoteAgeMs||!Number.isFinite(spread)||quote.bp<=0||quote.ap<=0||spread<0||spread>RULES.spreadBps)throw new Error('Quote is stale, crossed, unavailable or too wide; no order submitted.');
  const price=side==='buy'?quote.ap*(1+RULES.slippageBps/10000):quote.bp*(1-RULES.slippageBps/10000);
  // Sub-dollar tick size differs; all supported assets normally exceed $1.
  const scale=price>=1?100:10000;
  return (side==='buy'?Math.ceil(price*scale):Math.floor(price*scale))/scale;
}
export function planOrder(symbol:string,signal:'BUY'|'SELL'|'WAIT',account:Account,positions:Position[],quote:{t:string;bp:number;ap:number},now:Date,session:string,riskExit:boolean):OrderRequest|null{
  validateAccount(account,positions);
  if(!(SYMBOLS as readonly string[]).includes(symbol))throw new Error('Symbol not on the unleveraged stock/ETF allowlist.');
  const position=positions.find(p=>p.symbol===symbol),capital=Math.min(RULES.capital,account.equity),maxPosition=capital*RULES.positionFraction;
  const stop=position && position.current_price<=position.avg_entry_price*(1-RULES.stopLoss);
  const trim=position && position.market_value>maxPosition*1.1;
  const side=(position&&(signal==='SELL'||riskExit||stop||trim))?'sell':signal==='BUY'&&!position&&!riskExit?'buy':null;
  if(!side)return null;
  const price=quotePrice(quote,now,side);
  const gross=positions.reduce((sum,p)=>sum+p.market_value,0);
  const budget=Math.min(maxPosition,capital*RULES.grossFraction-gross,account.cash-capital*RULES.cashReserve);
  const qty=side==='buy'?Math.floor(budget/(price*(1+RULES.feeBps/10000))):trim&&!riskExit&&!stop&&signal!=='SELL'?Math.min(position!.qty,Math.ceil((position!.market_value-maxPosition)/quote.bp*1e6)/1e6):position!.qty;
  const safeQty=Math.floor(qty*1e6)/1e6;
  if(!Number.isFinite(safeQty)||safeQty<=0||safeQty*price<1)return null;
  return {symbol,side,qty:safeQty.toFixed(6),type:'limit',time_in_force:'day',limit_price:price.toFixed(price>=1?2:4),client_order_id:`obs-v1-${session}-${symbol}-${side}`,extended_hours:false};
}
export async function runCycle(broker:Broker,state:State,cfg:Config,now=new Date(),persist:()=>Promise<void>=async()=>{}):Promise<State>{
  state.updatedAt=now.toISOString();
  if(!cfg.key||!cfg.secret){state.status='blocked';state.message='Missing Alpaca paper API credentials. No automated broker trading has started.';return state;}
  try{
    const clock=await broker.clock();
    if(Math.abs(Date.parse(clock.timestamp)-now.getTime())>120000)throw new Error('Broker clock is stale or machine time is out of sync.');
    const session=marketDate(new Date(clock.timestamp));
    const [account,positions,openOrders]=await Promise.all([broker.account(),broker.positions(),broker.orders(true)]);
    validateAccount(account,positions);
    const fingerprint=createHash('sha256').update(account.id).digest('hex');
    if(state.accountFingerprint&&state.accountFingerprint!==fingerprint)throw new Error('Paper account changed; refusing to reuse another account’s risk and performance history.');
    state.accountFingerprint=fingerprint;
    if(openOrders.some(o=>!o.client_order_id.startsWith('obs-v1-')))throw new Error('Unmanaged open orders detected. Use a dedicated paper account.');
    if(!state.startedAt){if(positions.length||openOrders.length)throw new Error('First start requires an empty dedicated paper account. Existing exposure cannot be adopted without risk history.');state.startedAt=new Date(Date.parse(clock.timestamp)-120000).toISOString();state.baseline=account.equity;}
    const prior=await broker.orders(false,state.startedAt);
    if(prior.some(o=>!o.client_order_id.startsWith('obs-v1-')))throw new Error('Manual orders detected since monitoring started; automation paused.');
    const ids=new Set(prior.map(o=>o.id));const fills=await broker.fills(state.startedAt);
    if(fills.some(f=>!ids.has(f.order_id)))throw new Error('Unreconciled fills detected; wait for complete broker order history.');
    state.fills=fills.map(f=>({id:f.id,orderId:f.order_id,symbol:f.symbol,side:f.side,qty:f.qty,price:f.price,date:f.transaction_time}));
    state.equity=account.equity;state.cash=account.cash;state.peak=Math.max(state.peak,account.equity);state.maxDrawdown=Math.min(state.maxDrawdown,account.equity/state.peak-1);
    state.positions=positions.map(p=>({symbol:p.symbol,units:p.qty,value:p.market_value,unrealizedPnl:p.market_value-p.qty*p.avg_entry_price}));
    state.snapshots.push({date:now.toISOString(),equity:account.equity,cash:account.cash});
    // Retain daily final observations plus today's intraday samples without resetting the risk peak.
    const day=marketDate(now);const daily=new Map<string,State['snapshots'][number]>();const intraday:State['snapshots']=[];
    for(const point of state.snapshots){const d=marketDate(new Date(point.date));if(d===day)intraday.push(point);else daily.set(d,point);}
    state.snapshots=[...daily.values(),...intraday].slice(-10000);
    const dailyStop=account.equity/account.last_equity-1<=-RULES.dailyLoss;
    if(account.equity/state.peak-1<=-RULES.maxDrawdown)state.halted=true;
    for(const order of openOrders)if(cfg.kill||state.halted||dailyStop||now.getTime()-Date.parse(order.created_at)>RULES.orderTtlMs){await broker.cancel(order.id);audit(state,now,order.symbol,'CANCEL','Kill switch, loss limit or order TTL; cancellation will be reconciled before any new orders.');}
    await persist(); // Save monitoring baseline and risk state before attempting any write.
    if(cfg.kill){state.status='paused';state.message='Kill switch active. Bot orders cancelled; existing holdings are not automatically liquidated.';state.lastSuccess=now.toISOString();return state;}
    if(!clock.is_open){state.status='market_closed';state.message='Market closed. No orders submitted; broker clock controls holiday and session handling.';state.lastSuccess=now.toISOString();return state;}
    if(openOrders.length){state.status='ready';state.message='Waiting for outstanding paper orders or cancellation acknowledgements; no additional exposure submitted.';state.lastSuccess=now.toISOString();return state;}
    const dates=await broker.calendar(new Date(now.getTime()-30*86400000).toISOString().slice(0,10),session);
    const previous=dates.filter(d=>d.date<session).sort((a,b)=>a.date.localeCompare(b.date)).at(-1)?.date;
    if(!previous)throw new Error('Previous market session unavailable; refusing to use stale bars.');
    const riskExit=state.halted||dailyStop;
    for(const symbol of SYMBOLS){
      // Refresh balances before each symbol. Any pending order blocks all subsequent entries.
      const [current,held,pending]=await Promise.all([broker.account(),broker.positions(),broker.orders(true)]);validateAccount(current,held);
      if(pending.length){audit(state,now,symbol,'HOLD','Pending orders must reconcile before another order.');break;}
      const asset=await broker.asset(symbol);if(asset.symbol!==symbol||asset.status!=='active'||!asset.tradable||asset.class!=='us_equity')throw new Error('Instrument not active and tradable as US equity.');
      let action:'BUY'|'SELL'|'WAIT'='WAIT';
      if(!riskExit){const bars=(await broker.bars(symbol,now)).filter(b=>b.date<session);if(bars.length<50||bars.at(-1)!.date!==previous){audit(state,now,symbol,'HOLD','Missing latest completed session or indicator warmup.');continue;}action=signals(bars,'ma').at(-1)!;}
      const quote=await broker.quote(symbol);
      let plan=planOrder(symbol,action,current,held,quote,now,session,riskExit);
      if(plan?.side==='buy'&&Date.parse(clock.next_close)-now.getTime()<15*60000)plan=null;
      if(!plan){audit(state,now,symbol,'HOLD','No change, insufficient cash, position limit or late-session entry cutoff.');continue;}
      if(plan.side==='buy' && (state.attempts.includes(`obs-v1-${session}-${symbol}-sell`) || await broker.byClientId(`obs-v1-${session}-${symbol}-sell`))){audit(state,now,symbol,'HOLD','A sell already occurred or was attempted this session; no same-day re-entry.');continue;}
      const existing=await broker.byClientId(plan.client_order_id);
      if(existing){audit(state,now,symbol,'HOLD','Daily client order ID already exists; not resubmitting, including rejected/cancelled/partial orders.');continue;}
      if(state.attempts.includes(plan.client_order_id)){audit(state,now,symbol,'HOLD','A submission was previously attempted; no acknowledgement found, so no same-day resubmission.');continue;}
      state.attempts.push(plan.client_order_id);state.attempts=state.attempts.slice(-1000);
      await persist(); // Persist intent before POST; even a crash before POST fails closed for this session.
      try{await broker.submit(plan);}catch(e){if(e instanceof ApiError&&e.status===422){audit(state,now,symbol,'REJECTED','Broker rejected order; no same-cycle retry.');}throw e;}
      audit(state,now,symbol,plan.side.toUpperCase(),`Paper limit order acknowledged; not assumed filled. Signal uses completed session ${previous}.`);
    }
    state.status=riskExit?'paused':'ready';state.message=riskExit?'Loss limit active: entries disabled; protective exits attempted only with valid quotes. Max drawdown latch requires operator recovery.':'Paper worker cycle completed. Acknowledged orders remain pending until broker fills are reconciled.';state.lastSuccess=now.toISOString();
  }catch(e){state.status='error';state.message=safeError(e);audit(state,now,'SYSTEM','ERROR',state.message);}
  return state;
}
