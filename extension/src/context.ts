import { parseFrame,parseSymbol } from './model';
import type { Context } from './model';
export function detectContext(doc:Document,url:string):Context {
 const unsupported=(reason:string):Context=>({status:'unsupported',symbol:'',exchange:'',frame:null,reason});
 const parsed=new URL(url);if(!['www.tradingview.com','tradingview.com'].includes(parsed.hostname)||!parsed.pathname.startsWith('/chart/'))return unsupported('Open TradingView Supercharts.');
 const candidates=[...doc.querySelectorAll<HTMLElement>('[data-name="chart-container"],.chart-container')].filter(e=>e.getBoundingClientRect().width>100&&e.getBoundingClientRect().height>100);
 const charts=candidates.filter(e=>!candidates.some(other=>other!==e&&other.contains(e)));
 if(charts.length!==1)return unsupported(charts.length>1?'Multiple chart panes detected. Automatic synchronization is disabled; use a single chart or explicit manual companion context.':'Chart layout cannot be verified. Use a supported single Superchart or manual companion context.');
 const button=[...doc.querySelectorAll<HTMLElement>('#header-toolbar-symbol-search,[data-name="header-toolbar-symbol-search"]')].at(-1);
 const raw=button?.getAttribute('data-symbol')||button?.textContent?.trim()||'';
 let symbol=parseSymbol(raw);
 if(!symbol)return unsupported('Cannot reliably read the chart ticker; no inferred substitute is used.');
 const fromUrl=parseSymbol(parsed.searchParams.get('symbol')??'');if(!symbol.exchange&&fromUrl?.symbol===symbol.symbol)symbol=fromUrl;
 const interval=[...doc.querySelectorAll<HTMLElement>('#header-toolbar-intervals,[data-name="header-toolbar-intervals"]')].at(-1);
 const selected=interval?.querySelector<HTMLElement>('[aria-checked="true"],[aria-pressed="true"]');
 const menu=interval?.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
 const frame=parseFrame(selected?.getAttribute('data-value')||selected?.textContent||menu?.getAttribute('aria-label')||menu?.textContent||interval?.getAttribute('data-value')||interval?.textContent||'');
 if(!frame)return unsupported('Chart interval cannot be verified or is unsupported (seconds, tick, range and non-time charts are excluded).');
 const type=doc.querySelector<HTMLElement>('#header-toolbar-chart-styles,[data-name="header-toolbar-chart-styles"]');
 const description=[type?.getAttribute('title'),type?.getAttribute('aria-label'),type?.textContent].filter(Boolean).join(' ');
 if(/heikin|renko|range|kagi|point.?&.?figure|line.?break/i.test(description))return unsupported('Synthetic/non-time chart type detected. Use standard candles or a manual companion context.');
 return {status:'ok',...symbol,frame,reason:symbol.exchange?'Synchronized from visible Supercharts controls.':'US ticker inferred from the visible toolbar; IEX availability is verified by the provider. Confirm instrument identity.'};
}
