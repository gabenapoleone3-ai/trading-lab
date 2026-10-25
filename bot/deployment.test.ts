// @vitest-environment node
import { it,expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { emptyState, saveState } from './state';
it('persists and restores risk state through a separate Git branch without switching source checkout',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'obsidian-git-'));try{
  const remote=join(dir,'remote.git'),client=join(dir,'client');await mkdir(client);
  const git=(args:string[],cwd=client)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']});
  git(['init','--bare',remote]);git(['init']);git(['remote','add','origin',remote]);
  const script=resolve('scripts/state-sync.ts');const sync=(mode:string)=>execFileSync(process.execPath,[script,mode],{cwd:client,encoding:'utf8',stdio:['pipe','pipe','pipe']});
  sync('restore');const state=emptyState();state.peak=12345;state.maxDrawdown=-.07;state.halted=true;await saveState(join(client,'runtime/state.json'),state);sync('publish');
  const sourceBranch=git(['symbolic-ref','HEAD']);await rm(join(client,'runtime'),{recursive:true});sync('restore');
  const restored=JSON.parse(await readFile(join(client,'runtime/state.json'),'utf8'));expect(restored.peak).toBe(12345);expect(restored.halted).toBe(true);expect(restored.maxDrawdown).toBe(-.07);expect(git(['symbolic-ref','HEAD'])).toBe(sourceBranch);sync('publish');expect(Number(git(['rev-list','--count','refs/remotes/origin/paper-state']))).toBe(2); // A second ordinary push preserves the first risk-history commit.
  const publicData=JSON.parse(await readFile(join(client,'runtime/status.json'),'utf8'));expect(publicData).not.toHaveProperty('accountFingerprint');
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('serves read-only status and reports unconfigured credentials as unhealthy without broker access',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'obsidian-http-'));const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
 const child=spawn(process.execPath,['--use-env-proxy','bot/main.ts'],{cwd:process.cwd(),env:{...process.env,APCA_API_KEY_ID:'',APCA_API_SECRET_KEY:'',PAPER_STATE_PATH:join(dir,'state.json'),PAPER_STATUS_PATH:join(dir,'status.json'),PORT:String(port)},stdio:['ignore','pipe','pipe']});
 try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>reject(new Error('Worker exited '+code)));child.stdout.once('data',resolve);const timeout=setTimeout(()=>reject(new Error('Startup timeout')),10000);timeout.unref();});const url=`http://127.0.0.1:${port}`;
  expect((await fetch(url+'/healthz')).status).toBe(503);const status=await(await fetch(url+'/automation/status.json')).json();expect(status.status).toBe('blocked');expect(status.lastSuccess).toBeNull();expect(status.equity).toBeNull();expect((await fetch(url+'/automation/status.json',{method:'POST'})).status).toBe(405);expect((await fetch(url+'/%2e%2e%2fpackage.json')).ok).toBe(false);
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});}
},15000);
