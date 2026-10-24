"use client";

import { useRef, useState } from "react";
import { FileUp, Link2, Plus } from "lucide-react";
import { api, ApiClientError } from "@/lib/client/api";
import { Button, Input } from "@/components/ui/controls";
import { cn } from "@/lib/client/utils";

export function ImportBar({
  groupId,
  onImported,
}: {
  groupId: string | null;
  onImported: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"arxiv" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!groupId) return null;

  async function importArxiv() {
    if (!url.trim() || !groupId) return;
    setBusy("arxiv");
    setError(null);
    try {
      await api.importArxiv(groupId, { url: url.trim() });
      setUrl("");
      onImported();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    if (!groupId) return;
    setBusy("upload");
    setError(null);
    try {
      await api.uploadPaper(groupId, file, { tags: [] });
      onImported();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Upload failed");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="border-b border-line px-3 pb-3">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Link2 size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && importArxiv()}
            placeholder="arXiv URL or id"
            className="h-8 pl-7 text-xs"
            disabled={busy !== null}
          />
        </div>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          onClick={importArxiv}
          disabled={!url.trim() || busy !== null}
          title="Import from arXiv"
        >
          <Plus size={14} />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          title="Upload a PDF"
        >
          <FileUp size={14} className={cn(busy === "upload" && "animate-pulse")} />
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </div>
      {error && <p className="mt-1.5 text-[11px] leading-4 text-danger">{error}</p>}
    </div>
  );
}
