'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { Branch } from '@/lib/shared';
import { BranchDrawer } from './BranchDrawer';

export function BranchEditButton({ branch }: { branch: Branch }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Pencil size={16} aria-hidden />
        Засах
      </Button>
      <BranchDrawer branch={branch} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
