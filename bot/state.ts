import { readFile, writeFile, rename, mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { RULES } from './config.ts';
const fill=z.object({id:z.string(),symbol:z.string(),side:z.enum(['buy','sell']),qty:z.number().positive(),price:z.number().positive(),date:z.string(),orderId:z.string()});
const snapshot=z.object({date:z.string(),equity:z.number().positive(),cash:z.number().finite()});
const position=z.object({symbol:z.string(),units:z.number().nonnegative(),value:z.number().nonnegative(),unrealizedPnl:z.number().finite()});
const event=z.object({date:z.string(),symbol:z.string(),action:z.string(),reason:z.string()});
export const stateSchema=z.object({version:z.literal(1),accountFingerprint:z.string().nullable().default(null),startedAt:z.string().nullable(),updatedAt:z.string().nullable(),lastSuccess:z.string().nullable(),status:z.enum(['blocked','ready','market_closed','paused','error']),message:z.string(),peak:z.number().nonnegative(),maxDrawdown:z.number().min(-1).max(0).default(0),halted:z.boolean(),attempts:z.array(z.string()).default([]),equity:z.number().positive().nullable(),cash:z.number().finite().nullable(),baseline:z.number().positive().nullable(),snapshots:z.array(snapshot),fills:z.array(fill),positions:z.array(position),events:z.array(event)});
export type State=z.infer<typeof stateSchema>;
export function emptyState():State {return {version:1,accountFingerprint:null,startedAt:null,updatedAt:null,lastSuccess:null,status:'blocked',message:'Paper credentials and a scheduled worker are required. No automated broker trading has started.',peak:0,maxDrawdown:0,halted:false,attempts:[],equity:null,cash:null,baseline:null,snapshots:[],fills:[],positions:[],events:[]};}
export async function loadState(path:string):Promise<State>{try{return stateSchema.parse(JSON.parse(await readFile(path,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return emptyState();throw new Error('State file is corrupt or unreadable; refusing to reset risk history. Restore a verified backup.');}}
export async function saveState(path:string,state:State){stateSchema.parse(state);await mkdir(dirname(path),{recursive:true});const temp=path+'.tmp';await writeFile(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});await rename(temp,path);}
// O_EXCL prevents two workers sharing a volume from trading concurrently. A crash
// leaves the lock in place: an operator must establish the old process is dead.
export async function acquireLock(path:string){await mkdir(dirname(path),{recursive:true});const file=await open(path+'.lock','wx');await file.writeFile(String(process.pid));return async()=>{await file.close();await unlink(path+'.lock');};}
export function tradePerformance(fills:State['fills']){
  const books:Record<string,{qty:number;cost:number}>={};let realized=0,wins=0,closed=0,modeledCosts=0;
  for(const f of [...fills].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))){
    const book=books[f.symbol]??{qty:0,cost:0};const fee=f.qty*f.price*RULES.feeBps/10000;modeledCosts+=fee;
    if(f.side==='buy'){book.qty+=f.qty;book.cost+=f.qty*f.price+fee;}
    else {if(f.qty>book.qty+1e-6)throw new Error('Fill ledger contains sells without matching purchases; performance is unavailable.');const basis=book.qty?book.cost*f.qty/book.qty:0;const pnl=f.qty*f.price-fee-basis;realized+=pnl;wins+=pnl>0?1:0;closed++;book.qty=Math.max(0,book.qty-f.qty);book.cost=Math.max(0,book.cost-basis);}
    books[f.symbol]=book;
  }
  return {realizedPnl:realized,winRate:closed?wins/closed:null,closedSellFills:closed,modeledCosts};
}
export function publicStatus(state:State){
  const maxDrawdown=state.maxDrawdown;
  let performance:ReturnType<typeof tradePerformance>|null=null;try{if(state.baseline!==null)performance=tradePerformance(state.fills);}catch{/* Missing corporate action/basis: do not invent a win rate. */}
  return {schemaVersion:1,mode:'paper' as const,source:'Alpaca paper account + IEX single-exchange market data',updatedAt:state.updatedAt,lastSuccess:state.lastSuccess,status:state.status,message:state.message,halted:state.halted,equity:state.equity,cash:state.cash,baseline:state.baseline,pnl:state.equity!==null&&state.baseline!==null?state.equity-state.baseline:null,maxDrawdown:state.snapshots.length?maxDrawdown:null,performance,positions:state.positions,snapshots:state.snapshots.slice(-2000),fills:state.fills.slice(-500).map(({orderId:_,id:__,...f})=>f),events:state.events.slice(-100),rules:RULES};
}
