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

  'home.nowShowing': 'Үзвэрт гарч байна',
  'home.comingSoon': 'Тун удахгүй',
  'home.book': 'Тасалбар авах',
  'home.opens': '{date}-нд нээгдэнэ',
  'home.empty': 'Одоогоор үзвэрт гарч буй кино алга.',
  'branch.all': 'Бүх салбар',
  'branch.title': 'Салбар сонгох',

  'movie.synopsis': 'Агуулга',
  'movie.info': 'Мэдээлэл',
  'movie.duration': 'Үргэлжлэх хугацаа',
  'movie.genre': 'Төрөл',
  'movie.release': 'Нээлт',
  'movie.age': 'Насны ангилал',
  'movie.fromPrice': '{price}-аас',
  'movie.pickTime': 'Цаг сонгох',
  'movie.back': 'Буцах',
  'duration.hm': '{h}ц {m}м',
  'duration.m': '{m}м',

  'showtimes.title': 'Цаг сонгох',
  'showtimes.today': 'Өнөөдөр',
  'showtimes.tomorrow': 'Маргааш',
  'showtimes.empty': 'Энэ өдөр үзвэр алга',
  'showtimes.emptyHint': 'Өөр өдөр сонгоно уу.',
  'showtimes.fewLeft': '{n} үлдсэн',
  'showtimes.soldOut': 'Дүүрсэн',
  'showtime.placeholder': 'Суудал сонгох дэлгэц удахгүй.',

  'weekday.0': 'Ням',
  'weekday.1': 'Дав',
  'weekday.2': 'Мяг',
  'weekday.3': 'Лха',
  'weekday.4': 'Пүр',
  'weekday.5': 'Баа',
  'weekday.6': 'Бям',

  'lang.mn': 'Монгол',
  'lang.en': 'English',
} as const;

export type TKey = keyof typeof mn;
