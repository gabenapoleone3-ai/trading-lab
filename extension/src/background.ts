import { z } from 'zod';
import { analyze,historical,newForward,observe } from './analysis';
import { freshQuote,marketData } from './data';
import type { Credentials } from './data';
import { decodeForward } from './storage';
import { FRAMES,SELECTABLE,parseSymbol,periodEnd,unavailable } from './model';
import type { Context,Frame } from './model';
export type Snapshot={updatedAt:number;context:Context;bars:Awaited<ReturnType<typeof marketData>>['bars'];quote:Awaited<ReturnType<typeof marketData>>['quote'];decision:ReturnType<typeof analyze>;historical:ReturnType<typeof historical>|null;forward:ReturnType<typeof newForward>|null;error:string;quoteNote:string;nextRefreshAt:number};
const contextSchema=z.object({status:z.enum(['ok','unsupported']),symbol:z.string().max(30),exchange:z.string().max(20),frame:z.enum(['1','5','15','30','60','240','D','W']).nullable(),reason:z.string().max(500),manual:z.boolean().optional()});
const inFlight=new Map<string,Promise<Snapshot>>();let setup:Promise<void>|null=null;
function initialize(){return setup??=Promise.all([chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}),chrome.alarms.create('obsidian-refresh',{periodInMinutes:1})]).then(()=>{});}
void initialize();
function watchKey(ctx:Context){return `iex-v1:${ctx.symbol}:${ctx.frame}`;}
async function credentials():Promise<Credentials|null>{const session=await chrome.storage.session.get('credentials'),local=await chrome.storage.local.get('credentials');const parsed=z.object({key:z.string(),secret:z.string(),epoch:z.string()}).safeParse(session.credentials??local.credentials);return parsed.success?parsed.data:null;}
async function context(tabId:number):Promise<Context|null>{const values=await chrome.storage.session.get([`context:${tabId}`,`manual:${tabId}`]);const parsed=contextSchema.safeParse(values[`manual:${tabId}`]??values[`context:${tabId}`]);return parsed.success?parsed.data:null;}
async function refresh(ctx:Context):Promise<Snapshot>{
 const key=watchKey(ctx);if(inFlight.has(key))return inFlight.get(key)!;
 const task=(async()=>{const now=Date.now(),creds=await credentials();const snapshot:Snapshot={updatedAt:now,context:ctx,bars:[],quote:null,decision:unavailable('Connect an Alpaca paper market-data API key in extension settings.'),historical:null,forward:null,error:'',quoteNote:'',nextRefreshAt:now+60000};
  try{
   if(ctx.status!=='ok'||!ctx.frame||!SELECTABLE.includes(ctx.frame)||!parseSymbol(ctx.symbol))throw new Error('Unsupported chart context.');
   if(!creds){snapshot.error='Market-data credentials are not configured. No fabricated prices or simulated results are substituted.';return snapshot;}
   const data=await marketData(ctx.symbol,ctx.frame,creds,now);snapshot.bars=data.bars;snapshot.quote=data.quote;snapshot.quoteNote=data.quoteNote;
   const latest=data.bars.at(-1);if(!latest)throw new Error('No completed IEX bars for this instrument and interval.');
   snapshot.decision=analyze(data.bars,data.higher,ctx.frame,now);snapshot.historical=historical(data.bars,data.higher,ctx.frame);
   const maxAge=ctx.frame==='D'?5*86400000:ctx.frame==='W'?12*86400000:Math.max(FRAMES[ctx.frame].ms*3,15*60000);
   if(!freshQuote(data.quote,now)||now-periodEnd(latest.time,ctx.frame)>maxAge){snapshot.decision={...unavailable('Current quote or completed bars are stale/unavailable. Closed markets and unsupported feeds can cause this; no actionable current setup.'),time:latest.time};}
   const stored=await chrome.storage.local.get(null),ledgerKey='forward:'+key;const existing=stored[ledgerKey];
   if(!existing&&Object.keys(stored).filter(k=>k.startsWith('forward:')).length>=8)throw new Error('Eight-watch history limit reached. Export and clear histories in settings before adding another watch.');
   let state=existing?decodeForward(existing):newForward(now);
   state=observe(state,snapshot.decision,data.quote,now);snapshot.forward=state;
   if(state.paused)snapshot.decision={...unavailable('Large price discontinuity detected; forward simulation paused for corporate-action/data review. Export and explicitly reset this watch.'),time:latest.time};
   if((await credentials())?.epoch!==creds.epoch)throw new Error('Data connection changed during refresh; discarded response.');
   await chrome.storage.local.set({[ledgerKey]:state});
  }catch(e){snapshot.error=e instanceof z.ZodError?'Stored history or provider response failed validation. No data is invented; export/reset corrupt history explicitly.':e instanceof Error?e.message:'Analysis unavailable.';snapshot.decision=unavailable(snapshot.error);snapshot.nextRefreshAt=now+(snapshot.error.includes('rate limit')?300000:120000);}
  return snapshot;
 })();inFlight.set(key,task);try{const snapshot=await task;await chrome.storage.session.set({['snapshot:'+key]:snapshot});return snapshot;}finally{inFlight.delete(key);}
}
async function badge(tabId:number,snapshot:Snapshot){try{await chrome.tabs.sendMessage(tabId,{type:'SUMMARY',signal:snapshot.decision.signal,note:`${snapshot.context.manual?'Manual companion':'IEX companion'} · ${snapshot.context.symbol} · ${snapshot.decision.reasons[0]}`});}catch{/* Tab closed or navigated. */}}
async function view(force=false){
 const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(!tab?.id)return {context:null,snapshot:null};
 const ctx=await context(tab.id);if(!ctx||ctx.status!=='ok')return {context:ctx,snapshot:null};
 const stored=await chrome.storage.session.get('snapshot:'+watchKey(ctx));let snapshot=stored['snapshot:'+watchKey(ctx)] as Snapshot|undefined;
 if(!snapshot || (Date.now()>=snapshot.nextRefreshAt && (force||Date.now()-snapshot.updatedAt>55000)))snapshot=await refresh(ctx);
 const latest=await context(tab.id);if(JSON.stringify(latest)!==JSON.stringify(ctx))return {context:latest,snapshot:null};
 await badge(tab.id,snapshot);return {context:ctx,snapshot};
}
function extensionPage(sender:chrome.runtime.MessageSender,file:string){return sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL(file);}
async function handle(message:Record<string,unknown>,sender:chrome.runtime.MessageSender){
 await initialize();
 if(message.type==='CONTEXT'){
  const url=new URL(sender.url??'https://invalid.invalid');if(!sender.tab?.id||!['www.tradingview.com','tradingview.com'].includes(url.hostname)||!url.pathname.startsWith('/chart/'))throw new Error('Unauthorized context source.');
  const ctx=contextSchema.parse(message.context);await chrome.storage.session.set({['context:'+sender.tab.id]:ctx});const preferences=await chrome.storage.local.get('hideBadge');void chrome.tabs.sendMessage(sender.tab.id,{type:'HIDE_BADGE',hide:preferences.hideBadge===true}).catch(()=>{});void chrome.runtime.sendMessage({type:'CONTEXT_CHANGED'}).catch(()=>{});return {ok:true};
 }
 if(!extensionPage(sender,'panel.html')&&!extensionPage(sender,'options.html'))throw new Error('Only extension-owned pages may access analysis/settings.');
 switch(message.type){
  case 'GET_VIEW':return view(message.force===true);
  case 'OPEN_OPTIONS':await chrome.runtime.openOptionsPage();return {ok:true};
  case 'GET_SETTINGS':return {connected:!!await credentials(),remember:!!(await chrome.storage.local.get('credentials')).credentials,hideBadge:(await chrome.storage.local.get('hideBadge')).hideBadge===true};
  case 'SET_BADGE':{if(!extensionPage(sender,'options.html'))throw new Error('Use settings.');await chrome.storage.local.set({hideBadge:message.hide===true});const all=await chrome.storage.session.get(null);for(const key of Object.keys(all).filter(k=>k.startsWith('context:')))void chrome.tabs.sendMessage(Number(key.split(':')[1]),{type:'HIDE_BADGE',hide:message.hide===true}).catch(()=>{});return {ok:true};}
  case 'SAVE_CREDENTIALS':{
   if(!extensionPage(sender,'options.html'))throw new Error('Use the extension settings page.');
   const settings=z.object({key:z.string().trim().min(1).max(500),secret:z.string().trim().min(1).max(500),remember:z.boolean()}).parse(message);
   if(settings.key.startsWith('AK'))throw new Error('Use Alpaca paper keys, not live keys.');
   const creds={key:settings.key,secret:settings.secret,epoch:crypto.randomUUID()};await chrome.storage.local.remove('credentials');await chrome.storage.session.remove('credentials');
   await (settings.remember?chrome.storage.local:chrome.storage.session).set({credentials:creds});
   await chrome.storage.session.remove((Object.keys(await chrome.storage.session.get(null))).filter(k=>k.startsWith('snapshot:')));return {ok:true};
  }
  case 'CLEAR_CREDENTIALS':if(!extensionPage(sender,'options.html'))throw new Error('Use settings.');await chrome.storage.local.remove('credentials');await chrome.storage.session.remove('credentials');await chrome.storage.session.remove(Object.keys(await chrome.storage.session.get(null)).filter(k=>k.startsWith('snapshot:')));return {ok:true};
  case 'SET_MANUAL':{
   const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(!tab?.id)throw new Error('No active TradingView tab.');
   const ctx=await context(tab.id);if(!ctx)throw new Error('Open Supercharts first.');
   if(message.clear){await chrome.storage.session.remove('manual:'+tab.id);return {ok:true};}
   const symbol=parseSymbol(String(message.symbol??'')),frame=String(message.frame) as Frame;
   if(!symbol||!SELECTABLE.includes(frame))throw new Error('Use a supported US stock/ETF ticker and time interval.');
   await chrome.storage.session.set({['manual:'+tab.id]:{...symbol,frame,status:'ok',manual:true,reason:'Explicit manual companion context. It is not a claim about the selected TradingView pane.'}});return {ok:true};
  }
  case 'RESET_FORWARD':{const current=await view();if(!current.context)throw new Error('No current watch.');await chrome.storage.local.remove('forward:'+watchKey(current.context));await chrome.storage.session.remove('snapshot:'+watchKey(current.context));return {ok:true};}
  case 'EXPORT_HISTORY':{const stored=await chrome.storage.local.get(null);return Object.fromEntries(Object.entries(stored).filter(([k])=>k.startsWith('forward:')));}
  case 'CLEAR_HISTORY':if(!extensionPage(sender,'options.html'))throw new Error('Use settings.');await chrome.storage.local.remove(Object.keys(await chrome.storage.local.get(null)).filter(k=>k.startsWith('forward:')));await chrome.storage.session.remove(Object.keys(await chrome.storage.session.get(null)).filter(k=>k.startsWith('snapshot:')));return {ok:true};
  default:throw new Error('Unsupported extension message.');
 }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id){respond({error:'Unauthorized sender.'});return false;}
 if(message?.type==='OPEN_PANEL'&&sender.tab?.id&&/^https:\/\/(www\.)?tradingview\.com\/chart\//.test(sender.url??'')){void chrome.sidePanel.open({tabId:sender.tab.id}).then(()=>respond({ok:true}),()=>respond({error:'Use the Chrome toolbar button to open Obsidian.'}));return true;}
 if(!message||typeof message!=='object'){respond({error:'Invalid message.'});return false;}
 void handle(message,sender).then(respond,e=>respond({error:e instanceof Error&&!(e instanceof z.ZodError)?e.message:'Invalid extension input or operation unavailable; no secret values are logged.'}));return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name!=='obsidian-refresh')return;void (async()=>{await initialize();const all=await chrome.storage.session.get(null);for(const key of Object.keys(all).filter(k=>k.startsWith('context:'))){const id=Number(key.split(':')[1]);try{await chrome.tabs.get(id);const ctx=await context(id);if(ctx?.status==='ok'){const stored=await chrome.storage.session.get('snapshot:'+watchKey(ctx)),snapshot=stored['snapshot:'+watchKey(ctx)] as Snapshot|undefined;await badge(id,snapshot&&Date.now()<snapshot.nextRefreshAt?snapshot:await refresh(ctx));}}catch{await chrome.storage.session.remove([key,'manual:'+id]);}}})();});
chrome.tabs.onRemoved.addListener(tabId=>{void chrome.storage.session.remove(['context:'+tabId,'manual:'+tabId]);});
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading'){void chrome.storage.session.remove(['context:'+tabId,'manual:'+tabId]);void chrome.runtime.sendMessage({type:'CONTEXT_CHANGED'}).catch(()=>{});}});
