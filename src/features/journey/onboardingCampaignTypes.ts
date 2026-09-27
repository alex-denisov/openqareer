export type OnboardingCampaignState = 'loading' | 'model' | 'fallback';

export interface OnboardingCampaignRole {
  readonly id: string;
  /** Server title used for vacancy matching and saving the campaign. */
  readonly title: string;
  readonly titleRu?: string;
  readonly level?: 'ic' | 'lead' | 'head' | 'vp' | 'c-level' | null;
  readonly kind?: 'primary' | 'adjacent';
  readonly reason?: string;
  readonly evidence?: readonly string[];
  readonly source: 'model' | 'profile' | 'candidate';
}
