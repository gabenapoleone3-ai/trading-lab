import { readFile, writeFile } from 'node:fs/promises';
import { autonomousBacktest } from '../bot/backtest.ts';
import { validateBars, backtest } from '../src/engine.ts';
import type { Market } from '../src/engine.ts';
const market:Market={};for(const symbol of ['SPY','AGG','AAPL'])market[symbol]=validateBars(JSON.parse(await readFile(`public/data/${symbol}.json`,'utf8')));
const report=autonomousBacktest(market);
await writeFile('public/automation/backtest.json',JSON.stringify(report)+'\n');
console.log(JSON.stringify({historicalAutonomous:{...report,curve:undefined,fills:report.fills.length},legacySPY:backtest(market.SPY,{strategy:'ma',start:'2014-01-02',end:'2016-01-04',feeBps:10,slippageBps:5,fast:20,slow:50}).strategy},null,2));
