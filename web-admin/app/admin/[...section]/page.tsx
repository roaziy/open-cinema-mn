import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ADMIN_ITEMS } from '@/components/shell/nav';
import { IconTile } from '@/components/ui/IconTile';
import { PageHeader } from '@/components/ui/PageHeader';

type Props = { params: Promise<{ section: string[] }> };

const find = (segments: string[]) =>
  ADMIN_ITEMS.find((i) => i.href === `/admin/${segments.join('/')}`);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = find((await params).section);
  return { title: item?.label ?? 'Удирдлага' };
}

/** Holds a nav entry's place until its own page exists; specific routes take precedence. */
export default async function Placeholder({ params }: Props) {
  const item = find((await params).section);
  if (!item) notFound();
  const Icon = item.icon;
  return (
    <>
      <PageHeader title={item.label} />
      <div className="flex max-w-md items-center gap-3 rounded-panel border border-hairline bg-raised p-4">
        <IconTile hue={item.hue} size={36}>
          <Icon size={20} weight="fill" />
        </IconTile>
        <p className="text-[15px] text-body">Энэ хуудас удахгүй нэмэгдэнэ.</p>
      </div>
    </>
  );
}
