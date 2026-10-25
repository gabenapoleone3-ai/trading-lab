import { commonDates, metrics, signals } from '../src/engine.ts';
import type { Market, CurvePoint } from '../src/engine.ts';
import { RULES, SYMBOLS } from './config.ts';
import { planOrder, quotePrice } from './worker.ts';
import { tradePerformance } from './state.ts';
import type { State } from './state.ts';
import type { Account, Position } from './alpaca.ts';
// Deterministic historical simulation. Execution assumptions are explicit; this
// is not a claim that scheduled broker orders can obtain historical opens.
export function autonomousBacktest(market:Market,start='2010-01-04',end='2016-01-04'){
  const dates=commonDates(market).filter(d=>d>=start&&d<=end);if(dates.length<2)throw new Error('Insufficient shared historical sessions.');
  for(const s of SYMBOLS)if(!market[s])throw new Error('Missing required market series.');
  const lookups=Object.fromEntries(SYMBOLS.map(s=>[s,new Map(market[s].map((b,i)=>[b.date,{bar:b,index:i}]))]));
  const actions=Object.fromEntries(SYMBOLS.map(s=>[s,signals(market[s],'ma')]));
  let cash=10000,benchCash=10000,peak=10000,halted=false,previousEquity=10000;
  const holdings:Record<string,{qty:number;cost:number}>={},benchUnits:Record<string,number>={};
  const fills:State['fills']=[],curve:CurvePoint[]=[];
  for(const [n,date] of dates.entries()){
    const now=new Date(date+'T15:00:00Z');
    const openingEquity=cash+Object.entries(holdings).reduce((sum,[s,h])=>sum+h.qty*lookups[s].get(date)!.bar.open,0);
    // Drawdown from previously observed closes plus the current observable open.
    if(openingEquity/peak-1<=-RULES.maxDrawdown)halted=true;
    const riskExit=halted||openingEquity/previousEquity-1<=-RULES.dailyLoss;
    for(const symbol of SYMBOLS){
      const {bar,index}=lookups[symbol].get(date)!;const quote={bp:bar.open,ap:bar.open,t:now.toISOString()};
      if(n===0){const price=quotePrice(quote,now,'buy'),budget=10000*RULES.positionFraction;benchUnits[symbol]=Math.floor(budget/(price*(1+RULES.feeBps/10000)));benchCash-=benchUnits[symbol]*price*(1+RULES.feeBps/10000);}
      const positions:Position[]=Object.entries(holdings).filter(([,h])=>h.qty>0).map(([s,h])=>({symbol:s,qty:h.qty,market_value:h.qty*lookups[s].get(date)!.bar.open,avg_entry_price:h.cost/h.qty,current_price:lookups[s].get(date)!.bar.open,side:'long'}));
      const equity=cash+positions.reduce((sum,p)=>sum+p.market_value,0);
      const account:Account={id:'historical-test-account',cash,equity,last_equity:previousEquity,status:'ACTIVE',currency:'USD',trading_blocked:false,account_blocked:false};
      const action=index>0?actions[symbol][index-1]:'WAIT';
      const plan=planOrder(symbol,action,account,positions,quote,now,date,riskExit);
      if(plan){const qty=Number(plan.qty),price=Number(plan.limit_price),fee=qty*price*RULES.feeBps/10000,h=holdings[symbol]??{qty:0,cost:0};if(plan.side==='buy'){cash-=qty*price+fee;h.qty+=qty;h.cost+=qty*price;}else{cash+=qty*price-fee;h.cost=h.qty?Math.max(0,h.cost*(1-qty/h.qty)):0;h.qty=Math.max(0,h.qty-qty);}holdings[symbol]=h;fills.push({id:String(fills.length),orderId:plan.client_order_id,symbol,side:plan.side,qty,price,date:date+'T15:00:00Z'});}
    }
    if(n===dates.length-1){for(const symbol of SYMBOLS){const bar=lookups[symbol].get(date)!.bar,price=quotePrice({bp:bar.close,ap:bar.close,t:now.toISOString()},now,'sell');benchCash+=(benchUnits[symbol]??0)*price*(1-RULES.feeBps/10000);benchUnits[symbol]=0;const h=holdings[symbol];if(h?.qty){cash+=h.qty*price*(1-RULES.feeBps/10000);fills.push({id:String(fills.length),orderId:'scheduled-final-liquidation',symbol,side:'sell',qty:h.qty,price,date:date+'T21:00:00Z'});h.qty=0;h.cost=0;}}}
    const equity=cash+Object.entries(holdings).reduce((sum,[s,h])=>sum+h.qty*lookups[s].get(date)!.bar.close,0);
    const benchmark=benchCash+SYMBOLS.reduce((sum,s)=>sum+(benchUnits[s]??0)*lookups[s].get(date)!.bar.close,0);
    curve.push({date,strategy:equity,benchmark});peak=Math.max(peak,equity);previousEquity=equity;
  }
  return {schemaVersion:1,kind:'historical simulation',start:dates[0],end:dates.at(-1),source:'Bundled QuantStart adjusted archive; see data/manifest.json',rules:RULES,assumptions:'Signals through prior close; idealized fills at next adjusted open with 10 bp adverse slippage (rounded tick) and 10 bp fees per side. 10% per asset / 30% gross / $10,000 capital cap, 8% per-position stop, 3% daily loss and latched 10% drawdown entry halt. Protective orders are limit orders; historical fills are assumed, not guaranteed. Benchmark holds initial 10% whole-unit allocation per asset and remaining cash. Both liquidate at final close. Production scheduled polling does not guarantee opening prices; no cash interest/taxes/liquidity model.',strategy:metrics(curve.map(p=>p.strategy),dates),benchmark:metrics(curve.map(p=>p.benchmark),dates),performance:tradePerformance(fills),halted,fills,curve};
}
