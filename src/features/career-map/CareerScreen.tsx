import { useState, type ReactElement } from 'react';
import type { CareerPushView, CareerRoleModel, SearchConditionsDraft } from './careerScreenTypes';
import {
  CareerConditionsCard,
  CareerInlineFormatEditor,
  CareerInlineGeoEditor,
  CareerInlineSalaryEditor,
  CareerInlineStopListEditor,
  type EditableConditionField,
} from './CareerConditionsComponents';
import { CareerRoleCard } from './CareerRoleComponents';
import {
  CareerEmptyProfileState,
  CareerLoadingSkeleton,
  CareerMarketErrorState,
  CareerStaleMarketNote,
} from './CareerStateComponents';
import { MobileConditionSalaryView, MobileRoleDetailView } from './CareerMobileComponents';
import { applyConditionsEdit } from './careerConditionsStorage';
import { useCareerScreenState } from './useCareerScreenState';
import { RelocationScreen } from '../relocation/RelocationScreen';

export interface CareerScreenProps {
  readonly initialRoles?: readonly CareerRoleModel[];
  readonly initialConditions?: SearchConditionsDraft;
  readonly hasProfile?: boolean;
  readonly marketError?: string | null;
  readonly isLoading?: boolean;
  readonly isMarketStale?: boolean;
  readonly onNavigate?: (view: string, params?: unknown) => void;
  readonly onOpenExpert?: () => void;
  readonly onOpenVacancies?: (roleTitle?: string) => void;
  readonly onCheckSkills?: (roleId?: string) => void;
  readonly onOpenProfile?: () => void;
  readonly onSaveConditions?: (conditions: SearchConditionsDraft) => Promise<void>;
  readonly isMobile?: boolean;
  readonly initialPushView?: CareerPushView;
}

function RolesCardsList({
  roles,
  onConsultant,
  onOpenVacancies,
  onCheckSkills,
  onRejectRole,
  onNavigateSection,
}: {
  roles: readonly CareerRoleModel[];
  onConsultant: () => void;
  onOpenVacancies: (t: string) => void;
  onCheckSkills: (id: string) => void;
  onRejectRole: (id: string) => void;
  onNavigateSection: (s: string) => void;
}): ReactElement {
  return (
    <div className="career-roles-list">
      {roles.map((role, index) => (
        <CareerRoleCard
          key={role.id}
          role={role}
          isOpenDefault={role.id === 'dir' || index === 0}
          onConsultant={onConsultant}
          onOpenVacancies={onOpenVacancies}
          onCheckSkills={onCheckSkills}
          onRejectRole={onRejectRole}
          onNavigateSection={onNavigateSection}
        />
      ))}
    </div>
  );
}

function CareerRolesHeader({ count }: { count: number }): ReactElement {
  return (
    <>
      <div className="career-card-head">
        <div className="career-card-title-group">
          <h2 id="roles-heading">Мои роли на рынке</h2>
          <span className="career-badge career-badge-ok">{count}</span>
        </div>
      </div>
      <p className="career-role-meta">
        Гипотеза — вывод консультанта из профиля и рынка, не факт. Вилка — только по вакансиям с
        указанной зарплатой.
      </p>
    </>
  );
}

function CareerRolesSection({
  roles,
  showAllRoles,
  onShowAll,
  onConsultant,
  onOpenVacancies,
  onCheckSkills,
  onRejectRole,
  onNavigateSection,
}: {
  roles: readonly CareerRoleModel[];
  showAllRoles: boolean;
  onShowAll: () => void;
  onConsultant: () => void;
  onOpenVacancies: (t: string) => void;
  onCheckSkills: (id: string) => void;
  onRejectRole: (id: string) => void;
  onNavigateSection: (s: string) => void;
}): ReactElement {
  const displayedRoles = showAllRoles ? roles : roles.slice(0, 5);

  return (
    <section className="career-card" aria-labelledby="roles-heading">
      <CareerRolesHeader count={roles.length} />
      <RolesCardsList
        roles={displayedRoles}
        onConsultant={onConsultant}
        onOpenVacancies={onOpenVacancies}
        onCheckSkills={onCheckSkills}
        onRejectRole={onRejectRole}
        onNavigateSection={onNavigateSection}
      />
      {roles.length > 5 && !showAllRoles ? (
        <button type="button" className="career-btn career-btn-ghost" onClick={onShowAll}>
          Показать остальные
        </button>
      ) : null}
      <p className="career-source-stamp">
        Источник: каталог openqareer, hh.ru и LinkedIn · 312 вакансий · 05.10
      </p>
    </section>
  );
}

function MobilePushRouter({
  pushView,
  roles,
  conditions,
  onBack,
  onConsultant,
  onOpenVacancies,
  onCheckSkills,
  onRejectRole,
  onSaveSalary,
}: {
  pushView: CareerPushView;
  roles: readonly CareerRoleModel[];
  conditions: SearchConditionsDraft;
  onBack: () => void;
  onConsultant: () => void;
  onOpenVacancies: (t: string) => void;
  onCheckSkills: (id: string) => void;
  onRejectRole: (id: string) => void;
  onSaveSalary: (salary: number, showNoWage: boolean) => void;
}): ReactElement | null {
  const selectedRole = roles.find((r) => r.id === pushView);
  if (selectedRole) {
    return (
      <MobileRoleDetailView
        role={selectedRole}
        onBack={onBack}
        onConsultant={onConsultant}
        onOpenVacancies={onOpenVacancies}
        onCheckSkills={onCheckSkills}
        onRejectRole={onRejectRole}
      />
    );
  }
  if (pushView === 'sal') {
    return (
      <MobileConditionSalaryView conditions={conditions} onBack={onBack} onSave={onSaveSalary} />
    );
  }
  return null;
}

function CareerHeader({
  marketError,
  isMarketStale,
  onClearError,
}: {
  marketError?: string | null;
  isMarketStale?: boolean;
  onClearError: () => void;
}): ReactElement {
  return (
    <>
      <header className="career-header">
        <h1>Карьера</h1>
        <p className="career-header-lead">
          Позиция на рынке только с источником, n и датой; гипотезы ролей; условия поиска; трек.
        </p>
      </header>
      {marketError ? <CareerMarketErrorState onRetry={onClearError} /> : null}
      {isMarketStale ? <CareerStaleMarketNote dateText="05.10" /> : null}
    </>
  );
}

function renderSalaryOrFormatEditor(
  field: 'sal' | 'fmt',
  conditions: SearchConditionsDraft,
  saveError: string | null,
  onSaveSalary: (sal: number, noWage: boolean) => void,
  onSaveFormat: (format: SearchConditionsDraft['format']) => void,
  onCloseField: () => void,
): ReactElement {
  if (field === 'sal') {
    return (
      <CareerInlineSalaryEditor
        initialSalary={conditions.salaryFrom.amountRubles}
        initialShowWithoutSalary={conditions.salaryFrom.showWithoutSalary}
        onSave={onSaveSalary}
        onCancel={onCloseField}
        errorMessage={saveError}
      />
    );
  }
  return (
    <CareerInlineFormatEditor
      initialFormat={conditions.format}
      onSave={onSaveFormat}
      onCancel={onCloseField}
      errorMessage={saveError}
    />
  );
}

function CareerConditionsEditorRow({
  editingField,
  conditions,
  saveError,
  onSaveSalary,
  onSaveFormat,
  onSaveGeo,
  onCloseField,
  onAddCompany,
}: {
  editingField: EditableConditionField;
  conditions: SearchConditionsDraft;
  saveError: string | null;
  onSaveSalary: (sal: number, noWage: boolean) => void;
  onSaveFormat: (format: SearchConditionsDraft['format']) => void;
  onSaveGeo: (selected: readonly string[]) => void;
  onCloseField: () => void;
  onAddCompany: (name: string) => void;
}): ReactElement | null {
  if (editingField === 'sal' || editingField === 'fmt') {
    return renderSalaryOrFormatEditor(
      editingField,
      conditions,
      saveError,
      onSaveSalary,
      onSaveFormat,
      onCloseField,
    );
  }
  if (editingField === 'geo') {
    return (
      <CareerInlineGeoEditor
        initialSelected={conditions.geography.selected}
        onSave={onSaveGeo}
        onCancel={onCloseField}
        errorMessage={saveError}
      />
    );
  }
  if (editingField === 'stop') {
    return (
      <CareerInlineStopListEditor
        stopList={conditions.stopList}
        onAddCompany={onAddCompany}
        onClose={onCloseField}
      />
    );
  }
  return null;
}

interface CareerMainContentProps {
  readonly state: ReturnType<typeof useCareerScreenState>;
  readonly marketError: string | null;
  readonly isMarketStale: boolean;
  readonly onNavigate?: (view: string, params?: unknown) => void;
  readonly onOpenExpert?: () => void;
  readonly onOpenVacancies?: (roleTitle?: string) => void;
  readonly onCheckSkills?: (roleId?: string) => void;
  readonly onOpenRelocation: () => void;
}

function CareerMainConditionsBlock({
  state,
  onOpenRelocation,
}: {
  state: ReturnType<typeof useCareerScreenState>;
  onOpenRelocation: () => void;
}): ReactElement {
  return (
    <>
      <CareerConditionsCard
        conditions={state.conditions}
        onEditField={(f) => (state.isMobile && f ? state.setPushView(f) : state.setEditingField(f))}
        onEnableRelocation={() => {
          state.setConditions((prev) =>
            applyConditionsEdit(prev, {
              geography: { ...prev.geography, isRelocationEnabled: true },
            }),
          );
          onOpenRelocation();
        }}
        onOpenRelocation={onOpenRelocation}
      />
      <CareerConditionsEditorRow
        editingField={state.editingField}
        conditions={state.conditions}
        saveError={state.saveError}
        onSaveSalary={(sal, noWage) => void state.handleSaveSalary(sal, noWage)}
        onSaveFormat={(fmt) => void state.handleSaveFormat(fmt)}
        onSaveGeo={(geo) => void state.handleSaveGeo(geo)}
        onCloseField={() => {
          state.setEditingField(null);
          state.setSaveError(null);
        }}
        onAddCompany={(name) => void state.handleAddStopCompany(name)}
      />
    </>
  );
}

function CareerScreenContent({
  props,
  state,
  onOpenRelocation,
}: {
  props: CareerScreenProps;
  state: ReturnType<typeof useCareerScreenState>;
  onOpenRelocation: () => void;
}): ReactElement {
  if (state.isMobile && state.pushView !== 'home') {
    return (
      <MobilePushRouter
        pushView={state.pushView}
        roles={state.activeRoles}
        conditions={state.conditions}
        onBack={() => state.setPushView('home')}
        onConsultant={() => props.onOpenExpert?.()}
        onOpenVacancies={(t) => props.onOpenVacancies?.(t)}
        onCheckSkills={(id) => props.onCheckSkills?.(id)}
        onRejectRole={state.handleRejectRole}
        onSaveSalary={(sal, noWage) => void state.handleSaveSalary(sal, noWage)}
      /> as ReactElement
    );
  }
  return (
    <CareerMainContent
      state={state}
      marketError={state.marketError}
      isMarketStale={props.isMarketStale ?? false}
      onNavigate={props.onNavigate}
      onOpenExpert={props.onOpenExpert}
      onOpenVacancies={props.onOpenVacancies}
      onCheckSkills={props.onCheckSkills}
      onOpenRelocation={onOpenRelocation}
    />
  );
}

function CareerMainContent({
  state,
  marketError,
  isMarketStale,
  onNavigate,
  onOpenExpert,
  onOpenVacancies,
  onCheckSkills,
  onOpenRelocation,
}: CareerMainContentProps): ReactElement {
  return (
    <div className="career-screen" data-testid="career-screen">
      <CareerHeader
        marketError={marketError}
        isMarketStale={isMarketStale}
        onClearError={() => state.setSaveError(null)}
      />
      <CareerMainConditionsBlock state={state} onOpenRelocation={onOpenRelocation} />
      <CareerRolesSection
        roles={state.activeRoles}
        showAllRoles={state.showAllRoles}
        onShowAll={() => state.setShowAllRoles(true)}
        onConsultant={() => onOpenExpert?.()}
        onOpenVacancies={(t) => onOpenVacancies?.(t)}
        onCheckSkills={(id) => onCheckSkills?.(id)}
        onRejectRole={state.handleRejectRole}
        onNavigateSection={(sec) => onNavigate?.(sec)}
      />
    </div>
  );
}

export function CareerScreen(props: CareerScreenProps): ReactElement {
  const { hasProfile = true, onOpenExpert, onOpenVacancies, onOpenProfile } = props;
  const state = useCareerScreenState(props);
  const [relocationOpen, setRelocationOpen] = useState(false);

  if (state.isLoading) return <CareerLoadingSkeleton />;
  if (!hasProfile) {
    return (
      <div className="career-screen">
        <CareerEmptyProfileState onOpenProfile={onOpenProfile} onOpenExpert={onOpenExpert} />
      </div>
    );
  }
  if (relocationOpen) {
    return (
      <RelocationScreen
        onNavigateBack={() => setRelocationOpen(false)}
        onOpenExpert={onOpenExpert}
        onOpenVacancies={onOpenVacancies ? () => onOpenVacancies() : undefined}
      />
    );
  }
  return (
    <CareerScreenContent
      props={props}
      state={state}
      onOpenRelocation={() => setRelocationOpen(true)}
    />
  );
}
