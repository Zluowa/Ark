// @input: onSubmit callback, value/onChange state from parent
// @output: input box with file upload and send button
// @position: center of agent page, always visible

"use client";

import { useRef } from "react";
import { Paperclip, ArrowUp } from "lucide-react";

interface ToolInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (input: string, file?: File) => void;
  disabled?: boolean;
}

export function ToolInput({ value, onChange, onSubmit, disabled }: ToolInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) onSubmit(value.trim());
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onSubmit(value || file.name, file);
  }

  return (
    <div className="w-full overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(120,197,249,0.14),transparent_24%),linear-gradient(180deg,rgba(8,12,18,0.98),rgba(5,8,12,0.98))] shadow-[0_24px_80px_rgba(0,0,0,0.35)] transition-[border-color,box-shadow] focus-within:border-sky-300/60 focus-within:shadow-[0_24px_90px_rgba(8,145,178,0.16)]">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe the tool outcome you want. Add 16:9 / 9:16 / 4:5, or upload a file to transform..."
        disabled={disabled}
        rows={4}
        className="w-full resize-none bg-transparent px-5 pt-5 pb-3 text-[15px] leading-6 text-white placeholder:text-zinc-500 focus:outline-none disabled:opacity-50"
      />

      <div className="flex items-center justify-between border-white/8 border-t px-4 pb-4 pt-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-2xl border border-white/8 bg-white/5 p-2.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Paperclip className="size-4" />
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} />

        <button
          type="button"
          onClick={() => value.trim() && onSubmit(value.trim())}
          disabled={disabled || !value.trim()}
          className="flex size-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0ea5e9,#22c55e)] text-white shadow-[0_10px_30px_rgba(14,165,233,0.3)] transition-[transform,opacity] hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowUp className="size-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
