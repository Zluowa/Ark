// @input: onSelect callback
// @output: row of clickable hot tool tags with real working examples
// @position: below input box on agent page

"use client";

interface HotTagsProps {
  onSelect: (tag: string) => void;
  onSubmit?: (tag: string) => void;
}

const TAGS = [
  "hash md5 hello world",
  "sha256 my secret data",
  "base64 encode Hello OmniAgent",
  "generate uuid",
  "generate password",
  'json to yaml {"name":"test"}',
  "url encode https://example.com?q=hello world",
  "dns lookup google.com",
];

export function HotTags({ onSelect, onSubmit }: HotTagsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {TAGS.map((tag) => (
        <button
          key={tag}
          onClick={() => onSubmit ? onSubmit(tag) : onSelect(tag)}
          className="rounded-full border border-zinc-800/60 px-3.5 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
