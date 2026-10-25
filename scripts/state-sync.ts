// Git plumbing publishes a separate state branch without changing the source checkout.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { loadState, publicStatus, stateSchema } from '../bot/state.ts';
const ref='refs/heads/paper-state',remote='refs/remotes/origin/paper-state';
function git(args:string[],input?:string){return execFileSync('git',args,{encoding:'utf8',input,env:{...process.env,GIT_AUTHOR_NAME:'Obsidian paper worker',GIT_AUTHOR_EMAIL:'obsidian@users.noreply.github.com',GIT_COMMITTER_NAME:'Obsidian paper worker',GIT_COMMITTER_EMAIL:'obsidian@users.noreply.github.com'}}).trim();}
const mode=process.argv[2];await mkdir('runtime',{recursive:true});
if(mode==='restore'){
 const exists=git(['ls-remote','--heads','origin',ref]);
 if(exists){git(['fetch','origin',`${ref}:${remote}`]);const value=stateSchema.parse(JSON.parse(git(['show',`${remote}:state.json`])));await writeFile('runtime/state.json',JSON.stringify(value));}
 const state=await loadState('runtime/state.json');await writeFile('runtime/status.json',JSON.stringify(publicStatus(state),null,2)+'\n');
 console.log(exists?'Restored durable paper risk history.':'No prior state branch; first broker start will require an empty dedicated paper account.');
}else if(mode==='publish'){
 const state=await loadState('runtime/state.json');await writeFile('runtime/status.json',JSON.stringify(publicStatus(state),null,2)+'\n');
 const stateBlob=git(['hash-object','-w','--stdin'],JSON.stringify(state,null,2)+'\n');
 const publicBlob=git(['hash-object','-w','--stdin'],await readFile('runtime/status.json','utf8'));
 const tree=git(['mktree'],`100644 blob ${stateBlob}\tstate.json\n100644 blob ${publicBlob}\tstatus.json\n`);
 let parent='';try{parent=git(['rev-parse','--verify',remote]);}catch{/* A verified absent branch is valid on first publish. */}
 const commit=git(['commit-tree',tree,...(parent?['-p',parent]:[])],'Persist paper worker observations and risk state\n');
 git(['push','origin',`${commit}:${ref}`]);console.log('Published paper-state snapshot (account identifiers and credentials excluded).');
}else throw new Error('Use restore or publish.');
