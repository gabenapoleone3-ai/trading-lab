import { test,expect,chromium } from '@playwright/test';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fixtures } from '../src/fixtures.test-data';
const html='<!doctype html><html><head><title>Supercharts integration fixture</title></head><body><button data-name="header-toolbar-symbol-search">AAPL</button><button data-name="header-toolbar-intervals">D</button><div class="chart-container" style="width:900px;height:700px">Synthetic integration fixture; no TradingView prices are consumed.</div></body></html>';
test('packaged MV3 extension detects charts, isolates keys, analyzes authorized-provider fixtures and tracks forward observations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'obsidian-extension-')),path=resolve('extension/build');
 const context=await chromium.launchPersistentContext(dir,{headless:true,channel:'chromium',executablePath:process.env.EXTENSION_CHROMIUM_PATH||undefined,args:[`--disable-extensions-except=${path}`,`--load-extension=${path}`]});
 try{
  let [worker]=context.serviceWorkers();if(!worker)worker=await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const tv=await context.newPage();await context.route('https://www.tradingview.com/**',r=>r.fulfill({contentType:'text/html',body:html}));await tv.goto('https://www.tradingview.com/chart/example/?symbol=NASDAQ%3AAAPL');await expect(tv.locator('#obsidian-tv-badge')).toHaveCount(1);
  await expect.poll(async()=>await worker.evaluate(async()=>Object.keys(await chrome.storage.session.get(null)).some(k=>k.startsWith('context:')))).toBe(true);
  const tvId=await worker.evaluate(async()=>{const values=await chrome.storage.session.get(null);return Number(Object.keys(values).find(k=>k.startsWith('context:'))!.split(':')[1]);});
  async function pageFor(file:string){const event=context.waitForEvent('page');await worker.evaluate(file=>chrome.tabs.create({url:chrome.runtime.getURL(file),active:false}),file);const page=await event;await page.waitForLoadState();return page;}
  const options=await pageFor('options.html');await options.getByLabel('Paper API key ID',{exact:true}).fill('PK_EXTENSION_TEST_ONLY');await options.getByLabel('Paper API secret',{exact:true}).fill('EXTENSION_SECRET_TEST_ONLY');await options.getByRole('button',{name:'Save data connection'}).click();await expect(options.getByRole('status')).toContainText('Saved.');await expect(options.getByLabel('Paper API secret',{exact:true})).toHaveValue('');
  expect(await worker.evaluate(async()=>!!(await chrome.storage.local.get('credentials')).credentials)).toBe(false);
  const data=fixtures();await worker.evaluate(({bars,higher})=>{
   // Test-only provider interception in this temporary extension worker; never shipped.
   globalThis.fetch=async(input,init)=>{const url=new URL(String(input));if(url.origin!=='https://data.alpaca.markets'||init?.method!=='GET')throw new Error('Unexpected endpoint/method');
    if(url.pathname.endsWith('/quotes/latest'))return Response.json({quote:{t:new Date().toISOString(),bp:bars.at(-1)!.close,ap:bars.at(-1)!.close+.01}});
    const rows=url.searchParams.get('timeframe')==='1Week'?higher:bars;
    return Response.json({bars:[...rows].reverse().map(b=>({t:new Date(b.time).toISOString(),o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume})),next_page_token:null});};
  },data);
  await worker.evaluate(id=>chrome.tabs.update(id,{active:true}),tvId);
  const panel=await pageFor('panel.html');await expect(panel.getByRole('heading',{name:'NASDAQ:AAPL · 1 day'})).toBeVisible();await expect(panel.locator('.badge')).toHaveText('BUY',{timeout:15000});await expect(panel.getByRole('img')).toBeVisible();
  const marker=panel.locator(`[data-marker-time="${data.bars.at(-1)!.time}"]`);await expect(marker).toHaveAttribute('data-marker-price',String(data.bars.at(-1)!.close));
  await panel.getByRole('button',{name:'Performance',exact:true}).click();await expect(panel.getByRole('heading',{name:'Historical backtest — separate simulation'})).toBeVisible();await expect(panel.getByRole('heading',{name:'Forward-observed paper portfolio'})).toBeVisible();await expect(panel.getByText('Started ',{exact:false})).toBeVisible();
  await panel.getByRole('button',{name:'History',exact:true}).click();await expect(panel.locator('table').last().locator('tbody tr')).toHaveCount(1);expect(await panel.locator('main').innerText()).not.toContain('EXTENSION_SECRET_TEST_ONLY');
  await tv.locator('[data-name="header-toolbar-symbol-search"]').evaluate(e=>{e.textContent='MSFT';});await tv.locator('[data-name="header-toolbar-intervals"]').evaluate(e=>{e.textContent='1h';});await expect(panel.getByRole('heading',{name:'MSFT · 1 hour'})).toBeVisible({timeout:15000});
  await tv.evaluate(()=>{const second=document.createElement('div');second.className='chart-container';second.style.cssText='width:400px;height:400px';document.body.append(second);});await expect(panel.getByRole('heading',{name:'Open a single TradingView Superchart'})).toBeVisible();await expect(panel.locator('.badge')).toHaveText('WAIT');
  await options.getByLabel('Hide the small chart badge (toolbar side panel still works)').check();await expect(tv.locator('#obsidian-tv-badge')).toBeHidden();
  const downloading=options.waitForEvent('download');await options.getByRole('button',{name:'Export all forward histories (no keys)'}).click();const download=await downloading;const contents=await readFile((await download.path())!,'utf8');expect(contents).toContain('forward:iex-v1:AAPL:D');expect(contents).not.toContain('PK_EXTENSION_TEST_ONLY');expect(contents).not.toContain('EXTENSION_SECRET_TEST_ONLY');
  expect(id.length).toBe(32);
 }finally{await context.close();await rm(dir,{recursive:true,force:true});}
});
test('missing credentials remain WAIT; no broker/market data is invented',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'obsidian-empty-')),path=resolve('extension/build');const context=await chromium.launchPersistentContext(dir,{headless:true,channel:'chromium',executablePath:process.env.EXTENSION_CHROMIUM_PATH||undefined,args:[`--disable-extensions-except=${path}`,`--load-extension=${path}`]});
 try{let [worker]=context.serviceWorkers();if(!worker)worker=await context.waitForEvent('serviceworker');const tv=await context.newPage();await context.route('https://www.tradingview.com/**',r=>r.fulfill({contentType:'text/html',body:html}));await tv.goto('https://www.tradingview.com/chart/');await expect(tv.locator('#obsidian-tv-badge')).toHaveCount(1);const event=context.waitForEvent('page');await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('panel.html'),active:false}));const panel=await event;await expect(panel.locator('.badge')).toHaveText('WAIT');await expect(panel.getByRole('alert')).toContainText('credentials are not configured');await expect(panel.getByRole('img')).toHaveCount(0);}finally{await context.close();await rm(dir,{recursive:true,force:true});}
});
