"use client";

import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import type { GroupDetail, GroupRole } from "@/contracts";
import { Badge, Spinner } from "@/components/ui/atoms";
import { Button, Field, Input, Textarea } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/overlay";
import { ApiClientError, api } from "@/lib/client/api";

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function GroupSettings({
  groupId,
  userId,
  open,
  onClose,
  onChanged,
}: {
  groupId: string;
  userId: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    setGroup(null);
    api
      .getGroup(groupId)
      .then(({ group: detail }) => {
        if (!current) return;
        setGroup(detail);
        setName(detail.name);
        setDescription(detail.description);
      })
      .catch((cause: unknown) => {
        if (current) setError(errorMessage(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [groupId, open]);

  async function reloadGroup() {
    const { group: detail } = await api.getGroup(groupId);
    setGroup(detail);
    setName(detail.name);
    setDescription(detail.description);
  }

  async function saveGroup() {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const { group: updated } = await api.updateGroup(groupId, { name, description });
      setGroup((current) => (current ? { ...current, ...updated } : current));
      setNotice("Group settings saved.");
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function rotateInvite() {
    if (!window.confirm("The old code will stop working.")) return;
    setBusy("rotate");
    setError(null);
    setNotice(null);
    try {
      const { inviteCode } = await api.rotateInviteCode(groupId);
      setGroup((current) => (current ? { ...current, inviteCode } : current));
      setNotice("Invite code rotated.");
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(memberId: string, role: GroupRole) {
    setBusy(`role:${memberId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await api.setMemberRole(groupId, memberId, { role });
      setGroup(result.group);
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(memberId: string, displayName: string) {
    if (!window.confirm(`Remove ${displayName} from this group?`)) return;
    setBusy(`remove:${memberId}`);
    setError(null);
    setNotice(null);
    try {
      await api.removeMember(groupId, memberId);
      await reloadGroup();
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function leaveGroup() {
    if (!window.confirm("Leave this group?")) return;
    setBusy("leave");
    setError(null);
    setNotice(null);
    try {
      const { result } = await api.leaveGroup(groupId);
      onChanged();
      setNotice(result === "deleted" ? "The group was deleted." : "You left the group.");
      window.setTimeout(() => router.replace("/"), 800);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(null);
    }
  }

  async function copyInviteCode() {
    if (!group) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(group.inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  const isOwner = group?.myRole === "owner";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Group settings"
      width="max-w-lg max-h-[90vh] overflow-y-auto"
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} />
        </div>
      ) : group ? (
        <div className="space-y-5">
          {isOwner ? (
            <div className="space-y-3">
              <Field label="Group name">
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="Description">
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
              </Field>
              <Button size="sm" disabled={busy !== null} onClick={saveGroup}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </Button>
            </div>
          ) : (
            <div>
              <h3 className="font-medium">{group.name}</h3>
              {group.description && <p className="mt-1 text-sm text-muted">{group.description}</p>}
            </div>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Invite code</h3>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-md bg-surface-2 px-3 py-2 font-mono text-sm">
                {group.inviteCode}
              </code>
              <Button size="sm" variant="outline" onClick={copyInviteCode} aria-label="Copy invite code">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </Button>
              {isOwner && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={rotateInvite}
                  aria-label="Rotate invite code"
                >
                  <RefreshCw size={14} /> Rotate
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
              Members ({group.members.length})
            </h3>
            <ul className="divide-y divide-line rounded-md border border-line">
              {group.members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{member.displayName}</span>
                  <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                    {member.role === "owner" && <Shield size={11} />}
                    {member.role}
                  </Badge>
                  {isOwner && member.id !== userId && (
                    <div className="flex gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() =>
                          changeRole(member.id, member.role === "owner" ? "member" : "owner")
                        }
                      >
                        Make {member.role === "owner" ? "member" : "owner"}
                      </Button>
                      <Button
                        size="xs"
                        variant="danger"
                        disabled={busy !== null}
                        onClick={() => removeMember(member.id, member.displayName)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <div className="border-t border-line pt-4">
            <Button
              variant="danger"
              size="sm"
              disabled={busy !== null}
              onClick={leaveGroup}
            >
              Leave group
            </Button>
          </div>
        </div>
      ) : null}
      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {notice && <p className="mt-4 rounded-md bg-ok-soft px-3 py-2 text-[13px] text-ok">{notice}</p>}
    </Dialog>
  );
}
