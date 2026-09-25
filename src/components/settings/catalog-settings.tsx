'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface CatalogState {
  catalog_id: string | null;
  synced_at: string | null;
  product_count: number;
}

/**
 * Settings → WhatsApp → Product Catalog. Links the Meta Commerce
 * catalog the AI auto-reply bot recommends from, and syncs it into the
 * local cache (`/api/commerce/catalog`). Admin-only edits; everyone
 * else sees the status read-only.
 */
export function CatalogSettings({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('Settings.whatsapp');
  const [state, setState] = useState<CatalogState | null>(null);
  const [catalogId, setCatalogId] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/commerce/catalog');
    if (!res.ok) return;
    const data = (await res.json()) as CatalogState;
    setState(data);
    setCatalogId(data.catalog_id ?? '');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/commerce/catalog', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t('catalogSyncFailed'), { description: data.error });
        return;
      }
      toast.success(t('catalogSynced', { count: data.product_count }));
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/commerce/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalog_id: catalogId.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t('catalogSaveFailed'), { description: data.error });
        return;
      }
      if (data.catalog_id) {
        toast.success(t('catalogSaved'));
        await sync();
      } else {
        toast.success(t('catalogUnlinked'));
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  const dirty = (state?.catalog_id ?? '') !== catalogId.trim();
  const busy = saving || syncing;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">{t('catalogTitle')}</CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('catalogDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="catalog-id" className="text-foreground">
            {t('catalogIdLabel')}
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="catalog-id"
              inputMode="numeric"
              value={catalogId}
              onChange={(e) => setCatalogId(e.target.value)}
              placeholder={t('catalogIdPlaceholder')}
              disabled={!canEdit || busy}
              className="min-w-0 flex-1 font-mono"
            />
            <Button onClick={save} disabled={!canEdit || busy || !dirty}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('catalogSave')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('catalogIdHint')}</p>
        </div>

        {state?.catalog_id && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
            <p className="text-sm text-foreground">
              {state.synced_at
                ? t('catalogStatus', {
                    count: state.product_count,
                    time: formatDistanceToNow(new Date(state.synced_at), { addSuffix: true }),
                  })
                : t('catalogNeverSynced')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={sync}
              disabled={!canEdit || busy || dirty}
            >
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t('catalogSync')}
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t('catalogPermissionHint')}</p>
      </CardContent>
    </Card>
  );
}
