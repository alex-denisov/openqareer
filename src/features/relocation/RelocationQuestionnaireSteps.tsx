import type { RelocationQuestionnaire, RelocationStepId } from '../../../shared/relocationQuestionnaire';
import { CitizenshipDocumentsForm } from './steps/CitizenshipDocumentsForm';
import { EducationForm } from './steps/EducationForm';
import { FamilyForm } from './steps/FamilyForm';
import { LanguagesForm } from './steps/LanguagesForm';

export interface RelocationQuestionnaireStepFormProps {
  readonly step: RelocationStepId;
  readonly profile: RelocationQuestionnaire;
  readonly onProfileChange: (profile: RelocationQuestionnaire) => void;
  readonly onImportLinkedIn: () => void;
  readonly importBusy: boolean;
  readonly importError?: string;
  /** 390 layout: sub-forms open as push screens. */
  readonly mobile?: boolean;
}

export function RelocationQuestionnaireStepForm(props: RelocationQuestionnaireStepFormProps) {
  if (props.step === 'citizenship_documents') return <CitizenshipDocumentsForm {...props} />;
  if (props.step === 'education') return <EducationForm {...props} />;
  if (props.step === 'family') return <FamilyForm {...props} />;
  return <LanguagesForm {...props} />;
}
