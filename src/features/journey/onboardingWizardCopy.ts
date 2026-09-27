import type { OnboardingStepId } from './onboardingWizardSteps';

export function titleFor(step: OnboardingStepId): string {
  switch (step) {
    case 'source':
      return 'С чем разбираемся?';
    case 'progress':
      return 'Разбираем резюме';
    case 'talk':
      return 'Роль и регион';
    case 'review':
      return 'Проверьте профиль';
    case 'campaign':
      return 'Роли и регионы';
    case 'done':
      return 'Первая подборка готова';
  }
}

export function descriptionFor(step: OnboardingStepId): string {
  switch (step) {
    case 'source':
      return 'Выберите то, что у вас уже есть. Мы используем это сразу — без анкеты на 20 полей.';
    case 'progress':
      return 'Обычно занимает меньше минуты. Ничего подтверждать пока не нужно.';
    case 'talk':
      return 'Если профиля пока нет, укажите роль и регион — подбор начнётся с этих условий.';
    case 'review':
      return 'Подтвердите одним экраном — это войдёт в письма и подбор. Можно поправить конкретный пункт, не отвечая заново на всё.';
    case 'campaign':
      return 'Подтвердите или измените роли с уровнями и основаниями из профиля, затем выберите регионы.';
    case 'done':
      return 'Кампания собрана — откройте подходящие вакансии.';
  }
}
