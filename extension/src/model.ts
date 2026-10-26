export const FRAMES = {
 '1':{label:'1 minute',api:'1Min',ms:60_000,higher:'5',days:10},
 '5':{label:'5 minutes',api:'5Min',ms:300_000,higher:'15',days:35},
 '15':{label:'15 minutes',api:'15Min',ms:900_000,higher:'60',days:100},
 '30':{label:'30 minutes',api:'30Min',ms:1_800_000,higher:'240',days:180},
 '60':{label:'1 hour',api:'1Hour',ms:3_600_000,higher:'D',days:250},
 '240':{label:'4 hours',api:'4Hour',ms:14_400_000,higher:'D',days:700},
 'D':{label:'1 day',api:'1Day',ms:86_400_000,higher:'W',days:1500},
 'W':{label:'1 week',api:'1Week',ms:604_800_000,higher:'M',days:3500},
 'M':{label:'1 month',api:'1Month',ms:2_678_400_000,higher:'M',days:6000},
} as const;
export type Frame=keyof typeof FRAMES;
export const SELECTABLE:Frame[]=['1','5','15','30','60','240','D','W'];
export type PriceBar={time:number;open:number;high:number;low:number;close:number;volume:number};
export type Quote={time:number;bid:number;ask:number};
export type Context={status:'ok'|'unsupported';symbol:string;exchange:string;frame:Frame|null;reason:string;manual?:boolean};
export type Decision={signal:'BUY'|'SELL'|'WAIT';phase:'signal'|'uncertain'|'insufficient'|'unavailable';time:number|null;evidence:number;reasons:string[];entry:number|null;exit:number|null;stop:number|null;atr:number|null;support:number|null;resistance:number|null};
export const COSTS={feeBps:10,slippageBps:10,allocation:.1,initial:10000};
const nyFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const offsetFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'});
const ends=new Map<string,number>();
export function nyDate(time:number){return nyFormatter.format(time);}
function midnightNY(date:Date){const [y,m,d]=[date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()];const zone=offsetFormatter.formatToParts(new Date(Date.UTC(y,m,d,12))).find(p=>p.type==='timeZoneName')!.value;const offset=Number(zone.replace('GMT',''))||0;return Date.UTC(y,m,d)-offset*3600000;}
export function periodEnd(time:number,frame:Frame){
 if(!['D','W','M'].includes(frame))return time+FRAMES[frame].ms;
 const key=frame+':'+time,cached=ends.get(key);if(cached!==undefined)return cached;
 const date=new Date(nyDate(time)+'T00:00:00Z');
 if(frame==='M')date.setUTCMonth(date.getUTCMonth()+1,1);else date.setUTCDate(date.getUTCDate()+(frame==='W'?7:1));
 const end=midnightNY(date);if(ends.size>10000)ends.clear();ends.set(key,end);return end;
}
export function completed(bars:PriceBar[],frame:Frame,now:number){return bars.filter(b=>periodEnd(b.time,frame)<=now);}
export function unavailable(reason:string):Decision{return {signal:'WAIT',phase:'unavailable',time:null,evidence:0,reasons:[reason],entry:null,exit:null,stop:null,atr:null,support:null,resistance:null};}
export function parseFrame(value:string):Frame|null {
 const v=value.trim().replace(/\s+/g,'').toUpperCase();
 const mapping:Record<string,Frame>={'1':'1','1M':'1','1MIN':'1','5':'5','5M':'5','5MIN':'5','15':'15','15M':'15','15MIN':'15','30':'30','30M':'30','30MIN':'30','60':'60','1H':'60','1HOUR':'60','240':'240','4H':'240','4HOURS':'240','D':'D','1D':'D','1DAY':'D','W':'W','1W':'W','1WEEK':'W'};
 return mapping[v]??null;
}
export function parseSymbol(value:string):{symbol:string;exchange:string}|null{
 const v=value.trim().toUpperCase();const match=/^(?:(NASDAQ|NYSE|AMEX|ARCA|NYSEARCA|BATS):)?([A-Z][A-Z0-9.-]{0,14})$/.exec(v);
 return match?{exchange:match[1]??'',symbol:match[2]}:null;
}
export function displaySignal(signal:string,expiresAt:number,now:number){return expiresAt>now&&['BUY','SELL','WAIT'].includes(signal)?signal:'WAIT';}
