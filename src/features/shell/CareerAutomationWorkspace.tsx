import { CandidateActionPanel } from '../applications/CandidateActionPanel';
import { useApplications } from '../applications/useApplications';
import { CandidateAutomationScreen } from '../automation/CandidateAutomationScreen';

export interface CareerAutomationWorkspaceProps {
  readonly candidateId: string;
  readonly onOpenConsultant: () => void;
  readonly onOpenConnections: () => void;
  readonly onOpenTariffs: () => void;
}

export function CareerAutomationWorkspace(props: CareerAutomationWorkspaceProps) {
  const applications = useApplications();
  return (
    <>
      <CandidateAutomationScreen
        candidateId={props.candidateId}
        onOpenConsultant={props.onOpenConsultant}
        onOpenConnections={props.onOpenConnections}
        onOpenTariffs={props.onOpenTariffs}
      />
      <CandidateActionPanel
        applications={applications.applications}
        onRefreshApplications={applications.refreshApplications}
      />
    </>
  );
}
