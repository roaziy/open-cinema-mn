'use client';

import type { Branch } from '@open-cinema/shared';
import { PencilSimple } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { BranchDrawer } from './BranchDrawer';

export function BranchEditButton({ branch }: { branch: Branch }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PencilSimple size={16} aria-hidden />
        Засах
      </Button>
      <BranchDrawer branch={branch} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
