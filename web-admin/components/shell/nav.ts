import {
  Armchair,
  Building2,
  Calendar,
  ChartColumn,
  Clapperboard,
  Film,
  LayoutGrid,
  QrCode,
  Ticket,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;

export type NavItemDef = {
  href: string;
  label: string;
  icon: Icon;
  /** Which live number sits at the right edge. */
  count?: 'showtimes' | 'admitted';
  /** Marks the item whose children are the branches. */
  branches?: boolean;
};

export type NavGroupDef = {
  key: string;
  label: string;
  icon: Icon;
  items: NavItemDef[];
};

export const ADMIN_NAV: NavGroupDef[] = [
  {
    key: 'today',
    label: 'Өнөөдөр',
    icon: LayoutGrid,
    items: [
      { href: '/admin', label: 'Хяналтын самбар', icon: LayoutGrid },
      {
        href: '/admin/today',
        label: 'Өнөөдрийн сеанс',
        icon: Calendar,
        count: 'showtimes',
      },
      { href: '/admin/scans', label: 'Шалгалт', icon: QrCode, count: 'admitted' },
    ],
  },
  {
    key: 'cinema',
    label: 'Кино театр',
    icon: Clapperboard,
    items: [
      {
        href: '/admin/branches',
        label: 'Салбар',
        icon: Building2,
        branches: true,
      },
      { href: '/admin/halls', label: 'Заал', icon: Armchair },
      { href: '/admin/movies', label: 'Кино', icon: Film },
      { href: '/admin/schedule', label: 'Сеанс, үнэ', icon: Ticket },
    ],
  },
  {
    key: 'team',
    label: 'Баг',
    icon: Users,
    items: [{ href: '/admin/staff', label: 'Ажилтнууд', icon: Users }],
  },
  {
    key: 'reports',
    label: 'Тайлан',
    icon: ChartColumn,
    items: [{ href: '/admin/reports', label: 'Борлуулалт, дүүргэлт', icon: ChartColumn }],
  },
];

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
