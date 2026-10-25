import { sma,rsi } from '../../src/engine';
import { COSTS,FRAMES,periodEnd,unavailable } from './model';
import type { Decision,Frame,PriceBar,Quote } from './model';
const average=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;
export function analyze(bars:PriceBar[],higher:PriceBar[],frame:Frame,asOf:number):Decision{
 const base=bars.filter(b=>periodEnd(b.time,frame)<=asOf),hframe=FRAMES[frame].higher;
 const high=higher.filter(b=>periodEnd(b.time,hframe)<=asOf);
 const last=base.at(-1);const result:Decision={...unavailable('At least 60 completed base and higher-timeframe bars are required.'),phase:'insufficient',time:last?.time??null};
 if(base.length<60||high.length<60)return result;
 const closes=base.map(b=>b.close),fast=sma(closes,20).at(-1)!,slow=sma(closes,50).at(-1)!,momentum=rsi(closes).at(-1)!;
 const hc=high.map(b=>b.close),hf=sma(hc,20).at(-1)!,hs=sma(hc,50).at(-1)!;
 const atr=average(base.slice(-14).map((b,j)=>{const i=base.length-14+j;return Math.max(b.high-b.low,Math.abs(b.high-base[i-1].close),Math.abs(b.low-base[i-1].close));}));
 const earlier=base.slice(-21,-1),support=Math.min(...earlier.map(b=>b.low)),resistance=Math.max(...earlier.map(b=>b.high));
 const volumeMean=average(earlier.map(b=>b.volume)),volume=volumeMean>0?last!.volume/volumeMean:0;
 const validVolatility=atr>0&&atr/last!.close<=.08;
 const up=[fast>slow*1.001,hf>hs*1.001,momentum>=50&&momentum<70,volume>=1.1,last!.close>resistance];
 const down=[fast<slow*.999,hf<hs*.999,momentum>30&&momentum<=50,volume>=1.1,last!.close<support];
 const bullish=up.every(Boolean),bearish=down.every(Boolean),evidence=Math.max(up.filter(Boolean).length,down.filter(Boolean).length);
 const signal=validVolatility&&volumeMean>0?(bullish?'BUY':bearish?'SELL':'WAIT'):'WAIT';
 const reasons=[`Trend: SMA20 ${fast.toFixed(2)} / SMA50 ${slow.toFixed(2)} (10 bp separation required).`,`Momentum: Wilder RSI14 ${momentum.toFixed(1)}; bullish 50–70, bearish 30–50.`,`Volume: ${volume.toFixed(2)}× preceding 20 bars; confirmation ≥1.10×.`,`Higher timeframe ${FRAMES[hframe].label}: SMA20 ${hf.toFixed(2)} / SMA50 ${hs.toFixed(2)}.`,`Prior 20-bar support ${support.toFixed(2)}, resistance ${resistance.toFixed(2)}; close ${last!.close.toFixed(2)}.`,`Volatility: simple 14-bar ATR ${atr.toFixed(3)} (${(atr/last!.close*100).toFixed(2)}%); zero or >8% suspends setups.`];
 if(signal==='WAIT')reasons.push('Conditions do not jointly confirm a directional strategy setup.');
 const entry=signal==='BUY'?last!.close:null,stop=entry!==null?entry-2*atr:null;
 if(stop!==null&&stop<=0)return {...result,reasons:['Invalid protective level; no setup.']};
 return {signal,phase:signal==='WAIT'?'uncertain':'signal',time:last!.time??null,evidence,reasons,entry,exit:signal==='BUY'?entry!+3*atr:signal==='SELL'?last!.close:null,stop,atr,support,resistance};
}
export interface SimTrade {time:number;side:'BUY'|'SELL';price:number;units:number;fee:number;reason:string;pnl?:number}
export interface Equity {time:number;equity:number;benchmark?:number}
export interface Book {cash:number;units:number;cost:number;stop:number|null;target:number|null;trades:SimTrade[]}
export function newBook():Book{return {cash:COSTS.initial,units:0,cost:0,stop:null,target:null,trades:[]};}
export function buy(book:Book,price:number,time:number,decision:Decision,reason:string){
 const fill=price*(1+COSTS.slippageBps/10000),budget=Math.min(book.cash,(book.cash+book.units*price)*COSTS.allocation);
 if(book.units||decision.stop===null||decision.exit===null||fill<=decision.stop||fill>=decision.exit)return;
 const units=budget/(fill*(1+COSTS.feeBps/10000)),fee=units*fill*COSTS.feeBps/10000;
 book.cash-=units*fill+fee;book.units=units;book.cost=units*fill+fee;book.stop=decision.stop;book.target=decision.exit;book.trades.push({time,side:'BUY',price:fill,units,fee,reason});
}
export function sell(book:Book,price:number,time:number,reason:string){
 if(!book.units)return;const fill=price*(1-COSTS.slippageBps/10000),fee=book.units*fill*COSTS.feeBps/10000,proceeds=book.units*fill-fee;
 book.trades.push({time,side:'SELL',price:fill,units:book.units,fee,reason,pnl:proceeds-book.cost});book.cash+=proceeds;book.units=0;book.cost=0;book.stop=null;book.target=null;
}
export function statistics(curve:Equity[],trades:SimTrade[]){
 let peak=COSTS.initial,drawdown=0;for(const p of curve){peak=Math.max(peak,p.equity);drawdown=Math.min(drawdown,p.equity/peak-1);}
 const closed=trades.filter(t=>t.side==='SELL'),equity=curve.at(-1)?.equity??COSTS.initial;
 return {equity,return:equity/COSTS.initial-1,maxDrawdown:drawdown,closed:closed.length,wins:closed.filter(t=>t.pnl!>0).length,winRate:closed.length?closed.filter(t=>t.pnl!>0).length/closed.length:null,fees:trades.reduce((s,t)=>s+t.fee,0)};
}
export function historical(bars:PriceBar[],higher:PriceBar[],frame:Frame){
 const book=newBook(),curve:Equity[]=[],markers:{time:number;price:number;signal:string}[]=[];
 let benchCash:number=COSTS.initial,benchUnits=0,started=false;
 for(let i=60;i<bars.length;i++){
  const bar=bars[i],previous=bars[i-1],decision=analyze(bars.slice(0,i),higher,frame,periodEnd(previous.time,frame));
  if(!started){if(decision.phase==='insufficient')continue;const price=bar.open*(1+COSTS.slippageBps/10000),budget=COSTS.initial*COSTS.allocation;benchUnits=budget/(price*(1+COSTS.feeBps/10000));benchCash-=benchUnits*price*(1+COSTS.feeBps/10000);started=true;}
  if(decision.signal!=='WAIT')markers.push({time:previous.time,price:previous.close,signal:decision.signal});
  if(book.units&&decision.signal==='SELL')sell(book,bar.open,bar.time,'Previous completed-bar SELL');
  else if(!book.units&&decision.signal==='BUY')buy(book,bar.open,bar.time,decision,'Previous completed-bar BUY');
  if(book.units){if(bar.open<=book.stop!)sell(book,bar.open,bar.time,'Gap through stop');else if(bar.low<=book.stop!)sell(book,book.stop!,bar.time,'Stop (stop first if both levels touched)');else if(bar.high>=book.target!)sell(book,book.target!,bar.time,'Target');}
  if(i===bars.length-1){sell(book,bar.close,periodEnd(bar.time,frame),'Scheduled final liquidation');benchCash+=benchUnits*bar.close*(1-COSTS.slippageBps/10000)*(1-COSTS.feeBps/10000);benchUnits=0;}
  curve.push({time:bar.time,equity:book.cash+book.units*bar.close,benchmark:benchCash+benchUnits*bar.close});
 }
 return {curve,trades:book.trades,markers,metrics:curve.length?statistics(curve,book.trades):null,benchmarkReturn:curve.length?curve.at(-1)!.benchmark!/COSTS.initial-1:null};
}
export interface Forward {version:1;startedAt:number;lastBar:number;lastQuote:number;lastPrice:number|null;paused:boolean;totals:{peak:number;drawdown:number;wins:number;closed:number;fees:number};benchmark:{cash:number;units:number}|null;book:Book;signals:{observedAt:number;barTime:number;signal:string;evidence:number}[];curve:Equity[]}
export function newForward(now:number):Forward{return {version:1,startedAt:now,lastBar:0,lastQuote:0,lastPrice:null,paused:false,totals:{peak:10000,drawdown:0,wins:0,closed:0,fees:0},benchmark:null,book:newBook(),signals:[],curve:[]};}
export function observe(state:Forward,decision:Decision,quote:Quote|null,now:number):Forward{
 const next=structuredClone(state),isNew=decision.time!==null&&decision.time>next.lastBar;
 if(isNew){next.lastBar=decision.time!;next.signals.push({observedAt:now,barTime:decision.time!,signal:decision.signal,evidence:decision.evidence});next.signals=next.signals.slice(-1000);}
 if(!quote||now-quote.time>120000||quote.time>now+5000||quote.time<=next.lastQuote||quote.bid<=0||quote.ask<quote.bid||(quote.ask-quote.bid)/quote.ask>.005||next.paused)return next;
 if(next.lastPrice!==null&&(quote.bid/next.lastPrice<.6||quote.bid/next.lastPrice>1.6)){next.paused=true;return next;}
 if(!next.benchmark){const price=quote.ask*(1+COSTS.slippageBps/10000),budget=COSTS.initial*COSTS.allocation,units=budget/(price*(1+COSTS.feeBps/10000));next.benchmark={cash:COSTS.initial-budget,units};}
 const book=next.book,oldTrades=book.trades.length;let exited=false;
 if(book.units&&(quote.bid<=book.stop!||quote.bid>=book.target!)){sell(book,quote.bid,now,'Observed quote crossed protective level (unobserved prices not assumed)');exited=true;}
 if(isNew&&!exited&&decision.phase==='signal'){if(decision.signal==='SELL')sell(book,quote.bid,now,'Forward-observed SELL');else if(decision.signal==='BUY')buy(book,quote.ask,now,decision,'Forward-observed BUY');}
 for(const trade of book.trades.slice(oldTrades)){next.totals.fees+=trade.fee;if(trade.side==='SELL'){next.totals.closed++;if(trade.pnl!>0)next.totals.wins++;}}
 book.trades=book.trades.slice(-1000);
 const equity=book.cash+book.units*quote.bid;next.totals.peak=Math.max(next.totals.peak,equity);next.totals.drawdown=Math.min(next.totals.drawdown,equity/next.totals.peak-1);
 next.lastQuote=quote.time;next.lastPrice=quote.bid;next.curve.push({time:now,equity:book.cash+book.units*quote.bid,benchmark:next.benchmark.cash+next.benchmark.units*quote.bid});next.curve=next.curve.slice(-5000);return next;
}
