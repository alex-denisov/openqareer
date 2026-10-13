import { useState } from 'react';
import type { CandidateAutomationConsentKey, CandidateAutomationMode } from '../../../server/candidate/sqliteCandidateAutomationRepository';
import type { AutomationQueuePreview } from './automationApi';
import {
  createConsentHandlers,
  createJournalHandlers,
  createQueueHandlers,
  createSettingsHandlers,
  type AutomationHandlerContext,
} from './automationHandlers';
import type { AutomationSubpage } from './automationScreenTypes';
import type { useAutomationData } from './useAutomationData';

export function useAutomationController(data: ReturnType<typeof useAutomationData>) {
  const [tab, setTab] = useState<'auto' | 'posts' | 'journal'>('auto');
  const [subpage, setSubpage] = useState<AutomationSubpage>('home');
  const [busy, setBusy] = useState(false);
  const [queueRefreshing, setQueueRefreshing] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [operationError, setOperationError] = useState('');
  const [consentFlow, setConsentFlow] = useState<'enable' | 'manage' | null>(null);
  const [consentMode, setConsentMode] = useState<CandidateAutomationMode>('approval_required');
  const [consentError, setConsentError] = useState('');
  const [consentBusyKey, setConsentBusyKey] = useState<CandidateAutomationConsentKey | ''>('');
  const [letter, setLetter] = useState<AutomationQueuePreview | null>(null);
  const [letterText, setLetterText] = useState('');
  const [letterBusy, setLetterBusy] = useState(false);
  const context: AutomationHandlerContext = {
    data,
    setNotice,
    setOperationError,
    setBusy,
    setQueueRefreshing,
    setScheduleBusy,
    setRulesBusy,
    setExportBusy,
    setConsentFlow,
    setConsentMode,
    setConsentError,
    setConsentBusyKey,
    setLetter,
    setLetterText,
    setLetterBusy,
  };
  return {
    tab, setTab, subpage, setSubpage, busy, queueRefreshing, scheduleBusy, rulesBusy, exportBusy,
    notice, operationError, consentFlow, consentMode, consentError, consentBusyKey, setConsentFlow, letter, setLetter, letterText, setLetterText, letterBusy,
    consent: createConsentHandlers(context),
    queueActions: createQueueHandlers(context),
    settingsActions: createSettingsHandlers(context),
    journalActions: createJournalHandlers(context),
    setOperationError,
  };
}
