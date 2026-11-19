'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Labeled, TextInput } from '@/components/ui/Inputs';
import { Notice } from '@/components/ui/Notice';
import { call, messageOf } from '@/lib/client-api';
import { parseLocation } from '@/lib/map-link';
import { AdminBranchBody, type Branch } from '@/lib/shared';
import { MapPicker } from './MapPicker';

// Ulaanbaatar city centre: a starting point the admin nudges, not a real branch location.
const CENTER = { lat: '47.9184', lng: '106.9177' };

/** Create or edit a branch. Remount (key) per branch so the fields always start from its data. */
export function BranchDrawer({
  branch,
  open,
  onClose,
}: {
  branch: Branch | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [lat, setLat] = useState(branch ? String(branch.lat) : CENTER.lat);
  const [lng, setLng] = useState(branch ? String(branch.lng) : CENTER.lng);
  const [link, setLink] = useState('');
  const [linkBad, setLinkBad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  // A pasted map link or "lat, lng" pair moves the pin. Read on paste, Enter or blur, never
  // per keystroke: a half-typed "47.9, 1" is a valid point too.
  function apply(text: string) {
    const at = parseLocation(text);
    if (!at) {
      setLinkBad(text.trim() !== '');
      return false;
    }
    setLat(String(at.lat));
    setLng(String(at.lng));
    setLink('');
    setLinkBad(false);
    return true;
  }

  function save() {
    const parsed = AdminBranchBody.safeParse({
      name,
      address,
      lat: Number(lat),
      lng: Number(lng),
    });
    if (!parsed.success) {
      setError('Нэр, хаяг, координатаа шалгана уу.');
      return;
    }
    setError(null);
    start(async () => {
      try {
        if (branch) await call('PATCH', `/admin/branches/${branch.id}`, parsed.data);
        else await call('POST', '/admin/branches', parsed.data);
        onClose();
        router.refresh();
      } catch (err) {
        setError(messageOf(err));
      }
    });
  }

  function remove() {
    if (!branch) return;
    start(async () => {
      try {
        await call('DELETE', `/admin/branches/${branch.id}`);
        onClose();
        router.replace('/admin/branches');
        router.refresh();
      } catch (err) {
        setConfirm(false);
        setError(messageOf(err));
      }
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      step={confirm ? 'confirm' : 'form'}
      title={branch ? 'Салбар засах' : 'Шинэ салбар'}
      footer={
        <>
          {branch &&
            (confirm ? (
              <>
                <Button variant="danger" onClick={remove} disabled={pending}>
                  Тийм, устга
                </Button>
                <Button variant="ghost" data-step-focus onClick={() => setConfirm(false)}>
                  Болих
                </Button>
              </>
            ) : (
              <Button variant="ghost" className="mr-auto" onClick={() => setConfirm(true)}>
                Устгах
              </Button>
            ))}
          {!confirm && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Болих
              </Button>
              <Button type="submit" form="branch-form" variant="primary" disabled={pending}>
                {pending ? 'Хадгалж байна…' : 'Хадгалах'}
              </Button>
            </>
          )}
        </>
      }
    >
      <form
        id="branch-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Labeled label="Салбарын нэр" htmlFor="b-name">
          <TextInput
            id="b-name"
            data-autofocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </Labeled>
        <Labeled label="Хаяг" htmlFor="b-addr">
          <TextInput
            id="b-addr"
            value={address}
            maxLength={300}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Labeled>
        <Labeled
          label="Байршил"
          htmlFor="b-link"
          hint={
            linkBad
              ? 'Координат олдсонгүй. Богино холбоос (maps.app.goo.gl) ажиллахгүй: хөтчийн хаягийн мөрөөс бүтэн холбоосыг, эсвэл газрын зураг дээр баруун товшоод координатыг хуулна уу.'
              : 'Google Maps эсвэл OpenStreetMap-ийн холбоос, координат буулгана. Эсвэл доорх газрын зураг дээр дарж, зүүг чирнэ.'
          }
        >
          <TextInput
            id="b-link"
            value={link}
            placeholder="https://www.google.com/maps/… эсвэл 47.9184, 106.9177"
            aria-invalid={linkBad || undefined}
            onChange={(e) => {
              setLink(e.target.value);
              if (!e.target.value.trim()) setLinkBad(false);
            }}
            onPaste={(e) => {
              if (apply(e.clipboardData.getData('text'))) e.preventDefault();
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              apply(link);
            }}
            onBlur={() => apply(link)}
          />
        </Labeled>
        <MapPicker
          lat={Number(lat)}
          lng={Number(lng)}
          onPick={(la, ln) => {
            setLat(String(la));
            setLng(String(ln));
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Өргөрөг" htmlFor="b-lat">
            <TextInput
              id="b-lat"
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </Labeled>
          <Labeled label="Уртраг" htmlFor="b-lng">
            <TextInput
              id="b-lng"
              inputMode="decimal"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
          </Labeled>
        </div>
        <p className="text-xs text-muted">
          Аппын газрын зураг дээр салбарыг энэ координатаар харуулна.
        </p>
        {error && <Notice>{error}</Notice>}
      </form>
    </Drawer>
  );
}
