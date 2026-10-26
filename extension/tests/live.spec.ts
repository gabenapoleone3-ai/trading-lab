import {test,expect,chromium} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('live public Supercharts loads the actual extension badge and detects chart metadata without a data key',async()=>{
 test.skip(process.env.OBSIDIAN_LIVE_SITE_TEST!=='true','Explicit opt-in: external website availability is separate from deterministic integration fixtures.');
 const dir=await mkdtemp(join(tmpdir(),'obsidian-live-')),path=resolve('extension/build');const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path}`,`--load-extension=${path}`]});
 try{let [worker]=context.serviceWorkers();if(!worker)worker=await context.waitForEvent('serviceworker');const page=await context.newPage();await page.goto('https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL',{waitUntil:'domcontentloaded',timeout:45000});await expect(page.locator('#obsidian-tv-badge')).toHaveCount(1);await expect(page.locator('#header-toolbar-symbol-search')).toBeVisible({timeout:45000});
 await expect.poll(async()=>worker.evaluate(async()=>{const values=await chrome.storage.session.get(null);return Object.entries(values).filter(([key])=>key.startsWith('context:')).map(([,v])=>(v as {symbol?:string;frame?:string;status?:string}));}),{timeout:15000}).toContainEqual(expect.objectContaining({status:'ok',symbol:'AAPL',frame:'D'}));
 await page.screenshot({path:'test-results/live-supercharts.png'});console.log('Actual Supercharts + packaged MV3 content badge/context verified. No market-data credentials or live signal claims.');
 }finally{await context.close();await rm(dir,{recursive:true,force:true});}
},90000);
