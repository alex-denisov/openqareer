import { lazy, Suspense, useState, type ReactElement } from 'react';
import { Info, WarningCircle } from '@phosphor-icons/react';
import type { CareerPushView, CareerRoleModel, SearchConditionsDraft } from './careerScreenTypes';
import {
  CareerConditionsCard,
  CareerInlineFormatEditor,
  CareerInlineGeoEditor,
  CareerInlineSalaryEditor,
  CareerInlineStopListEditor,
  MarketSourceStamp,
  SectionInfoToggle,
  type EditableConditionField,
} from './CareerConditionsComponents';
import { CareerRoleCard, type RoleHandlers } from './CareerRoleComponents';
import {
  CareerEmptyProfileState,
  CareerLoadingSkeleton,
  CareerMarketErrorState,
  CareerStaleMarketNote,
} from './CareerStateComponents';
import { MobileCareerHome, MobileConditionPush, MobileRolePush } from './CareerMobileComponents';
import { useCareerScreenState, type CareerScreenState } from './useCareerScreenState';
import { loadCareerRoles } from './careerRoleStore';

// Lazy: the screen pulls CSS, which the CLI mockup renderer (tsx) cannot load, and opens only on demand.
const RelocationScreen = lazy(() =>
  import('../relocation/RelocationScreen').then((m) => ({ default: m.RelocationScreen })),
);

export interface CareerScreenProps {
  readonly initialRoles?: readonly CareerRoleModel[];
  readonly initialConditions?: SearchConditionsDraft;
  readonly hasProfile?: boolean;
  readonly marketError?: string | null;
  readonly isLoading?: boolean;
  readonly isMarketStale?: boolean;
  readonly onNavigate?: (view: string) => void;
  /** Консультант с контекстом роли: подпись роли и первый вопрос. */
  readonly onOpenExpert?: (roleTitle?: string, prompt?: string) => void;
  readonly onOpenVacancies?: (roleTitle?: string) => void;
  readonly onCheckSkills?: (roleTitle?: string) => void;
  readonly onOpenProfile?: () => void;
  readonly onSaveConditions?: (conditions: SearchConditionsDraft) => Promise<void>;
  readonly isMobile?: boolean;
  readonly initialPushView?: CareerPushView;
  /** Роль, к которой вернуться после проверки навыков: раскрыта на 1440, открыта на 390. */
  readonly focusRoleTitle?: string;
}

const ROLES_EXPLAIN =
  'Гипотеза — вывод консультанта из профиля и рынка, не факт. Вилка считается только по вакансиям с указанной зарплатой, с числом вакансий и датой среза.';

const FIELD_TITLES: Readonly<Record<Exclude<EditableConditionField, null>, string>> = {
  geo: 'География',
  sal: 'Зарплата от',
  fmt: 'Формат',
  stop: 'Стоп-лист',
};

function roleHandlers(props: CareerScreenProps, state: CareerScreenState): RoleHandlers {
  return {
    onConsultant: (role) =>
      props.onOpenExpert?.(
        role.title,
        role.status === 'hypothesis'
          ? `Роль «${role.title}»: насколько она мне подходит и что проверить первым?`
          : `Роль «${role.title}»: что дозаполнить в профиле, чтобы закрыть пробелы?`,
      ),
    onOpenVacancies: (role) => props.onOpenVacancies?.(role.title),
    onCheckSkills: (role) => props.onCheckSkills?.(role.title),
    onRejectRole: (roleId) => state.handleRejectRole(roleId),
    onNavigateSection: () => props.onOpenProfile?.(),
  };
}

function editorCallbacks(state: CareerScreenState) {
  return {
    close: () => {
      if (state.isMobile) state.setPushView('home');
      state.setEditingField(null);
      state.setSaveError(null);
    },
    done: (save: Promise<boolean>) =>
      void save.then((ok) => ok && state.isMobile && state.setPushView('home')),
  };
}

function ConditionEditor({
  field,
  state,
}: {
  field: EditableConditionField;
  state: CareerScreenState;
}): ReactElement | null {
  const { conditions, saveError } = state;
  const { close, done } = editorCallbacks(state);
  switch (field) {
    case 'sal':
      return (
        <CareerInlineSalaryEditor
          initialSalary={conditions.salaryFrom.amountRubles}
          initialShowWithoutSalary={conditions.salaryFrom.showWithoutSalary}
          onSave={(sal, noWage) => done(state.handleSaveSalary(sal, noWage))}
          onCancel={close}
          errorMessage={saveError}
        />
      );
    case 'fmt':
      return (
        <CareerInlineFormatEditor
          initialFormat={conditions.format}
          onSave={(fmt) => done(state.handleSaveFormat(fmt))}
          onCancel={close}
          errorMessage={saveError}
        />
      );
    case 'geo':
      return (
        <CareerInlineGeoEditor
          initialSelected={conditions.geography.selected}
          onSave={(geo) => done(state.handleSaveGeo(geo))}
          onCancel={close}
          errorMessage={saveError}
        />
      );
    case 'stop':
      return (
        <CareerInlineStopListEditor
          stopList={conditions.stopList}
          onAddCompany={(name) => void state.handleAddStopCompany(name)}
          onClose={close}
        />
      );
    default:
      return null;
  }
}

function CareerRolesSection({
  state,
  handlers,
}: {
  state: CareerScreenState;
  handlers: RoleHandlers;
}): ReactElement {
  const roles = state.activeRoles;
  const firstOpen =
    roles.find((role) => role.title === state.focusRoleTitle) ??
    roles.find((role) => role.status === 'skills_checked') ??
    roles[0];
  return (
    <section className="career-card" aria-labelledby="roles-heading">
      <div className="career-card-head">
        <h2 id="roles-heading">Мои роли на рынке</h2>
        <span className="career-count-box" aria-label={`Ролей: ${roles.length}`}>
          {roles.length}
        </span>
        <SectionInfoToggle id="roles-explain" text={ROLES_EXPLAIN} />
      </div>
      <p className="career-plate">
        <Info size={18} aria-hidden />
        <span>
          Поиск по ролям открывается после проверки навыков: так подборка опирается на
          подтверждённое, а не на догадки. Пока его нет, доступен свободный просмотр всех вакансий
          каталога.
        </span>
      </p>
      {roles.length === 0 ? (
        <p className="career-role-meta">
          Ролей пока нет. Консультант назовёт их, когда в профиле будет опыт.
        </p>
      ) : (
        <div className="career-role-cards">
          {roles.map((role) => (
            <CareerRoleCard
              key={role.id}
              role={role}
              isOpenDefault={role.id === firstOpen?.id}
              handlers={handlers}
            />
          ))}
        </div>
      )}
      <MarketSourceStamp summary={state.summary} />
    </section>
  );
}

function ActionErrorNote({ message }: { message: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <p className="career-note career-note-error" role="alert">
      <WarningCircle size={16} aria-hidden />
      <span>{message}</span>
    </p>
  );
}

function CareerMobileContent({
  state,
  handlers,
  onOpenRelocation,
}: {
  state: CareerScreenState;
  handlers: RoleHandlers;
  onOpenRelocation: () => void;
}): ReactElement {
  const view = state.pushView;
  const back = () => state.setPushView('home');
  if (view.startsWith('role:')) {
    const role = state.activeRoles.find((item) => `role:${item.id}` === view);
    if (role) return <MobileRolePush role={role} onBack={back} handlers={handlers} />;
  } else if (view !== 'home') {
    const field = view as Exclude<EditableConditionField, null>;
    return (
      <MobileConditionPush title={FIELD_TITLES[field]} field={field} onBack={back}>
        <ConditionEditor field={field} state={state} />
      </MobileConditionPush>
    );
  }
  return (
    <>
      <ActionErrorNote message={state.actionError} />
      <MobileCareerHome
        roles={state.activeRoles}
        conditions={state.conditions}
        summary={state.summary}
        onPush={state.setPushView}
        onOpenRelocation={onOpenRelocation}
        relocationEnabled={state.relocationEnabled}
      />
    </>
  );
}

function CareerDesktopContent({
  props,
  state,
  handlers,
  onOpenRelocation,
}: {
  props: CareerScreenProps;
  state: CareerScreenState;
  handlers: RoleHandlers;
  onOpenRelocation: () => void;
}): ReactElement {
  return (
    <div className="career-screen" data-testid="career-screen">
      <header className="career-header">
        <h1>Карьера</h1>
      </header>
      {state.marketError ? (
        <CareerMarketErrorState onRetry={() => void loadCareerRoles(true)} />
      ) : null}
      {props.isMarketStale && state.summary.asOf ? (
        <CareerStaleMarketNote dateText={state.summary.asOf} />
      ) : null}
      <ActionErrorNote message={state.actionError} />
      <CareerConditionsCard
        conditions={state.conditions}
        summary={state.summary}
        onEditField={state.setEditingField}
        onOpenRelocation={onOpenRelocation}
        relocationEnabled={state.relocationEnabled}
        editor={<ConditionEditor field={state.editingField} state={state} />}
      />
      <CareerRolesSection state={state} handlers={handlers} />
    </div>
  );
}

export function CareerScreen(props: CareerScreenProps): ReactElement {
  const { hasProfile = true, onOpenExpert, onOpenVacancies, onOpenProfile } = props;
  const state = useCareerScreenState(props);
  const [relocationOpen, setRelocationOpen] = useState(false);
  const handlers = roleHandlers(props, state);
  const openRelocation = () => setRelocationOpen(true);

  if (state.isLoading) return <CareerLoadingSkeleton />;
  if (!hasProfile) {
    return (
      <div className="career-screen">
        <CareerEmptyProfileState
          onOpenProfile={onOpenProfile}
          onOpenExpert={onOpenExpert ? () => onOpenExpert() : undefined}
        />
      </div>
    );
  }
  if (relocationOpen) {
    return (
      <Suspense fallback={<CareerLoadingSkeleton />}>
        <RelocationScreen
          onNavigateBack={() => {
            setRelocationOpen(false);
            state.refreshRelocation();
          }}
          onOpenExpert={onOpenExpert ? () => onOpenExpert() : undefined}
          onOpenVacancies={onOpenVacancies ? () => onOpenVacancies() : undefined}
        />
      </Suspense>
    );
  }
  return state.isMobile ? (
    <CareerMobileContent state={state} handlers={handlers} onOpenRelocation={openRelocation} />
  ) : (
    <CareerDesktopContent
      props={props}
      state={state}
      handlers={handlers}
      onOpenRelocation={openRelocation}
    />
  );
}
