/** The shape of `GET /v1/feature-cards` (T-155). The registry itself lives in the API. */
export interface FeatureCardView {
  id: string;
  version: number;
  title: string;
  body: string;
  href: string | null;
  linkLabel: string | null;
  icon: 'table' | 'cloud' | 'palette';
  where: 'HOME' | 'QUEUED' | 'DISMISSED';
  unread: boolean;
}

export interface FeatureCardsView {
  homeLimit: number;
  home: FeatureCardView[];
  tray: FeatureCardView[];
  unread: number;
}
