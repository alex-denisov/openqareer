import { mkdirSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

const metric = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : 'нет данных';
export function observationSummary(provider, snapshot) {
  if (snapshot.status === 'unavailable') return 'недоступно';
  if (provider === 'google') {
    const data=snapshot.searchAnalytics ?? {};
    return `клики ${metric(data.clicks)}; показы ${metric(data.impressions)}; позиция ${metric(data.position)}`;
  }
  const summary=snapshot.summary;
  return summary?.status === 'available'
    ? `в поиске ${metric(summary.indexedPages)}; ИКС ${metric(summary.sqi)}` : 'показатели недоступны';
}

/** Owner-local operational evidence. Never append synthetic fixtures as real observations. */
export function storeSeoObservation(provider, snapshot, { directory, journalPath, appendJournal=false }) {
  if (!['google','yandex'].includes(provider)) throw new Error('Unsupported SEO provider');
  if (appendJournal && snapshot.mode === 'synthetic_fixture')
    throw new Error('Synthetic fixtures cannot enter the SEO journal');
  const observedAt=new Date(snapshot.observedAt ?? Date.now()).toISOString();
  const file=join(directory,`${observedAt.replace(/[:.]/gu,'-')}-${provider}.json`);
  mkdirSync(directory,{recursive:true,mode:0o700});
  writeFileSync(file,JSON.stringify({...snapshot,observedAt},null,2)+'\n',{mode:0o600});
  chmodSync(file,0o600);
  if (appendJournal) {
    mkdirSync(dirname(journalPath),{recursive:true,mode:0o700});
    const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date(observedAt));
    appendFileSync(journalPath,`\n| ${date} | ${provider} | ${observationSummary(provider,snapshot)} | ${snapshot.mode === 'official_api' ? 'API' : 'операционная проверка; не замер API'} | ${file} |\n`,{mode:0o600});
    chmodSync(journalPath,0o600);
  }
  return file;
}
