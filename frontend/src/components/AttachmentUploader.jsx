import React, { useRef, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Paperclip, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Minimal reusable attachment uploader.
 * Props:
 *  - attachments: [{id, path, filename, content_type, size}]
 *  - onChange(newList)
 *  - accept?: default `image/*,application/pdf`
 *  - testId?: base for data-testid
 */
export default function AttachmentUploader({ attachments = [], onChange, accept = "image/*,application/pdf", testId = "attach" }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = () => inputRef.current?.click();

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    const uploaded = [];
    for (const f of files) {
      const form = new FormData();
      form.append("file", f);
      try {
        const { data } = await api.post("/files/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        uploaded.push(data);
      } catch (err) {
        toast.error(`${f.name}: ${formatError(err)}`);
      }
    }
    if (uploaded.length) onChange([...(attachments || []), ...uploaded]);
    if (inputRef.current) inputRef.current.value = "";
    setBusy(false);
  };

  const remove = (id) => {
    onChange((attachments || []).filter((a) => a.id !== id));
  };

  return (
    <div className="space-y-2" data-testid={testId}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        onChange={upload}
        className="hidden"
        data-testid={`${testId}-input`}
      />
      <Button
        type="button"
        variant="outline"
        onClick={pick}
        disabled={busy}
        className="rounded-none w-full"
        data-testid={`${testId}-pick`}
      >
        {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Paperclip size={14} className="mr-1" />}
        {busy ? "Uploading…" : "Add file(s)"}
      </Button>
      {(attachments || []).length > 0 && (
        <ul className="space-y-1">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center justify-between bg-gray-50 border border-[var(--border)] px-2 py-1 text-xs" data-testid={`${testId}-item-${a.id}`}>
              <span className="truncate flex-1 min-w-0">
                <Paperclip size={12} className="inline mr-1 text-[var(--muted)]" />
                {a.filename}
                {a.size && <span className="text-[var(--muted)] ml-2">({Math.round(a.size / 1024)} KB)</span>}
              </span>
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="text-red-600 hover:text-red-700 shrink-0"
                data-testid={`${testId}-remove-${a.id}`}
                aria-label="Remove attachment"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
