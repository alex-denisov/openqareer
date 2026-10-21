import { useState } from 'react';
import { Fingerprint, GraduationCap, LockKey, Translate, UsersThree } from '@phosphor-icons/react';
import type {
  RelocationAlert,
  RelocationConsentState,
  RelocationQuestionnaire,
  RelocationStepId,
} from '../../../shared/relocationQuestionnaire';
import { apiErrorMessage } from '../coach/apiClient';
import { revokeRelocationConsent } from './relocationApi';
import {
  DOCUMENT_KIND_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  LANGUAGE_LEVEL_OPTIONS,
  relocationCountryName,
  relocationRecognitionLabel,
} from './RelocationFormControls';
import { InlineConfirmation } from './RelocationQuestionnaire';
import { MobileGroup, MobileNavRow } from './mobile/MobileRows';
import { mobileDate } from './mobile/MobileSteps';

export interface RelocationMobileDataProps {
  readonly profile: RelocationQuestionnaire;
  readonly consent: RelocationConsentState;
  readonly alerts: readonly RelocationAlert[];
  readonly onEditStep: (step: RelocationStepId) => void;
  readonly onConsentRevoked: (consent: RelocationConsentState) => void;
}

const PARTNER: Readonly<Record<string, string>> = {
  no_partner: 'Один',
  has_partner: 'С партнёром',
  undecided: 'Не решил',
  unknown: 'Состав семьи не указан',
};
const TIMEFRAME: Readonly<Record<string, string>> = {
  under_two_weeks: 'оформление не больше 2 недель',
  under_three_months: 'оформление до 3 месяцев',
  three_to_six_months: 'оформление 3–6 месяцев',
  six_to_twelve_months: 'оформление 6–12 месяцев',
  over_twelve_months: 'дольше, если надёжно',
  unknown: 'срок не указан',
};

function optionLabel<T extends string>(
  options: readonly (readonly [T, string])[],
  value: T,
): string {
  return options.find(([code]) => code === value)?.[1] ?? value;
}

function documentSub(expiresAt: string | undefined, alert: RelocationAlert | undefined): string {
  if (!expiresAt) return 'срок не указан';
  if (alert?.kind === 'document_expired') return `истёк ${mobileDate(expiresAt)}`;
  if (alert?.kind === 'document_expiring')
    return `до ${mobileDate(expiresAt)}: срок скоро закончится`;
  return `до ${mobileDate(expiresAt)}`;
}

function CitizenshipGroup({ profile, alerts, onEditStep }: RelocationMobileDataProps) {
  const { citizenshipCountryCodes, documents } = profile.citizenshipDocuments;
  const open = () => onEditStep('citizenship_documents');
  const icon = <Fingerprint aria-hidden="true" />;
  return (
    <MobileGroup caption="Гражданство и документы">
      {citizenshipCountryCodes.length ? (
        citizenshipCountryCodes.map((code) => (
          <MobileNavRow
            key={code}
            icon={icon}
            title={relocationCountryName(code)}
            sub="гражданство, со слов кандидата"
            ariaLabel={`Изменить: Гражданство: ${relocationCountryName(code)}`}
            onClick={open}
          />
        ))
      ) : (
        <MobileNavRow
          icon={icon}
          title="Гражданство не указано"
          sub="от него зависят правила въезда"
          onClick={open}
        />
      )}
      {documents.map((document) => {
        const alert = alerts.find(
          (item) => 'documentId' in item && item.documentId === document.id,
        );
        return (
          <MobileNavRow
            key={document.id}
            icon={icon}
            title={`${optionLabel(DOCUMENT_KIND_OPTIONS, document.kind)}, ${relocationCountryName(document.countryCode)}`}
            sub={documentSub(document.expiresAt, alert)}
            onClick={open}
          />
        );
      })}
    </MobileGroup>
  );
}

function EducationGroup({ profile, onEditStep }: RelocationMobileDataProps) {
  const { education, certificates } = profile.education;
  const open = () => onEditStep('education');
  const icon = <GraduationCap aria-hidden="true" />;
  return (
    <MobileGroup caption="Образование и сертификаты">
      {education.map((entry) => (
        <MobileNavRow
          key={entry.id}
          icon={icon}
          title={entry.title}
          sub={[
            optionLabel(EDUCATION_LEVEL_OPTIONS, entry.level).toLocaleLowerCase('ru'),
            [entry.startedAt?.slice(0, 4), entry.completedAt?.slice(0, 4)]
              .filter(Boolean)
              .join(' — '),
            relocationCountryName(entry.countryCode),
            `признание за рубежом: ${relocationRecognitionLabel(entry.recognitionStatus)}`,
          ]
            .filter(Boolean)
            .join(', ')}
          onClick={open}
        />
      ))}
      {certificates.map((item) => (
        <MobileNavRow
          key={item.id}
          icon={icon}
          title={item.title}
          sub={relocationRecognitionLabel(item.recognitionStatus)}
          onClick={open}
        />
      ))}
      {education.length + certificates.length === 0 ? (
        <MobileNavRow
          icon={icon}
          title="Не указано"
          sub="диплом влияет на визы под оффер"
          onClick={open}
        />
      ) : null}
    </MobileGroup>
  );
}

function FamilyAndLanguages({ profile, onEditStep }: RelocationMobileDataProps) {
  const { family } = profile;
  const languages = profile.languages.languages;
  return (
    <>
      <MobileGroup caption="Семья и сроки">
        <MobileNavRow
          icon={<UsersThree aria-hidden="true" />}
          title={PARTNER[family.partnerStatus] ?? family.partnerStatus}
          sub={TIMEFRAME[family.relocationTimeframe] ?? ''}
          onClick={() => onEditStep('family')}
        />
      </MobileGroup>
      <MobileGroup caption="Языки" note="Видите только вы. Изменение пересчитывает статусы стран.">
        <MobileNavRow
          icon={<Translate aria-hidden="true" />}
          title={
            languages.length
              ? languages
                  .map(
                    ({ name, level }) => `${name} — ${optionLabel(LANGUAGE_LEVEL_OPTIONS, level)}`,
                  )
                  .join(', ')
              : 'Языки не указаны'
          }
          sub={
            languages.length
              ? [...new Set(languages.map(({ sourceLabel }) => sourceLabel).filter(Boolean))].join(
                  ', ',
                ) || undefined
              : undefined
          }
          onClick={() => onEditStep('languages')}
        />
      </MobileGroup>
    </>
  );
}

function RevokeAction({ onConsentRevoked }: Pick<RelocationMobileDataProps, 'onConsentRevoked'>) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const revoke = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onConsentRevoked((await revokeRelocationConsent()).consent);
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось отозвать согласие. Повторите запрос.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error ? (
        <p className="career-relocation-error" role="alert">
          {error}
        </p>
      ) : null}
      {confirm ? (
        <InlineConfirmation
          title="Отозвать согласие?"
          description="Данные анкеты будут удалены, релокация выключится."
          cancel="Оставить"
          confirm="Отозвать согласие и удалить данные"
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void revoke()}
        />
      ) : (
        <button
          className="vacancy-push-text career-relocation-remove"
          type="button"
          onClick={() => setConfirm(true)}
        >
          Отозвать согласие и удалить данные
        </button>
      )}
    </>
  );
}

/** Mockup 15 `vt=d` at 390: consent line, grouped rows per questionnaire step; a row opens its step. */
export function RelocationMobileData(props: RelocationMobileDataProps) {
  return (
    <div className="career-relocation-mobile-section">
      <p className="career-relocation-mobile-consent">
        <LockKey aria-hidden="true" size={16} />
        <span>
          Согласие на обработку данных о мобильности дано{' '}
          {props.consent.grantedAt ? mobileDate(props.consent.grantedAt) : ''}. Отзыв удаляет данные
          анкеты.
        </span>
      </p>
      <CitizenshipGroup {...props} />
      <EducationGroup {...props} />
      <FamilyAndLanguages {...props} />
      <RevokeAction onConsentRevoked={props.onConsentRevoked} />
    </div>
  );
}
