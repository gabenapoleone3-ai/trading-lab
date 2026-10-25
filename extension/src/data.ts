import { z } from 'zod';
import { FRAMES,completed,parseSymbol } from './model';
import type { Frame,PriceBar,Quote } from './model';
export type Credentials={key:string;secret:string;epoch:string};
const value=z.number().finite().positive();
const barSchema=z.object({t:z.string().datetime({offset:true}),o:value,h:value,l:value,c:value,v:z.number().finite().nonnegative()});
export function parseBars(input:unknown,now:number):PriceBar[]{
 const response=z.object({bars:z.array(barSchema).nullable()}).parse(input);
 const values=(response.bars??[]).map(b=>({time:Date.parse(b.t),open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v})).sort((a,b)=>a.time-b.time);
 if(values.some((b,i)=>b.time>now+5000||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low||(i>0&&b.time<=values[i-1].time)))throw new Error('Invalid or duplicated provider bars. No replacement prices are generated.');
 return values;
}
export async function api(path:string,credentials:Credentials,transport:typeof fetch=fetch){
 if(!/^\/v2\/stocks\/[A-Z][A-Z0-9.%\-]*\/(bars\?|quotes\/latest\?)/.test(path))throw new Error('Only supported market-data GET routes are permitted.');
 let response:Response;
 try{response=await transport('https://data.alpaca.markets'+path,{method:'GET',headers:{'APCA-API-KEY-ID':credentials.key,'APCA-API-SECRET-KEY':credentials.secret},redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw new Error('Market-data connection failed. Check the provider connection; no credentials are logged.');}
 if(!response.ok)throw new Error(response.status===429?'Provider rate limit reached. Automatic refresh will back off.':`Market-data HTTP ${response.status}. Check paper API keys, data entitlement and symbol coverage; no paid feed is selected.`);
 try{return await response.json();}catch{throw new Error('Provider returned invalid JSON.');}
}
export async function marketData(symbol:string,frame:Frame,credentials:Credentials,now:number,transport:typeof fetch=fetch){
 if(!parseSymbol(symbol)||symbol.includes(':'))throw new Error('Unsupported provider ticker.');
 const getBars=async(tf:Frame)=>{const spec=FRAMES[tf];const query=new URLSearchParams({timeframe:spec.api,start:new Date(now-spec.days*86400000).toISOString(),end:new Date(now).toISOString(),sort:'desc',limit:'600',feed:'iex',adjustment:'split'});return completed(parseBars(await api(`/v2/stocks/${encodeURIComponent(symbol)}/bars?${query}`,credentials,transport),now),tf,now);};
 const [bars,higher]=await Promise.all([getBars(frame),getBars(FRAMES[frame].higher)]);
 let quote:Quote|null=null;let quoteNote='';
 try{const result=z.object({quote:z.object({t:z.string().datetime({offset:true}),bp:value,ap:value})}).parse(await api(`/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest?feed=iex`,credentials,transport));quote={time:Date.parse(result.quote.t),bid:result.quote.bp,ask:result.quote.ap};}catch{quoteNote='Latest quote unavailable; no forward fill or actionable current signal.';}
 return {bars,higher,quote,quoteNote};
}
export function freshQuote(quote:Quote|null,now:number){return !!quote&&now-quote.time<=120000&&quote.time<=now+5000&&quote.bid>0&&quote.ask>=quote.bid&&(quote.ask-quote.bid)/quote.ask<=.005;}
