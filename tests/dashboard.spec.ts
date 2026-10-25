import { test, expect } from '@playwright/test';
import { emptyState, publicStatus } from '../bot/state';
test('research, strategies, backtest and source labels work',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByText('Historical archive — not live prices.')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Price & moving averages'})).toBeVisible();
 await expect(page.locator('.recharts-surface').first()).toBeVisible();
 await page.getByLabel('Instrument',{exact:true}).selectOption('AGG');await expect(page.getByRole('heading',{name:'AGG iShares Core U.S. Aggregate Bond ETF'})).toBeVisible();
 await page.getByLabel('Educational strategy').selectOption('rsi');
 await page.getByRole('button',{name:'Backtest',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Equity · after transaction costs'})).toBeVisible();
 await expect(page.getByRole('cell',{name:'End-of-test liquidation'})).toBeVisible();
 await page.getByLabel('Commission (bps per side)').fill('-1');await expect(page.getByRole('alert')).toContainText('Invalid backtest settings');
 await page.getByRole('button',{name:'Methodology & sources',exact:true}).click();await expect(page.getByRole('heading',{name:'Transparent by design.'})).toBeVisible();
 expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('paper orders persist, account for fees, advance and reject invalid trades',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Paper portfolio',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your paper portfolio.'})).toBeVisible();
 await page.getByLabel('Adjusted units').fill('10');await page.getByRole('button',{name:'Simulate buy'}).click();
 await expect(page.getByRole('status')).toContainText('saved');await expect(page.locator('.ledger tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'Next session →'}).click();await expect(page.locator('time')).toHaveText('2010-01-05');
 await page.reload();await page.getByRole('button',{name:'Paper portfolio',exact:true}).click();await expect(page.locator('time')).toHaveText('2010-01-05');await expect(page.locator('.ledger tbody tr')).toHaveCount(1);
 await page.getByLabel('Side',{exact:true}).selectOption('SELL');await page.getByLabel('Adjusted units').fill('11');await page.getByRole('button',{name:'Simulate sell'}).click();await expect(page.getByRole('status')).toContainText('Cannot sell more');
 await page.getByLabel('Adjusted units').fill('10');await page.getByRole('button',{name:'Simulate sell'}).click();await expect(page.locator('.ledger tbody tr')).toHaveCount(2);
 await expect(page.getByText('No open positions. Cash earns no interest.')).toBeVisible();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Reset simulation'}).click();await expect(page.locator('.ledger tbody tr')).toHaveCount(0);await expect(page.locator('time')).toHaveText('2010-01-04');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('invalid stored portfolio is preserved until explicit reset',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('trading-lab-paper-v1','broken-json'));await page.goto('/');await page.getByRole('button',{name:'Paper portfolio',exact:true}).click();await expect(page.getByRole('heading',{name:'Portfolio storage needs attention'})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('trading-lab-paper-v1'))).toBe('broken-json');
});
test('network failure is visible and retry restores data',async({page})=>{
 await page.route('**/data/SPY.json',r=>r.abort());await page.goto('/');await expect(page.getByRole('heading',{name:'Historical data unavailable'})).toBeVisible();await page.unroute('**/data/SPY.json');await page.getByRole('button',{name:'Retry loading data'}).click();await expect(page.getByRole('heading',{name:'Price & moving averages'})).toBeVisible();
});
test('automation reports missing credentials honestly and separates historical performance',async({page})=>{
 await page.route('**/automation/status.json',r=>r.fulfill({json:publicStatus(emptyState())}));
 await page.goto('/');await page.getByRole('button',{name:'Automation',exact:true}).click();await expect(page.getByRole('heading',{name:'Automation control room.'})).toBeVisible();await expect(page.getByRole('heading',{name:'Worker: blocked'})).toBeVisible();await expect(page.getByText('No broker fills observed.')).toBeVisible();await expect(page.getByRole('heading',{name:'Automation strategy versus allocated buy & hold'})).toBeVisible();await expect(page.getByText('No recent successful cycle verified')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('automation status fetch failures never appear as active trading',async({page})=>{
 await page.route('**/automation/status.json',route=>route.fulfill({status:503,body:'unavailable'}));await page.goto('/');await page.getByRole('button',{name:'Automation',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Do not assume automation is running.');await expect(page.getByRole('heading',{name:'Worker: ready'})).toHaveCount(0);
});
