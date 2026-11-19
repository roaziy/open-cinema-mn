import { LegalPage } from '@/components/legal-page';

export default function PrivacyScreen() {
  return (
    <LegalPage
      sections={[
        ['privacy.1.h', 'privacy.1.p'],
        ['privacy.2.h', 'privacy.2.p'],
        ['privacy.3.h', 'privacy.3.p'],
        ['privacy.4.h', 'privacy.4.p'],
        ['privacy.5.h', 'privacy.5.p'],
      ]}
    />
  );
}
