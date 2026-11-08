'use client';

import { type AdminStaff, normalizePhone } from '@open-cinema/shared';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Empty } from '@/components/ui/Empty';
import { Labeled, Select, TextInput } from '@/components/ui/Inputs';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { CallError, call, messageOf } from '@/lib/client-api';
import { HUES, hueFor } from '@/lib/hues';

type Branch = { id: string; name: string };

export function StaffView({ staff, branches }: { staff: AdminStaff[]; branches: Branch[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [offerConvert, setOfferConvert] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close() {
    setOpen(false);
    setError(null);
    setOfferConvert(false);
  }

  function create(convert: boolean) {
    if (!name.trim()) return setError('Нэрийг оруулна уу.');
    if (!normalizePhone(phone))
      return setError('Утасны дугаар буруу байна. 8 оронтой дугаар оруулна уу.');
    if (!branchId) return setError('Салбараа сонгоно уу.');
    setError(null);
    start(async () => {
      try {
        await call('POST', '/admin/staff', {
          name: name.trim(),
          phone,
          branchId,
          ...(convert && { convert: true }),
        });
        setName('');
        setPhone('');
        close();
        router.refresh();
      } catch (err) {
        if (err instanceof CallError && err.code === 'phone_in_use' && !convert) {
          setOfferConvert(true);
          setError(null);
        } else {
          setOfferConvert(false);
          setError(messageOf(err));
        }
      }
    });
  }

  function remove(id: string) {
    setListError(null);
    start(async () => {
      try {
        await call('DELETE', `/admin/staff/${id}`);
        setRemoving(null);
        router.refresh();
      } catch (err) {
        setRemoving(null);
        setListError(messageOf(err));
      }
    });
  }

  return (
    <>
      <PageHeader
        title="Ажилтнууд"
        subtitle="Билет шалгах ажилтан утасны дугаараар OTP кодоор нэвтэрнэ"
        action={
          <Button variant="primary" onClick={() => setOpen(true)} disabled={branches.length === 0}>
            <Plus size={16} weight="bold" aria-hidden />
            Ажилтан нэмэх
          </Button>
        }
      />
      {listError && (
        <div className="mb-3">
          <Notice>{listError}</Notice>
        </div>
      )}
      {staff.length === 0 ? (
        <Empty title="Ажилтан бүртгэгдээгүй байна">
          {branches.length === 0
            ? 'Эхлээд салбар нэмнэ үү.'
            : 'Утасны дугаараар эхний ажилтнаа нэмнэ үү.'}
        </Empty>
      ) : (
        <div className="highlight overflow-x-auto rounded-panel border border-hairline bg-raised">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-muted">
                <th className="px-4 py-3 font-medium">Ажилтан</th>
                <th className="px-4 py-3 font-medium">Утас</th>
                <th className="px-4 py-3 font-medium">Салбар</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {staff.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar seed={s.id} name={s.name} size={32} />
                      <span className="font-medium text-ink">{s.name ?? 'Нэргүй'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-body tabular-nums">{s.phone ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {s.branchId ? (
                      <span className="inline-flex items-center gap-2 text-body">
                        <span
                          aria-hidden
                          className="size-2 rounded-full"
                          style={{ background: HUES[hueFor(s.branchId)] }}
                        />
                        {s.branchName}
                      </span>
                    ) : (
                      <span className="text-muted">Салбаргүй</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {removing === s.id ? (
                      <span className="inline-flex items-center gap-2">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => remove(s.id)}
                          disabled={pending}
                        >
                          Эрх хасах
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
                          Болих
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemoving(s.id)}
                        aria-label={`${s.name ?? 'Ажилтан'}-ын эрхийг хасах`}
                      >
                        Хасах
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={open}
        onClose={close}
        title="Ажилтан нэмэх"
        subtitle="Утасны дугаараар нэвтрэх эрх олгоно"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Болих
            </Button>
            <Button
              type="submit"
              form="staff-form"
              variant="primary"
              disabled={pending || offerConvert}
            >
              {pending ? 'Нэмж байна…' : 'Нэмэх'}
            </Button>
          </>
        }
      >
        <form
          id="staff-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create(false);
          }}
        >
          <Labeled label="Нэр" htmlFor="s-name">
            <TextInput
              id="s-name"
              data-autofocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </Labeled>
          <Labeled label="Утасны дугаар" htmlFor="s-phone" hint="Жишээ нь 99112233">
            <TextInput
              id="s-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Labeled>
          <Labeled label="Салбар" htmlFor="s-branch">
            <Select id="s-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Labeled>
          {offerConvert && (
            <div className="space-y-3 rounded-card border border-hue-yellow/30 bg-hue-yellow/10 p-3.5 text-[13px] text-body">
              <p>
                Энэ дугаараар хэрэглэгчийн бүртгэл байна. Ажилтан болгож, сонгосон салбарт оноох уу?
              </p>
              <Button size="sm" variant="primary" onClick={() => create(true)} disabled={pending}>
                Ажилтан болгох
              </Button>
            </div>
          )}
          {error && <Notice>{error}</Notice>}
        </form>
      </Drawer>
    </>
  );
}
