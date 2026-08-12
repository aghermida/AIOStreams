import React from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BiTrash,
  BiSearch,
  BiInfoCircle,
  BiPlus,
  BiPencil,
  BiCheck,
  BiX,
  BiCopy,
} from 'react-icons/bi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Card } from '@/components/ui/card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { PasswordInput } from '@/components/ui/password-input';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { useDebounce } from '@/hooks/debounce';
import { useStatus } from '@/context/status';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { copyToClipboard } from '@/utils/clipboard';
import {
  CLONE_SECTIONS,
  type CloneSection,
} from '../../../../../core/src/utils/fieldMeta';

const CLONE_SECTION_LABELS: Record<CloneSection, string> = {
  services: 'Services (debrid/usenet credentials, API keys)',
  addons: 'Addons & catalogs',
  filters: 'Filters',
  sorting: 'Sorting',
  formatter: 'Formatter',
  proxy: 'Proxy',
  miscellaneous: 'Miscellaneous settings',
  about: 'Branding (addon name/logo/description)',
};

interface UserItem {
  uuid: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  requests24h: number;
}
interface UserList {
  items: UserItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
interface UserDetail extends UserItem {
  recentErrorStages: { stage: string; count: number }[];
}

const PAGE_SIZES = ['10', '25', '50', '100'];

interface CreatedCredentials {
  uuid: string;
  password: string;
  encryptedPassword: string;
}

export function UsersPage() {
  const qc = useQueryClient();
  const { status } = useStatus();
  const baseUrl = status?.settings?.baseUrl || window.location.origin;
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [q, setQ] = React.useState('');
  const [sort, setSort] = React.useState('created_at');
  const [dir, setDir] = React.useState<'asc' | 'desc'>('desc');
  const dq = useDebounce(q, 300);
  const [detail, setDetail] = React.useState<UserDetail | null>(null);
  // Row selection — keyed by uuid so it survives page changes.
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // Match-all-on-server confirmation typing.
  const [allMatchingText, setAllMatchingText] = React.useState('');
  const [allMatchingOpen, setAllMatchingOpen] = React.useState(false);
  // Inline "jump to page" state.
  const [pageInput, setPageInput] = React.useState<number>(1);
  React.useEffect(() => setPageInput(page), [page]);

  const list = useQuery({
    queryKey: ['dashboard', 'users', page, limit, dq, sort, dir],
    queryFn: () =>
      api<UserList>(
        `/dashboard/users?page=${page}&limit=${limit}&q=${encodeURIComponent(dq)}&sort=${sort}&dir=${dir}`
      ),
    staleTime: 10_000,
  });

  const del = useMutation({
    mutationFn: (uuid: string) => api(`DELETE /dashboard/users/${uuid}`),
    onSuccess: () => {
      toast.success('User config deleted.');
      qc.invalidateQueries({ queryKey: ['dashboard', 'users'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Delete failed'),
  });

  const batchDel = useMutation({
    mutationFn: (body: {
      uuids?: string[];
      allMatching?: boolean;
      q?: string;
    }) => api<{ deleted: number }>('DELETE /dashboard/users', { body }),
    onSuccess: (r) => {
      toast.success(
        `Deleted ${r.deleted} user config${r.deleted === 1 ? '' : 's'}.`
      );
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['dashboard', 'users'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Batch delete failed'),
  });

  // Inline nickname editing.
  const [editingUuid, setEditingUuid] = React.useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = React.useState('');
  const setLabel = useMutation({
    mutationFn: ({ uuid, label }: { uuid: string; label: string | null }) =>
      api(`PATCH /dashboard/users/${uuid}/label`, { body: { label } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard', 'users'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to update nickname'),
    onSettled: () => setEditingUuid(null),
  });

  // Create User: admin provisions a friend's profile without a shared login.
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [cloneFrom, setCloneFrom] = React.useState(false);
  const [sourceUuid, setSourceUuid] = React.useState('');
  const [sourcePassword, setSourcePassword] = React.useState('');
  const [cloneSections, setCloneSections] = React.useState<
    Set<CloneSection>
  >(new Set(CLONE_SECTIONS));
  const [createdCredentials, setCreatedCredentials] =
    React.useState<CreatedCredentials | null>(null);
  const [credentialsModalTitle, setCredentialsModalTitle] =
    React.useState('User created');

  const resetCreateForm = () => {
    setNewLabel('');
    setNewPassword('');
    setCloneFrom(false);
    setSourceUuid('');
    setSourcePassword('');
    setCloneSections(new Set(CLONE_SECTIONS));
  };

  const toggleCloneSection = (section: CloneSection, checked: boolean) => {
    setCloneSections((prev) => {
      const next = new Set(prev);
      if (checked) next.add(section);
      else next.delete(section);
      return next;
    });
  };

  const createUser = useMutation({
    mutationFn: () =>
      api<CreatedCredentials>('POST /dashboard/users', {
        body: {
          label: newLabel.trim() || undefined,
          password: newPassword || undefined,
          parentConfig: cloneFrom
            ? { uuid: sourceUuid.trim(), password: sourcePassword }
            : undefined,
          cloneSections: cloneFrom ? [...cloneSections] : undefined,
        },
      }),
    onSuccess: (data) => {
      setCreateOpen(false);
      resetCreateForm();
      setCredentialsModalTitle('User created');
      setCreatedCredentials(data);
      qc.invalidateQueries({ queryKey: ['dashboard', 'users'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to create user'),
  });

  // Admin-initiated password reset: no cooperation from the user and no
  // current password needed. Relies on the config's server-recoverable
  // escrow copy, which only exists once a user's config has been created,
  // saved, or had its password changed after this feature shipped.
  const [resetPasswordOpen, setResetPasswordOpen] = React.useState(false);
  const [newPasswordInput, setNewPasswordInput] = React.useState('');

  const resetResetPasswordForm = () => {
    setResetPasswordOpen(false);
    setNewPasswordInput('');
  };

  const resetPassword = useMutation({
    mutationFn: (uuid: string) =>
      api<{ password: string; encryptedPassword: string }>(
        `POST /dashboard/users/${uuid}/reset-password`,
        {
          body: {
            newPassword: newPasswordInput || undefined,
          },
        }
      ),
    onSuccess: (data) => {
      if (!detail) return;
      setDetail(null);
      resetResetPasswordForm();
      setCredentialsModalTitle('Password reset');
      setCreatedCredentials({
        uuid: detail.uuid,
        password: data.password,
        encryptedPassword: data.encryptedPassword,
      });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to reset password'),
  });

  const manifestUrl = createdCredentials
    ? `${baseUrl}/stremio/${createdCredentials.uuid}/${createdCredentials.encryptedPassword}/manifest.json`
    : '';
  const stremioInstallUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');
  const configureUrl = createdCredentials
    ? `${baseUrl}/stremio/${createdCredentials.uuid}/${createdCredentials.encryptedPassword}/configure`
    : '';

  const copyField = (value: string, label: string) =>
    void copyToClipboard(value, {
      onSuccess: () => toast.success(`${label} copied`),
      onError: () => toast.error('Copy failed'),
    });

  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);
  const confirm = useConfirmationDialog({
    title: 'Delete user config',
    description:
      'This permanently deletes this user configuration. This cannot be undone.',
    actionText: 'Delete',
    actionIntent: 'alert-subtle',
    onConfirm: () => {
      if (pendingDelete) del.mutate(pendingDelete);
    },
  });

  const batchConfirm = useConfirmationDialog({
    title: `Delete ${selected.size} selected`,
    description: `This permanently deletes ${selected.size} user configurations. This cannot be undone.`,
    actionText: 'Delete',
    actionIntent: 'alert-subtle',
    onConfirm: () => batchDel.mutate({ uuids: [...selected] }),
  });

  const toggleSort = (col: string) => {
    if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(col);
      setDir('desc');
    }
  };

  const openDetail = async (uuid: string) => {
    try {
      setDetail(await api<UserDetail>(`/dashboard/users/${uuid}`));
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to load user');
    }
  };

  const d = list.data;
  const pageItems = d?.items ?? [];
  const allOnPageSelected =
    pageItems.length > 0 && pageItems.every((u) => selected.has(u.uuid));
  const someOnPageSelected =
    pageItems.some((u) => selected.has(u.uuid)) && !allOnPageSelected;

  const toggleAllOnPage = (v: boolean | 'indeterminate') => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (v === true) for (const u of pageItems) next.add(u.uuid);
      else for (const u of pageItems) next.delete(u.uuid);
      return next;
    });
  };

  const toggleRow = (uuid: string, v: boolean | 'indeterminate') => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (v === true) next.add(uuid);
      else next.delete(uuid);
      return next;
    });
  };

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-4">
      <div>
        <h2>Users</h2>
        <p className="text-[--muted]">
          {d ? `${d.total} configured users` : 'Browse user configs'}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <TextInput
          leftIcon={<BiSearch />}
          placeholder="Search by UUID…"
          value={q}
          onValueChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          className="flex-1"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-[--muted]">Per page</span>
          <Select
            value={String(limit)}
            options={PAGE_SIZES.map((s) => ({ label: s, value: s }))}
            onValueChange={(v) => {
              setLimit(Number(v) || 25);
              setPage(1);
            }}
            className="w-24"
          />
        </div>
        <Button
          size="sm"
          intent="white"
          leftIcon={<BiPlus />}
          onClick={() => {
            resetCreateForm();
            setCreateOpen(true);
          }}
        >
          Create User
        </Button>
      </div>

      {selected.size > 0 && (
        <Card className="p-3 flex flex-wrap items-center gap-3 border-brand/30 bg-brand/5">
          <span className="text-sm">{selected.size} selected</span>
          <Button
            size="sm"
            intent="gray-subtle"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
          <Button
            size="sm"
            intent="alert-subtle"
            leftIcon={<BiTrash />}
            loading={batchDel.isPending}
            onClick={() => batchConfirm.open()}
          >
            Delete selected
          </Button>
          {dq && (
            <Button
              size="sm"
              intent="alert-outline"
              onClick={() => {
                setAllMatchingText('');
                setAllMatchingOpen(true);
              }}
            >
              Delete all matching filter
            </Button>
          )}
        </Card>
      )}

      <DashboardQueryBoundary query={list} errorTitle="Failed to load users">
        {() => (
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[--muted] text-xs uppercase bg-[--subtle]/40">
                  <tr className="text-left">
                    <th className="p-3 w-10">
                      <Checkbox
                        value={
                          allOnPageSelected
                            ? true
                            : someOnPageSelected
                              ? 'indeterminate'
                              : false
                        }
                        onValueChange={toggleAllOnPage}
                        aria-label="Select all on page"
                      />
                    </th>
                    <th className="p-3">Nickname</th>
                    <th className="p-3">UUID</th>
                    {(
                      [
                        ['created_at', 'Created'],
                        ['accessed_at', 'Last accessed'],
                      ] as const
                    ).map(([c, l]) => (
                      <th
                        key={c}
                        className="p-3 cursor-pointer select-none"
                        onClick={() => toggleSort(c)}
                      >
                        {l}
                        {sort === c ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                    <th className="p-3 text-right">Req 24h</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((u) => (
                    <tr
                      key={u.uuid}
                      className="border-t border-[--border]/50 hover:bg-[--subtle]/30"
                    >
                      <td className="p-3">
                        <Checkbox
                          value={selected.has(u.uuid)}
                          onValueChange={(v) => toggleRow(u.uuid, v)}
                          aria-label={`Select ${u.uuid}`}
                        />
                      </td>
                      <td className="p-3">
                        {editingUuid === u.uuid ? (
                          <div className="flex items-center gap-1">
                            <TextInput
                              value={editLabelValue}
                              onValueChange={setEditLabelValue}
                              placeholder="Nickname"
                              autoFocus
                              className="w-32"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter')
                                  setLabel.mutate({
                                    uuid: u.uuid,
                                    label: editLabelValue.trim() || null,
                                  });
                                if (e.key === 'Escape') setEditingUuid(null);
                              }}
                            />
                            <IconButton
                              size="sm"
                              intent="gray-subtle"
                              icon={<BiCheck />}
                              aria-label="Save nickname"
                              loading={setLabel.isPending}
                              onClick={() =>
                                setLabel.mutate({
                                  uuid: u.uuid,
                                  label: editLabelValue.trim() || null,
                                })
                              }
                            />
                            <IconButton
                              size="sm"
                              intent="gray-subtle"
                              icon={<BiX />}
                              aria-label="Cancel"
                              onClick={() => setEditingUuid(null)}
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <span>{u.label || '—'}</span>
                            <IconButton
                              size="sm"
                              intent="gray-subtle"
                              icon={<BiPencil />}
                              aria-label="Edit nickname"
                              className="opacity-0 group-hover:opacity-100"
                              onClick={() => {
                                setEditingUuid(u.uuid);
                                setEditLabelValue(u.label ?? '');
                              }}
                            />
                          </div>
                        )}
                      </td>
                      <td
                        className="p-3 font-mono text-xs cursor-pointer"
                        title={u.uuid}
                        onClick={() =>
                          void copyToClipboard(u.uuid, {
                            onSuccess: () => toast.success('UUID copied'),
                            onError: () => toast.error('Copy failed'),
                          })
                        }
                      >
                        {u.uuid.slice(0, 8)}…{u.uuid.slice(-4)}
                      </td>
                      <td className="p-3">{formatDateTime(u.createdAt)}</td>
                      <td className="p-3">{formatDateTime(u.accessedAt)}</td>
                      <td className="p-3 text-right tabular-nums">
                        {u.requests24h}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <IconButton
                            size="sm"
                            intent="gray-subtle"
                            icon={<BiInfoCircle />}
                            aria-label="Details"
                            onClick={() => openDetail(u.uuid)}
                          />
                          <IconButton
                            size="sm"
                            intent="alert-subtle"
                            icon={<BiTrash />}
                            aria-label="Delete"
                            onClick={() => {
                              setPendingDelete(u.uuid);
                              confirm.open();
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {d && pageItems.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="p-8 text-center text-[--muted]"
                      >
                        No users found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </DashboardQueryBoundary>

      {d && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[--muted]">
            Showing {(d.page - 1) * d.limit + (pageItems.length > 0 ? 1 : 0)}–
            {Math.min(d.page * d.limit, d.total)} of {d.total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              intent="gray-outline"
              disabled={page <= 1}
              onClick={() => setPage(1)}
            >
              «
            </Button>
            <Button
              size="sm"
              intent="gray-outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <div className="flex items-center gap-1 text-xs text-[--muted]">
              Page
              <NumberInput
                value={pageInput}
                min={1}
                max={Math.max(1, d.pages)}
                onValueChange={(v) => setPageInput(Number(v) || 1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const next = Math.max(
                      1,
                      Math.min(d.pages || 1, Number(pageInput) || 1)
                    );
                    setPage(next);
                  }
                }}
                className="w-20"
              />
              / {d.pages || 1}
            </div>
            <Button
              size="sm"
              intent="gray-outline"
              disabled={page >= d.pages}
              onClick={() => setPage((p) => Math.min(d.pages || 1, p + 1))}
            >
              Next
            </Button>
            <Button
              size="sm"
              intent="gray-outline"
              disabled={page >= d.pages}
              onClick={() => setPage(d.pages || 1)}
            >
              »
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) {
            setDetail(null);
            resetResetPasswordForm();
          }
        }}
        title="User detail"
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-[--muted]">Nickname</div>
              <div>{detail.label || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-[--muted]">UUID</div>
              <div className="font-mono break-all">{detail.uuid}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-[--muted]">Created</div>
                {formatDateTime(detail.createdAt)}
              </div>
              <div>
                <div className="text-xs text-[--muted]">Updated</div>
                {formatDateTime(detail.updatedAt)}
              </div>
              <div>
                <div className="text-xs text-[--muted]">Last accessed</div>
                {formatDateTime(detail.accessedAt)}
              </div>
              <div>
                <div className="text-xs text-[--muted]">Requests 24h</div>
                {detail.requests24h}
              </div>
            </div>
            <div>
              <div className="text-xs text-[--muted] mb-1">
                Recent error stages
              </div>
              {detail.recentErrorStages.length ? (
                <ul className="space-y-1">
                  {detail.recentErrorStages.map((e) => (
                    <li key={e.stage} className="flex justify-between">
                      <span>{e.stage}</span>
                      <span className="tabular-nums text-[--muted]">
                        {e.count}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[--muted]">None</span>
              )}
            </div>

            <div className="pt-2 border-t border-[--border]">
              {!resetPasswordOpen ? (
                <Button
                  size="sm"
                  intent="gray-outline"
                  onClick={() => setResetPasswordOpen(true)}
                >
                  Reset Password
                </Button>
              ) : (
                <div className="space-y-3">
                  <Alert
                    intent="alert"
                    isClosable={false}
                    description="This immediately replaces the user's password — they'll need the new one to access their profile again. Only works if this account was created or saved after password recovery was added; older, never-resaved accounts can't be recovered."
                  />
                  <PasswordInput
                    label="New password"
                    value={newPasswordInput}
                    onValueChange={setNewPasswordInput}
                    placeholder="Leave blank to auto-generate"
                    autoComplete="off"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      intent="gray-outline"
                      onClick={resetResetPasswordForm}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      intent="white"
                      loading={resetPassword.isPending}
                      onClick={() => resetPassword.mutate(detail.uuid)}
                    >
                      Reset Password
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetCreateForm();
        }}
        title="Create User"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              intent="gray-outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              intent="white"
              size="sm"
              loading={createUser.isPending}
              disabled={cloneFrom && (!sourceUuid.trim() || !sourcePassword)}
              onClick={() => createUser.mutate()}
            >
              Create
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <TextInput
            label="Nickname"
            value={newLabel}
            onValueChange={setNewLabel}
            placeholder="e.g. Alice"
          />
          <PasswordInput
            label="Password"
            value={newPassword}
            onValueChange={setNewPassword}
            placeholder="Leave blank to auto-generate"
            autoComplete="new-password"
          />
          <Checkbox
            label="Clone settings from an existing profile"
            value={cloneFrom}
            onValueChange={(v) => setCloneFrom(v === true)}
          />
          {cloneFrom && (
            <div className="space-y-3 pl-1">
              <TextInput
                label="Source UUID"
                value={sourceUuid}
                onValueChange={setSourceUuid}
                placeholder="uuid of the profile to copy"
              />
              <PasswordInput
                label="Source password"
                value={sourcePassword}
                onValueChange={setSourcePassword}
                placeholder="That profile's password"
                autoComplete="off"
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-[--muted]">
                    What to copy
                  </span>
                  <Button
                    type="button"
                    intent="white-link"
                    size="xs"
                    onClick={() =>
                      setCloneSections(
                        cloneSections.size === CLONE_SECTIONS.length
                          ? new Set()
                          : new Set(CLONE_SECTIONS)
                      )
                    }
                  >
                    {cloneSections.size === CLONE_SECTIONS.length
                      ? 'Select none'
                      : 'Select all'}
                  </Button>
                </div>
                <div className="rounded-[--radius] border border-[--border] divide-y divide-[--border]">
                  {CLONE_SECTIONS.map((section) => (
                    <div key={section} className="px-3 py-2 hover:bg-white/5">
                      <Checkbox
                        label={CLONE_SECTION_LABELS[section]}
                        value={cloneSections.has(section)}
                        onValueChange={(v) =>
                          toggleCloneSection(section, v === true)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!createdCredentials}
        onOpenChange={(o) => !o && setCreatedCredentials(null)}
        title={credentialsModalTitle}
      >
        {createdCredentials && (
          <div className="space-y-4 text-sm">
            <Alert
              intent="alert"
              isClosable={false}
              description="Copy this now — the password can't be shown again."
            />
            <div>
              <div className="text-xs text-[--muted]">UUID</div>
              <div className="flex items-center gap-2">
                <span className="font-mono break-all">
                  {createdCredentials.uuid}
                </span>
                <BiCopy
                  className="min-h-4 min-w-4 cursor-pointer shrink-0"
                  onClick={() => copyField(createdCredentials.uuid, 'UUID')}
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-[--muted]">Password</div>
              <div className="flex items-center gap-2">
                <span className="font-mono break-all">
                  {createdCredentials.password}
                </span>
                <BiCopy
                  className="min-h-4 min-w-4 cursor-pointer shrink-0"
                  onClick={() =>
                    copyField(createdCredentials.password, 'Password')
                  }
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-[--muted]">Manifest URL</div>
              <div className="text-xs text-[--muted] mb-1">
                Give this to the recipient to add the addon in Stremio.
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono break-all text-xs">
                  {manifestUrl}
                </span>
                <BiCopy
                  className="min-h-4 min-w-4 cursor-pointer shrink-0"
                  onClick={() => copyField(manifestUrl, 'Manifest URL')}
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-[--muted]">Configure URL</div>
              <div className="text-xs text-[--muted] mb-1">
                Give this to the recipient so they can view/edit their own
                settings later — no admin login required.
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono break-all text-xs">
                  {configureUrl}
                </span>
                <BiCopy
                  className="min-h-4 min-w-4 cursor-pointer shrink-0"
                  onClick={() => copyField(configureUrl, 'Configure URL')}
                />
              </div>
            </div>
            <Button
              intent="white"
              size="sm"
              onClick={() => (window.location.href = stremioInstallUrl)}
            >
              Install in Stremio (test)
            </Button>
          </div>
        )}
      </Modal>

      <ConfirmationDialog {...confirm} />
      <ConfirmationDialog {...batchConfirm} />

      {/*
        Delete-all-matching dialog. Requires the admin to type DELETE to
        execute — the server side runs an unbounded DELETE on the filter, so a
        plain confirm dialog isn't enough friction.
      */}
      <Modal
        open={allMatchingOpen}
        onOpenChange={setAllMatchingOpen}
        title="Delete all users matching filter"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              intent="gray-outline"
              size="sm"
              onClick={() => setAllMatchingOpen(false)}
            >
              Cancel
            </Button>
            <Button
              intent="alert-subtle"
              size="sm"
              disabled={allMatchingText !== 'DELETE' || batchDel.isPending}
              loading={batchDel.isPending}
              onClick={() => {
                batchDel.mutate({ allMatching: true, q: dq });
                setAllMatchingOpen(false);
              }}
            >
              Delete
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            This permanently deletes <strong>every</strong> user configuration
            matching your current search (
            <code className="font-mono">{dq || '<empty>'}</code>). This cannot
            be undone.
          </p>
          <p className="text-[--muted]">
            Type <code className="font-mono">DELETE</code> to confirm.
          </p>
          <TextInput
            value={allMatchingText}
            onValueChange={setAllMatchingText}
            placeholder="DELETE"
          />
        </div>
      </Modal>
    </PageWrapper>
  );
}
