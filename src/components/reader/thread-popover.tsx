"use client";

import { useState } from "react";
import { Eye, EyeOff, MessageSquare, PanelRightOpen, Pencil, Reply, Trash2 } from "lucide-react";
import type { z } from "zod";
import type { Annotation, Comment } from "@/contracts";
import { AnnotationColor, AnnotationVisibility } from "@/contracts";
import { api } from "@/lib/client/api";
import type { SessionUser } from "@/lib/client/auth";
import { ANNOTATION_COLORS, annotationColorCss, authorColor, cn, relativeTime, truncate } from "@/lib/client/utils";
import { Avatar, Badge } from "@/components/ui/atoms";
import { Button, Textarea } from "@/components/ui/controls";
import { Popover } from "@/components/ui/overlay";

type AnnotationColorT = z.infer<typeof AnnotationColor>;
type AnnotationVisibilityT = z.infer<typeof AnnotationVisibility>;

export function SelectionToolbar({
  x,
  y,
  onAnnotate,
  onClose,
  error,
}: {
  x: number;
  y: number;
  onAnnotate: (opts: { color: AnnotationColorT; visibility: AnnotationVisibilityT; withComment: boolean; body?: string }) => void;
  onClose: () => void;
  error?: string | null;
}) {
  const [color, setColor] = useState<AnnotationColorT>("yellow");
  const [visibility, setVisibility] = useState<AnnotationVisibilityT>("group");
  const [commentMode, setCommentMode] = useState(false);
  const [body, setBody] = useState("");

  return (
    <Popover anchor={{ x, y }} onClose={onClose} width={commentMode ? 320 : 252}>
      <div className="p-2">
        <div className="flex items-center gap-1.5">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c.name}
              className={cn(
                "h-5 w-5 rounded-full border-2 transition-transform",
                color === c.name ? "scale-110 border-ink" : "border-transparent",
              )}
              style={{ background: c.css }}
              title={c.name}
              onClick={() => setColor(c.name)}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          <button
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium",
              visibility === "private" ? "bg-warn-soft text-warn" : "text-muted hover:text-ink",
            )}
            onClick={() => setVisibility(visibility === "group" ? "private" : "group")}
            title={visibility === "private" ? "Only you can see this" : "Visible to the group"}
          >
            {visibility === "private" ? <EyeOff size={12} /> : <Eye size={12} />}
            {visibility === "private" ? "Private" : "Group"}
          </button>
          <button
            className={cn(
              "ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium",
              commentMode ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink",
            )}
            onClick={() => setCommentMode((v) => !v)}
            title="Add a comment"
          >
            <MessageSquare size={12} />
          </button>
        </div>
        {error && <p className="mt-1.5 text-[11px] leading-4 text-danger">{error}</p>}
        {commentMode && (
          <>
            <Textarea
              autoFocus
              rows={2}
              className="mt-2 text-[13px]"
              placeholder="Comment on this passage…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  onAnnotate({ color, visibility, withComment: true, body });
                }
              }}
            />
            <div className="mt-1.5 flex justify-end">
              <Button
                size="xs"
                disabled={!body.trim()}
                onClick={() => onAnnotate({ color, visibility, withComment: true, body })}
              >
                Save note
              </Button>
            </div>
          </>
        )}
        {!commentMode && (
          <div className="mt-1.5 flex justify-end">
            <Button size="xs" onClick={() => onAnnotate({ color, visibility, withComment: false })}>
              Highlight
            </Button>
          </div>
        )}
      </div>
    </Popover>
  );
}

function CommentRow({
  comment,
  user,
  onChanged,
}: {
  comment: Comment;
  user: SessionUser;
  onChanged: () => void;
}) {
  const mine = comment.author.id === user.id;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.body);

  if (comment.deleted) {
    return <p className="text-xs italic text-muted">— deleted —</p>;
  }

  return (
    <div className="group">
      <div className="flex items-center gap-1.5">
        <Avatar name={comment.author.displayName} color={authorColor(comment.author.id)} size={18} />
        <span className="text-xs font-medium">{comment.author.displayName}</span>
        <span className="text-[10px] text-muted">{relativeTime(comment.createdAt)}</span>
        {mine && !editing && (
          <span className="ml-auto hidden gap-0.5 group-hover:flex">
            <button className="rounded p-1 text-muted hover:text-ink" title="Edit" onClick={() => setEditing(true)}>
              <Pencil size={11} />
            </button>
            <button
              className="rounded p-1 text-muted hover:text-danger"
              title="Delete"
              onClick={async () => {
                await api.deleteComment(comment.id);
                onChanged();
              }}
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-1">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} className="text-[13px]" />
          <div className="mt-1 flex gap-1.5">
            <Button
              size="xs"
              disabled={!text.trim()}
              onClick={async () => {
                await api.updateComment(comment.id, { body: text.trim() });
                setEditing(false);
                onChanged();
              }}
            >
              Save
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 pl-6 text-[13px] leading-5 text-ink-soft">{comment.body}</p>
      )}
    </div>
  );
}

export function ThreadPopover({
  annotation,
  user,
  anchor,
  onClose,
  onChanged,
  onPinToPanel,
}: {
  annotation: Annotation;
  user: SessionUser;
  anchor: { x: number; y: number };
  onClose: () => void;
  onChanged: () => void;
  onPinToPanel: () => void;
}) {
  const mine = annotation.author.id === user.id;
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(parentId?: string) {
    if (!replyText.trim()) return;
    setBusy(true);
    try {
      await api.createComment(annotation.id, { body: replyText.trim(), parentId });
      setReplyText("");
      setReplyTo(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover anchor={anchor} onClose={onClose} width={360}>
      <div className="max-h-[60vh] overflow-y-auto">
        <div className="border-b border-line px-3.5 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: annotationColorCss(annotation.color) }} />
            <span className="text-xs font-medium">{annotation.author.displayName}</span>
            <Badge tone={annotation.visibility === "private" ? "warn" : "neutral"}>
              {annotation.visibility === "private" ? "private" : "group"}
            </Badge>
            <span className="ml-auto flex items-center gap-0.5">
              <button
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-muted hover:text-ink"
                onClick={onPinToPanel}
                title="Pin to side panel"
              >
                <PanelRightOpen size={13} /> Panel
              </button>
              {mine && (
                <button
                  className="rounded p-1 text-muted hover:text-danger"
                  title="Delete annotation"
                  onClick={async () => {
                    await api.deleteAnnotation(annotation.id);
                    onChanged();
                    onClose();
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-3 border-l-2 pl-2 text-[12px] italic leading-5 text-ink-soft" style={{ borderColor: annotationColorCss(annotation.color) }}>
            “{truncate(annotation.anchor.quote.exact, 180)}”
          </p>
        </div>

        <div className="space-y-3 px-3.5 py-3">
          {annotation.comments.length === 0 && (
            <p className="text-xs text-muted">No comments yet — start the thread below.</p>
          )}
          {annotation.comments.map((thread) => (
            <div key={thread.id} className="space-y-2.5">
              <CommentRow comment={thread} user={user} onChanged={onChanged} />
              {!thread.deleted && (
                <button
                  className="flex items-center gap-1 pl-6 text-[11px] font-medium text-muted hover:text-accent"
                  onClick={() => setReplyTo(replyTo === thread.id ? null : thread.id)}
                >
                  <Reply size={11} /> Reply
                </button>
              )}
              {replyTo === thread.id && (
                <div className="pl-6">
                  <Textarea
                    autoFocus
                    rows={2}
                    className="text-[13px]"
                    placeholder={`Reply to ${thread.author.displayName}…`}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                  />
                  <div className="mt-1 flex gap-1.5">
                    <Button size="xs" disabled={busy || !replyText.trim()} onClick={() => post(thread.id)}>
                      Reply
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setReplyTo(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-2.5 border-l border-line pl-6">
                {thread.replies.map((r) => (
                  <CommentRow key={r.id} comment={r} user={user} onChanged={onChanged} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {replyTo === null && (
          <div className="border-t border-line px-3.5 py-2.5">
            <Textarea
              rows={2}
              className="text-[13px]"
              placeholder="Add a comment…"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
            <div className="mt-1.5 flex justify-end">
              <Button size="xs" disabled={busy || !replyText.trim()} onClick={() => post()}>
                Comment
              </Button>
            </div>
          </div>
        )}
      </div>
    </Popover>
  );
}
