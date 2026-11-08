import {
  Armchair,
  Buildings,
  CalendarBlank,
  ChartBar,
  FilmSlate,
  FilmStrip,
  QrCode,
  SquaresFour,
  Ticket,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import type { ComponentType } from 'react';
import type { HueKey } from '@/lib/hues';

type Icon = ComponentType<{ size?: number; weight?: 'fill' | 'regular' }>;

export type NavItemDef = {
  href: string;
  label: string;
  icon: Icon;
  hue: HueKey;
  /** Which live number sits at the right edge. */
  count?: 'showtimes' | 'admitted';
  /** Marks the item whose children are the branches. */
  branches?: boolean;
};

export type NavGroupDef = {
  key: string;
  label: string;
  hue: HueKey;
  icon: Icon;
  items: NavItemDef[];
};

export const ADMIN_NAV: NavGroupDef[] = [
  {
    key: 'today',
    label: 'Өнөөдөр',
    hue: 'green',
    icon: SquaresFour,
    items: [
      { href: '/admin', label: 'Хяналтын самбар', icon: SquaresFour, hue: 'indigo' },
      {
        href: '/admin/today',
        label: 'Өнөөдрийн сеанс',
        icon: CalendarBlank,
        hue: 'green',
        count: 'showtimes',
      },
      { href: '/admin/scans', label: 'Шалгалт', icon: QrCode, hue: 'teal', count: 'admitted' },
    ],
  },
  {
    key: 'cinema',
    label: 'Кино театр',
    hue: 'purple',
    icon: FilmSlate,
    items: [
      {
        href: '/admin/branches',
        label: 'Салбар, заал',
        icon: Buildings,
        hue: 'purple',
        branches: true,
      },
      { href: '/admin/movies', label: 'Кино', icon: FilmStrip, hue: 'pink' },
      { href: '/admin/showtimes', label: 'Сеанс, үнэ', icon: Ticket, hue: 'yellow' },
    ],
  },
  {
    key: 'team',
    label: 'Баг',
    hue: 'teal',
    icon: UsersThree,
    items: [{ href: '/admin/staff', label: 'Ажилтнууд', icon: UsersThree, hue: 'sky' }],
  },
  {
    key: 'reports',
    label: 'Тайлан',
    hue: 'yellow',
    icon: ChartBar,
    items: [
      { href: '/admin/reports/sales', label: 'Борлуулалт', icon: ChartBar, hue: 'green' },
      { href: '/admin/reports/occupancy', label: 'Дүүргэлт', icon: Armchair, hue: 'indigo' },
    ],
  },
];

export const ADMIN_ITEMS = ADMIN_NAV.flatMap((g) => g.items);

export function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Админ',
  staff: 'Ажилтан',
  customer: 'Хэрэглэгч',
  guest: 'Зочин',
};
