import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { config } from './config.ts';
import { Alpaca } from './alpaca.ts';
import { acquireLock, loadState, publicStatus, saveState } from './state.ts';
import { runCycle } from './worker.ts';
const cfg=config();
const release=await acquireLock(cfg.statePath);
let state=await loadState(cfg.statePath);
let busy=false,stopping=false;
const statusPath=process.env.PAPER_STATUS_PATH??resolve(cfg.statePath,'..','status.json');
async function durableState(){
 await saveState(cfg.statePath,state);
 if(process.env.PAPER_REMOTE_STATE==='true'){try{await promisify(execFile)(process.execPath,['scripts/state-sync.ts','publish'],{timeout:30000});}catch{throw new Error('Remote risk journal could not be persisted; no new order submitted.');}}
}
async function tick(){if(busy||stopping)return;busy=true;try{state=await runCycle(new Alpaca(cfg),state,cfg,new Date(),durableState);await saveState(cfg.statePath,state);await mkdir(resolve(statusPath,'..'),{recursive:true});await writeFile(statusPath,JSON.stringify(publicStatus(state),null,2)+'\n');console.log(JSON.stringify({time:state.updatedAt,level:state.status==='error'?'error':'info',status:state.status,message:state.message}));}finally{busy=false;}}
if(process.argv.includes('--once')){try{await tick();if(state.status==='error')process.exitCode=1;}finally{await release();}}
else {
 const root=resolve('dist');const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.txt':'text/plain'};
 const server=createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  try{const path=new URL(req.url??'/', 'http://localhost').pathname;
   if(path==='/healthz'){res.writeHead(state.status==='error'||state.status==='blocked'?503:200,{'Content-Type':'application/json'}).end(JSON.stringify({status:state.status,lastSuccess:state.lastSuccess}));return;}
   if(path==='/automation/status.json'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(publicStatus(state)));return;}
   const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
   if(!(await stat(file)).isFile()){res.writeHead(404).end();return;}
   res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'}).end(await readFile(file));
  }catch{res.writeHead(404).end('Not found');}
 });
 server.listen(cfg.port,'0.0.0.0');await tick();const timer=setInterval(()=>{tick().catch(()=>{console.error(JSON.stringify({level:'error',message:'State persistence failed; stopping worker to avoid losing risk history.'}));shutdown(1);});},cfg.intervalMs);
 async function shutdown(code=0){if(stopping)return;stopping=true;clearInterval(timer);server.close();while(busy)await new Promise(r=>setTimeout(r,50));await release();process.exit(code);}
 process.once('SIGTERM',()=>{void shutdown();});process.once('SIGINT',()=>{void shutdown();});
}
