import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('runs the credentialed CLI on isolated fake providers: JWT, totals, top queries, root sitemap and graph inspection', () => {
  const dir=mkdtempSync(join(tmpdir(),'oq-gsc-fixture-'));
  try {
    const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
    writeFileSync(join(dir,'credentials.json'),JSON.stringify({client_email:'fixture@example.test',private_key:privateKey}),{mode:0o600});
    writeFileSync(join(dir,'empty.env'),'');
    writeFileSync(join(dir,'mock-fetch.mjs'),`
      globalThis.fetch=async(url,options={})=>{
        const body=options.body && typeof options.body==='string'?JSON.parse(options.body):{};
        if(url==='https://oauth2.googleapis.com/token') {
          const claims=JSON.parse(Buffer.from(options.body.get('assertion').split('.')[1],'base64url'));
          if(claims.aud!=='https://oauth2.googleapis.com/token') throw new Error('incorrect JWT audience');
          return Response.json({access_token:'fixture-token'});
        }
        if(url.includes('/searchAnalytics/query')) return Response.json({rows:[{...(body.dimensions?{keys:['работа']}:{}),clicks:0,impressions:4,ctr:0,position:2.8}]});
        if(url.endsWith('/sitemaps')) return Response.json({sitemap:[{path:'https://openqareer.com/old-sitemap.xml'},{path:'https://openqareer.com/sitemap.xml'}]});
        if(url==='https://openqareer.com/sitemap.xml') return new Response('<urlset><url><loc>https://openqareer.com/vacancies/job/example</loc></url></urlset>');
        if(url.includes('/urlInspection/')) return Response.json({inspectionResult:{indexStatusResult:{verdict:'PASS'}}});
        if(url==='https://openqareer.com/vacancies/job/example') return new Response('<script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'JobPosting',title:'Engineer',description:'Fixture',datePosted:'2026-10-23',hiringOrganization:{name:'Example'},jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{name:'US'}}]})+'</script>');
        throw new Error('unexpected fixture request');
      };
    `);
    const result=spawnSync(process.execPath,['--import',join(dir,'mock-fetch.mjs'),resolve('scripts/google-seo-snapshot.mjs')],{
      env:{...process.env,OPENQAREER_ENV_FILE:join(dir,'empty.env'),GOOGLE_SEARCH_CONSOLE_TOKEN:'',GOOGLE_APPLICATION_CREDENTIALS:join(dir,'credentials.json'),GOOGLE_SEO_SNAPSHOT_DIR:join(dir,'snapshots'),GOOGLE_SEO_INSPECTION_LIMIT:'1'},
      encoding:'utf8',timeout:15000,
    });
    expect(result.status,result.stderr).toBe(0);
    const file=readdirSync(join(dir,'snapshots'))[0];
    const data=JSON.parse(readFileSync(join(dir,'snapshots',file),'utf8'));
    expect(data.topQueries.rows[0].keys).toEqual(['работа']);
    expect(data.searchAnalytics).toMatchObject({clicks:0,impressions:4,position:2.8});
    expect(data.sitemap.submitted).toBe('https://openqareer.com/sitemap.xml');
    expect(data.indexInspection).toMatchObject({sampled:1,indexed:1,notConfirmed:0});
    expect(data.jobPostingAudit).toMatchObject({sampled:1,valid:1});
    expect(result.stdout+result.stderr).not.toContain('fixture-token');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
