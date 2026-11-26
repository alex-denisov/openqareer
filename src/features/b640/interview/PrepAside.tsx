import { Fragment, useState } from 'react';
import { Button, Dialog, Icon, InfoTip, useToast } from '../kit';
import type { CompanyFacts } from './model/companyFacts';
import { memoText, type Memo } from './model/memoModel';

/** «Что известно о компании»: только данные платформы с источником; новостей до B391 нет. */
export function CompanyAbout({ facts }: { readonly facts: CompanyFacts }) {
  return (
    <section className="mod" aria-labelledby="co-title">
      <div className="lead-head">
        <h3 className="mod-title" id="co-title">
          Что известно о компании
        </h3>
        {facts.source ? <InfoTip label="Откуда данные" text={facts.source} /> : null}
      </div>
      {facts.rows.length > 0 ? (
        <dl className="kv">
          {facts.rows.map((row) => (
            <Fragment key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className="row-sub">О компании на платформе пока нет данных.</p>
      )}
    </section>
  );
}

function MemoBody({ memo }: { readonly memo: Memo }) {
  return (
    <div className="memo">
      {memo.meta.length > 0 ? <p className="row-sub">{memo.meta.join(' · ')}</p> : null}
      {memo.sections.map((section) => (
        <section key={section.title} aria-label={section.title}>
          <h4 className="mod-title">{section.title}</h4>
          <ul className="rows">
            {section.items.map((item) => (
              <li className="row" key={item.title}>
                <div>
                  <div className="row-title">{item.title}</div>
                  {item.text ? <div className="row-sub">{item.text}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** «Памятка к интервью»: всё подготовленное одним листом, копируется текстом. */
export function MemoLink({ memo }: { readonly memo: Memo }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  async function copy() {
    const copied = await copyText(memoText(memo));
    toast.show({ text: copied ? 'Памятка скопирована' : 'Не удалось скопировать' });
  }
  return (
    <>
      <button className="row-act ib-link" type="button" onClick={() => setOpen(true)}>
        <Icon name="file" />
        Памятка к интервью
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={memo.title}
        footer={
          <Button variant="primary" onClick={() => void copy()}>
            <Icon name="copy" />
            Скопировать
          </Button>
        }
      >
        <MemoBody memo={memo} />
      </Dialog>
    </>
  );
}
