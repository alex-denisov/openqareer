import { useState } from 'react';
import {
  Certificate,
  Fingerprint,
  GraduationCap,
  LinkedinLogo,
  Translate,
} from '@phosphor-icons/react';
import type {
  FamilyStep,
  RelocationQuestionnaire,
  RelocationStepId,
} from '../../../../shared/relocationQuestionnaire';
import {
  DOCUMENT_KIND_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  LANGUAGE_LEVEL_OPTIONS,
  relocationCountryName,
  relocationRecognitionLabel,
} from '../RelocationFormControls';
import {
  MobileAddRow,
  MobileGroup,
  MobileInputRow,
  MobileNavRow,
  MobilePickerRow,
  MobileRadioRows,
  MobileToggleRow,
} from './MobileRows';

type Profile = RelocationQuestionnaire;

export type MobileSubScreen =
  | { readonly kind: 'citizenship'; readonly index: 0 | 1 }
  | {
      readonly kind: 'document' | 'education' | 'certificate' | 'language';
      readonly rowId?: string;
    };

export interface MobileStepProps {
  readonly step: RelocationStepId;
  readonly profile: Profile;
  readonly onProfileChange: (profile: Profile) => void;
  readonly onOpen: (screen: MobileSubScreen) => void;
  readonly onImportLinkedIn: () => void;
  readonly importBusy: boolean;
}

const PARTNER_OPTIONS: readonly (readonly [FamilyStep['partnerStatus'], string])[] = [
  ['no_partner', 'Один'],
  ['has_partner', 'С партнёром'],
  ['undecided', 'Не решил'],
  ['unknown', 'Не указано'],
];

const TIMEFRAME_OPTIONS: readonly (readonly [FamilyStep['relocationTimeframe'], string])[] = [
  ['under_three_months', 'Не больше трёх месяцев'],
  ['three_to_six_months', 'От трёх до шести месяцев'],
  ['six_to_twelve_months', 'От шести до двенадцати месяцев'],
  ['over_twelve_months', 'Дольше, если надёжно'],
  ['unknown', 'Не указано'],
];

const FAMILY_PLAN_OPTIONS: readonly (readonly [FamilyStep['familyMovePlan'], string])[] = [
  ['together', 'Вместе'],
  ['later', 'Позже'],
  ['not_applicable', 'Не относится'],
  ['undecided', 'Не решил'],
];

const SOURCE_LABELS: Readonly<Record<Profile['languages']['languages'][number]['source'], string>> =
  {
    candidate: 'со слов кандидата',
    linkedin: 'из LinkedIn',
    certificate: 'из сертификата',
  };

/** «2027-03-14» → «14.03.2027». */
export function mobileDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function label<T extends string>(options: readonly (readonly [T, string])[], value: T): string {
  return options.find(([code]) => code === value)?.[1] ?? value;
}

export function MobileStepBody(props: MobileStepProps) {
  if (props.step === 'citizenship_documents') return <CitizenshipStep {...props} />;
  if (props.step === 'education') return <EducationStep {...props} />;
  if (props.step === 'family') return <FamilyStepBody {...props} />;
  return <LanguagesStep {...props} />;
}

function DocumentsGroup({
  documents,
  onOpen,
}: {
  readonly documents: Profile['citizenshipDocuments']['documents'];
  readonly onOpen: MobileStepProps['onOpen'];
}) {
  return (
    <MobileGroup
      caption="Вид на жительство, ПМЖ, визы"
      note="Документы определяют, где вы уже можете жить и работать без новой визы."
    >
      {documents.map((document) => {
        const title = `${label(DOCUMENT_KIND_OPTIONS, document.kind)}, ${relocationCountryName(document.countryCode)}`;
        return (
          <MobileNavRow
            key={document.id}
            icon={<Fingerprint aria-hidden="true" />}
            title={title}
            sub={document.expiresAt ? `до ${mobileDate(document.expiresAt)}` : 'срок не указан'}
            onClick={() => onOpen({ kind: 'document', rowId: document.id })}
          />
        );
      })}
      <MobileAddRow title="Добавить документ" onClick={() => onOpen({ kind: 'document' })} />
    </MobileGroup>
  );
}

/** Mockup 15 `mv=i1`: citizenship row, second-citizenship switch, documents group. */
function CitizenshipStep({ profile, onProfileChange, onOpen }: MobileStepProps) {
  const { citizenshipCountryCodes: countries, documents } = profile.citizenshipDocuments;
  const [second, setSecond] = useState(countries.length > 1);
  const toggleSecond = (checked: boolean) => {
    setSecond(checked);
    if (!checked) {
      onProfileChange({
        ...profile,
        citizenshipDocuments: {
          ...profile.citizenshipDocuments,
          citizenshipCountryCodes: countries.slice(0, 1),
        },
      });
    }
  };
  const country = (code?: string) => (code ? relocationCountryName(code) : 'Выберите');
  return (
    <>
      <MobileGroup>
        <MobileNavRow
          id="relocation-citizenship-first"
          icon={<Fingerprint aria-hidden="true" />}
          title="Гражданство"
          value={country(countries[0])}
          onClick={() => onOpen({ kind: 'citizenship', index: 0 })}
        />
        <MobileToggleRow label="Есть второе гражданство" checked={second} onChange={toggleSecond} />
        {second ? (
          <MobileNavRow
            id="relocation-citizenship-second"
            icon={<Fingerprint aria-hidden="true" />}
            title="Второе гражданство"
            value={country(countries[1])}
            onClick={() => onOpen({ kind: 'citizenship', index: 1 })}
          />
        ) : null}
      </MobileGroup>
      <DocumentsGroup documents={documents} onOpen={onOpen} />
    </>
  );
}

function educationSub(entry: Profile['education']['education'][number]): string {
  const years = [entry.startedAt?.slice(0, 4), entry.completedAt?.slice(0, 4)]
    .filter(Boolean)
    .join(' — ');
  return [
    entry.fieldOfStudy,
    label(EDUCATION_LEVEL_OPTIONS, entry.level).toLocaleLowerCase('ru'),
    years,
    relocationCountryName(entry.countryCode),
  ]
    .filter(Boolean)
    .join(', ');
}

function CertificatesGroup({
  certificates,
  onOpen,
}: {
  readonly certificates: Profile['education']['certificates'];
  readonly onOpen: MobileStepProps['onOpen'];
}) {
  return (
    <MobileGroup caption="Ассессменты и сертификаты">
      {certificates.length ? (
        certificates.map((certificate) => (
          <MobileNavRow
            key={certificate.id}
            icon={<Certificate aria-hidden="true" />}
            title={certificate.title}
            sub={[
              certificate.issuer,
              relocationCountryName(certificate.countryCode),
              relocationRecognitionLabel(certificate.recognitionStatus),
            ]
              .filter(Boolean)
              .join(' · ')}
            onClick={() => onOpen({ kind: 'certificate', rowId: certificate.id })}
          />
        ))
      ) : (
        <div className="vacancy-push-row">
          <span className="vacancy-push-ico">
            <Certificate aria-hidden="true" />
          </span>
          <span className="vacancy-push-main">
            <b>В профиле нет</b>
            <small>добавьте вручную</small>
          </span>
        </div>
      )}
      <MobileAddRow title="Добавить сертификат" onClick={() => onOpen({ kind: 'certificate' })} />
    </MobileGroup>
  );
}

/** Mockup 15 `mv=i2`: diplomas and certificates as rows; each opens its own screen. */
function EducationStep({ profile, onOpen }: MobileStepProps) {
  const { education, certificates } = profile.education;
  const unknownRecognition = education.some(
    ({ recognitionStatus }) => recognitionStatus === 'unknown',
  );
  return (
    <>
      <MobileGroup
        caption="Образование"
        note={
          unknownRecognition
            ? 'Признание диплома за рубежом не указано. От него зависит порог зарплаты для виз под оффер.'
            : undefined
        }
      >
        {education.map((entry) => (
          <MobileNavRow
            key={entry.id}
            icon={<GraduationCap aria-hidden="true" />}
            title={entry.title}
            sub={educationSub(entry)}
            onClick={() => onOpen({ kind: 'education', rowId: entry.id })}
          />
        ))}
        <MobileAddRow title="Добавить образование" onClick={() => onOpen({ kind: 'education' })} />
      </MobileGroup>
      <CertificatesGroup certificates={certificates} onOpen={onOpen} />
    </>
  );
}

/** Mockup 15 `mv=i3`: radio groups for who moves and how long to wait. */
function FamilyStepBody({ profile, onProfileChange }: MobileStepProps) {
  const family = profile.family;
  const update = (change: Partial<FamilyStep>) =>
    onProfileChange({ ...profile, family: { ...family, ...change } });
  return (
    <>
      <MobileGroup caption="С кем планируете переезд">
        <MobileRadioRows
          name="relocation-partner"
          value={family.partnerStatus}
          options={PARTNER_OPTIONS}
          onChange={(partnerStatus) => update({ partnerStatus })}
        />
      </MobileGroup>
      <MobileGroup caption="Сколько готовы ждать оформление">
        <MobileRadioRows
          name="relocation-timeframe"
          value={family.relocationTimeframe}
          options={TIMEFRAME_OPTIONS}
          onChange={(relocationTimeframe) => update({ relocationTimeframe })}
        />
      </MobileGroup>
      <MobileGroup
        caption="Семья"
        note="Семья меняет сценарии: у одних виз партнёр может работать сразу, у других нет."
      >
        <MobilePickerRow
          id="relocation-family-plan"
          label="План переезда семьи"
          value={family.familyMovePlan}
          options={FAMILY_PLAN_OPTIONS}
          onChange={(familyMovePlan) => update({ familyMovePlan })}
        />
        <MobileInputRow
          id="relocation-children-count"
          label="Сколько детей переезжает"
          type="number"
          value={family.childrenCount === undefined ? '' : String(family.childrenCount)}
          onChange={(value) =>
            update({
              childrenCount:
                value === '' ? undefined : Math.min(10, Math.max(0, Math.trunc(Number(value)))),
            })
          }
        />
      </MobileGroup>
    </>
  );
}

/** Mockup 15 `mv=i4`: languages with level and source; import from the connected profile. */
function LanguagesStep({ profile, onOpen, onImportLinkedIn, importBusy }: MobileStepProps) {
  return (
    <MobileGroup
      caption="Языки"
      note="Язык работы определяет, хватит ли английского. Импортированные значения нужно подтвердить."
    >
      {profile.languages.languages.map((language) => (
        <MobileNavRow
          key={language.id}
          icon={<Translate aria-hidden="true" />}
          title={language.name}
          sub={[
            label(LANGUAGE_LEVEL_OPTIONS, language.level),
            language.sourceLabel ?? SOURCE_LABELS[language.source],
            language.confirmation === 'proposed' ? 'нужно подтвердить' : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          onClick={() => onOpen({ kind: 'language', rowId: language.id })}
        />
      ))}
      <MobileAddRow title="Добавить язык" onClick={() => onOpen({ kind: 'language' })} />
      <MobileNavRow
        icon={<LinkedinLogo aria-hidden="true" />}
        title={importBusy ? 'Импортируем…' : 'Импортировать из LinkedIn'}
        onClick={() => {
          if (!importBusy) onImportLinkedIn();
        }}
      />
    </MobileGroup>
  );
}
