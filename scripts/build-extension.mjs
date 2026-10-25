import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile,writeFile,mkdir,rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit'],{stdio:'inherit'});
execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','extension/vite.config.ts'],{stdio:'inherit'});
await build({entryPoints:['extension/src/background.ts'],bundle:true,format:'esm',platform:'browser',target:'chrome120',outfile:'extension/build/background.js',minify:true});
await build({entryPoints:['extension/src/content.ts'],bundle:true,format:'iife',platform:'browser',target:'chrome120',outfile:'extension/build/content.js',minify:true});
await mkdir('releases',{recursive:true});
const file='releases/obsidian-extension-v1.0.0.zip';
await rm(file,{force:true});
// Zip only the loadable extension root; never repository files, .env, profiles or runtime state.
execFileSync('zip',['-q','-r','../../'+file,'.'],{cwd:'extension/build'});
const digest=createHash('sha256').update(await readFile(file)).digest('hex');await writeFile(file+'.sha256',digest+'  obsidian-extension-v1.0.0.zip\n');console.log('Built '+file+' · SHA-256 '+digest);
