// Synthetic test fixtures only. Never imported by production extension entry points.
import type {PriceBar} from './model';
export const NOW=Date.UTC(2026,9,23,20);
export function fixtures(){
 const bars:PriceBar[]=Array.from({length:160},(_,i)=>{const price=100+i*.2+Math.sin(i*1.7)*2;return {time:Date.UTC(2026,9,22,4)-(159-i)*86400000,open:price-.01,high:price+.05,low:price-.05,close:price,volume:100};});
 const last=bars.at(-1)!;last.close=Math.max(...bars.slice(-21,-1).map(b=>b.high))+.3;last.open=last.close-.1;last.high=last.close+.05;last.low=last.open-.05;last.volume=180;
 const higher:PriceBar[]=Array.from({length:160},(_,i)=>{const price=70+i*.5;return {time:Date.UTC(2026,9,12,4)-(159-i)*7*86400000,open:price-.1,high:price+.2,low:price-.2,close:price,volume:100};});
 return {bars,higher};
}
