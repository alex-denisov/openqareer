#!/usr/bin/env node
/** Owner-local weekly collectors. Missing access is recorded as unavailable, never as zero. */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeSeoObservation } from './seo-observation-store.mjs';

const temporary=mkdtempSync(join(tmpdir(),'oq-seo-weekly-'));
const directory=process.env.SEO_OBSERVATION_DIR ?? join(process.cwd(),'docs/v1-release/seo/observations');
const journalPath=process.env.SEO_JOURNAL_PATH ?? join(process.cwd(),'docs/v1-release/seo/JOURNAL.md');
const appendJournal=process.argv.includes('--append-journal');
function run(provider) {
  return new Promise(resolve=>{
    const output=join(temporary,provider);
    const script=fileURLToPath(new URL(provider==='google'?'./google-seo-snapshot.mjs':'./seo-snapshot.mjs',import.meta.url));
    const child=spawn(process.execPath,[script],{stdio:'ignore',env:{...process.env,
      GOOGLE_SEO_SNAPSHOT_DIR:output,YANDEX_SEO_SNAPSHOT_DIR:output}});
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},120000);
    child.on('error',()=>{clearTimeout(timer);resolve({status:'unavailable',reason:'collector_start_failed',mode:'operational_check'});});
    child.on('close',code=>{
      clearTimeout(timer);
      try {
        const name=readdirSync(output).find(name=>name.endsWith('.json')&&!name.endsWith('.fixture.json'));
        if(!name) throw new Error('missing observation');
        const data=JSON.parse(readFileSync(join(output,name),'utf8'));
        resolve(code===0||data.status==='unavailable'?data:{status:'unavailable',reason:'collector_failed',mode:'operational_check'});
      } catch {resolve({status:'unavailable',reason:timedOut?'collector_timeout':code!==0?'collector_failed':'collector_output_missing',mode:'operational_check'});}
    });
  });
}
try {
  const providers=['google','yandex'];
  const results=await Promise.all(providers.map(run));
  results.forEach((snapshot,index)=>{
    const provider=providers[index];
    const file=storeSeoObservation(provider,snapshot,{directory,journalPath,appendJournal});
    process.stdout.write(`${provider}: ${snapshot.status==='unavailable'||snapshot.summary?.status==='unavailable'?'unavailable':'recorded'}; evidence: ${file}\n`);
  });
} finally {rmSync(temporary,{recursive:true,force:true});}
