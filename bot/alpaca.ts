import { z } from 'zod';
import { PAPER_ORIGIN, DATA_ORIGIN, SYMBOLS } from './config.ts';
import type { Config } from './config.ts';
import { validateBars } from '../src/engine.ts';
const numeric=z.union([z.string().min(1),z.number()]).transform(Number).refine(Number.isFinite,'Nonfinite broker value');
const positive=numeric.refine(v=>v>0);
const nonnegative=numeric.refine(v=>v>=0);
const timestamp=z.string().refine(v=>Number.isFinite(Date.parse(v)));
export const accountSchema=z.object({id:z.string().min(1),status:z.string(),currency:z.string(),cash:numeric,equity:positive,last_equity:positive,trading_blocked:z.boolean(),account_blocked:z.boolean()});
export const positionSchema=z.object({symbol:z.string(),qty:numeric,market_value:numeric,avg_entry_price:positive,current_price:positive,side:z.string()});
export const orderSchema=z.object({id:z.string(),client_order_id:z.string(),symbol:z.string(),side:z.enum(['buy','sell']),status:z.string(),qty:nonnegative,filled_qty:nonnegative,filled_avg_price:positive.nullable(),created_at:timestamp});
export const fillSchema=z.object({id:z.string(),order_id:z.string(),symbol:z.string(),side:z.enum(['buy','sell']),qty:positive,price:positive,transaction_time:timestamp});
export type Account=z.infer<typeof accountSchema>;
export type Position=z.infer<typeof positionSchema>;
export type BrokerOrder=z.infer<typeof orderSchema>;
export type BrokerFill=z.infer<typeof fillSchema>;
export interface OrderRequest {symbol:string;side:'buy'|'sell';qty:string;type:'limit';time_in_force:'day';limit_price:string;client_order_id:string;extended_hours:false}
export class ApiError extends Error {
  status: number;
  constructor(status:number) {super(`Alpaca request failed (HTTP ${status}); no response body logged.`);this.status=status;}
}
export class Alpaca {
  private cfg: Config;
  private transport: typeof fetch;
  constructor(cfg:Config,transport:typeof fetch=fetch) {this.cfg=cfg;this.transport=transport;}
  async request(path:string,method='GET',body?:unknown,data=false):Promise<unknown> {
    if(!path.startsWith('/v2/') || path.includes('://')) throw new Error('Unsupported broker route.');
    if(!this.cfg.key||!this.cfg.secret) throw new Error('Missing paper API credentials.');
    for(let attempt=0;attempt<3;attempt++) {
      let response:Response;
      try { response=await this.transport((data?DATA_ORIGIN:PAPER_ORIGIN)+path,{method,headers:{'APCA-API-KEY-ID':this.cfg.key,'APCA-API-SECRET-KEY':this.cfg.secret,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'}); }
      catch { if(method==='GET'&&attempt<2){await new Promise(r=>setTimeout(r,200*(attempt+1)));continue;}throw new Error(method==='POST'?'Order acknowledgement unknown; reconcile by client order ID before any retry.':'Broker connection failed; credentials and response bodies are not logged.'); }
      if(method==='GET'&&(response.status===429||response.status>=500)&&attempt<2){await new Promise(r=>setTimeout(r,200*(attempt+1)));continue;}
      if(!response.ok)throw new ApiError(response.status);
      if(response.status===204)return null;
      try{return await response.json();}catch{throw new Error('Malformed broker JSON.');}
    }
    throw new Error('Broker retry limit reached.');
  }
  async account(){return accountSchema.parse(await this.request('/v2/account'));}
  async clock(){return z.object({timestamp,is_open:z.boolean(),next_open:timestamp,next_close:timestamp}).parse(await this.request('/v2/clock'));}
  async calendar(start:string,end:string){return z.array(z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),open:z.string(),close:z.string()})).parse(await this.request('/v2/calendar?'+new URLSearchParams({start,end})));}
  async positions(){return z.array(positionSchema).parse(await this.request('/v2/positions'));}
  async asset(symbol:string){return z.object({symbol:z.string(),status:z.string(),tradable:z.boolean(),class:z.string()}).parse(await this.request('/v2/assets/'+encodeURIComponent(symbol)));}
  async orders(open=false,since?:string){
    const result:BrokerOrder[]=[];let until:string|undefined;
    for(let page=0;page<20;page++) {
      const params=new URLSearchParams({status:open?'open':'all',limit:'500',direction:'desc',nested:'false'});if(since)params.set('after',since);if(until)params.set('until',until);
      const rows=z.array(orderSchema).parse(await this.request('/v2/orders?'+params));result.push(...rows);
      if(rows.length<500)return [...new Map(result.map(o=>[o.id,o])).values()];
      const next=rows.at(-1)!.created_at;if(next===until)throw new Error('Broker orders pagination did not progress.');until=next;
    }
    throw new Error('Order history exceeds pagination safety limit.');
  }
  async fills(since:string){
    const result:BrokerFill[]=[];let token:string|undefined;
    for(let page=0;page<40;page++){
      const params=new URLSearchParams({after:since,direction:'desc',page_size:'100'});if(token)params.set('page_token',token);
      const rows=z.array(fillSchema).parse(await this.request('/v2/account/activities/FILL?'+params));result.push(...rows);
      if(rows.length<100)return [...new Map(result.map(f=>[f.id,f])).values()];
      const next=rows.at(-1)!.id;if(next===token)throw new Error('Fill pagination did not progress.');token=next;
    }
    throw new Error('Fill history exceeds pagination safety limit.');
  }
  async byClientId(id:string){try{return orderSchema.parse(await this.request('/v2/orders:by_client_order_id?'+new URLSearchParams({client_order_id:id})));}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e;}}
  async submit(order:OrderRequest){
    if(!(SYMBOLS as readonly string[]).includes(order.symbol)||order.type!=='limit'||order.time_in_force!=='day'||order.extended_hours!==false||!['buy','sell'].includes(order.side)||!(Number(order.qty)>0)||!(Number(order.limit_price)>0)||!order.client_order_id.startsWith('obs-v1-'))throw new Error('Unsupported paper order.');
    return orderSchema.parse(await this.request('/v2/orders','POST',order));
  }
  async cancel(id:string){await this.request('/v2/orders/'+encodeURIComponent(id),'DELETE');}
  async bars(symbol:string,now:Date){
    const start=new Date(now.getTime()-200*86400000).toISOString();let token:string|undefined;const all:unknown[]=[];
    const bar=z.object({t:timestamp,o:positive,h:positive,l:positive,c:positive,v:nonnegative});
    for(let page=0;page<10;page++){
      const params=new URLSearchParams({timeframe:'1Day',start,end:now.toISOString(),limit:'10000',feed:'iex',adjustment:'all',sort:'asc'});if(token)params.set('page_token',token);
      const response=z.object({bars:z.array(bar).nullable(),next_page_token:z.string().nullable().optional()}).parse(await this.request('/v2/stocks/'+symbol+'/bars?'+params,'GET',undefined,true));
      all.push(...(response.bars??[]));if(!response.next_page_token){const values=z.array(bar).parse(all);return validateBars(values.map(b=>({date:marketDate(new Date(b.t)),open:b.o,high:b.h,low:b.l,close:b.c,rawClose:b.c,volume:b.v})));}
      if(token===response.next_page_token)throw new Error('Bar pagination did not progress.');token=response.next_page_token;
    }throw new Error('Bar history exceeds pagination safety limit.');
  }
  async quote(symbol:string){return z.object({quote:z.object({t:timestamp,bp:positive,ap:positive})}).parse(await this.request('/v2/stocks/'+symbol+'/quotes/latest?feed=iex','GET',undefined,true)).quote;}
}
export function marketDate(date:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
