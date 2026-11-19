import { LegalPage } from '@/components/legal-page';

export default function TermsScreen() {
  return (
    <LegalPage
      sections={[
        ['terms.1.h', 'terms.1.p'],
        ['terms.2.h', 'terms.2.p'],
        ['terms.3.h', 'terms.3.p'],
        ['terms.4.h', 'terms.4.p'],
        ['terms.5.h', 'terms.5.p'],
        ['terms.6.h', 'terms.6.p'],
      ]}
    />
  );
}
