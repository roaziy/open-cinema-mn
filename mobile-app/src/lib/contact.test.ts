import { describe, expect, it } from 'vitest';
import { contactItems } from './contact';

describe('contactItems', () => {
  it('hides rows whose value is unset or blank', () => {
    const items = contactItems({
      EXPO_PUBLIC_CONTACT_PHONE: '7700 1234',
      EXPO_PUBLIC_CONTACT_EMAIL: '  ',
    });
    expect(items.map((i) => i.key)).toEqual(['phone']);
    expect(items[0]?.url).toBe('tel:77001234');
  });

  it('builds links from handles and keeps full URLs', () => {
    const items = contactItems({
      EXPO_PUBLIC_CONTACT_EMAIL: 'hi@example.com',
      EXPO_PUBLIC_CONTACT_FACEBOOK: 'opencinema',
      EXPO_PUBLIC_CONTACT_INSTAGRAM: 'https://instagram.com/oc',
    });
    expect(items.map((i) => i.url)).toEqual([
      'mailto:hi@example.com',
      'https://facebook.com/opencinema',
      'https://instagram.com/oc',
    ]);
  });
});
