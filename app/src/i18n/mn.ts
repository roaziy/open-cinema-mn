/** Mongolian is the source dictionary; `en.ts` must provide every key. */
export const mn = {
  'tabs.movies': 'Кино',
  'tabs.tickets': 'Тасалбар',
  'tabs.profile': 'Профайл',

  'movies.title': 'Кино',
  'movies.empty': 'Нээлттэй кинонууд энд харагдана.',
  'tickets.title': 'Тасалбар',
  'tickets.empty': 'Захиалсан тасалбар чинь энд хадгалагдана.',
  'profile.title': 'Профайл',
  'profile.empty': 'Нэвтэрвэл тасалбараа бүх төхөөрөмжөөсөө харна.',

  'common.retry': 'Дахин оролдох',
  'common.cancel': 'Болих',
  'common.done': 'Болсон',
  'error.network': 'Сүлжээнд холбогдож чадсангүй. Дахин оролдоно уу.',
  'error.generic': 'Алдаа гарлаа. Дахин оролдоно уу.',

  'lang.mn': 'Монгол',
  'lang.en': 'English',
} as const;

export type TKey = keyof typeof mn;
