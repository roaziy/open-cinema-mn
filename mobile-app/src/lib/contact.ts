import type { TKey } from '@/i18n';

export type ContactItem = {
  key: 'phone' | 'email' | 'facebook' | 'instagram';
  label: TKey;
  value: string;
  url: string;
};

const clean = (v: string | undefined) => (v?.trim() ? v.trim() : null);

/** A profile or page link: a bare handle or a full URL both work. */
function social(value: string, base: string): string {
  return /^https?:\/\//i.test(value) ? value : `${base}${value.replace(/^@/, '')}`;
}

/** Contact rows from EXPO_PUBLIC_CONTACT_* ; a row whose value is unset is left out. */
export function contactItems(env: Record<string, string | undefined>): ContactItem[] {
  const phone = clean(env.EXPO_PUBLIC_CONTACT_PHONE);
  const email = clean(env.EXPO_PUBLIC_CONTACT_EMAIL);
  const facebook = clean(env.EXPO_PUBLIC_CONTACT_FACEBOOK);
  const instagram = clean(env.EXPO_PUBLIC_CONTACT_INSTAGRAM);
  const items: (ContactItem | null)[] = [
    phone
      ? {
          key: 'phone',
          label: 'contact.phone',
          value: phone,
          url: `tel:${phone.replace(/\s+/g, '')}`,
        }
      : null,
    email ? { key: 'email', label: 'contact.email', value: email, url: `mailto:${email}` } : null,
    facebook
      ? {
          key: 'facebook',
          label: 'contact.facebook',
          value: facebook,
          url: social(facebook, 'https://facebook.com/'),
        }
      : null,
    instagram
      ? {
          key: 'instagram',
          label: 'contact.instagram',
          value: instagram,
          url: social(instagram, 'https://instagram.com/'),
        }
      : null,
  ];
  return items.filter((i): i is ContactItem => i !== null);
}
