import { usePublishConsultantSuggestion } from '../journey/consultantScreenSuggestion';
import { toSelectionItem } from './companyWantsModel';
import { wantTabSuggestion } from './responsesTabSuggestions';
import type { CompanyWantsController } from './useCompanyWants';

/** Макет 5 «Хочу»: вкладка публикует предложение консультанта из своего списка компаний. */
export function useWantTabSuggestion(controller: CompanyWantsController, openAdd: () => void) {
  usePublishConsultantSuggestion(
    wantTabSuggestion({
      page: controller.page,
      loading: controller.loading,
      error: controller.error,
      actions: {
        openAdd,
        findPath: (company) => controller.findPaths([toSelectionItem(company)]),
      },
    }),
  );
}
