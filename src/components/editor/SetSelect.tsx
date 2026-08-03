import { useMemo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

import { MAIN_SET_TYPES } from "@/lib/constants";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { ScryfallImg } from "@/components/ScryfallImg";

const SET_ICON_CLASS = "brightness-0 dark:invert";

interface SetSelectProps {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  placeholder?: string;
  showAll?: boolean;
}

export function SetSelect({
  value,
  onChange,
  className,
  placeholder = "Any set",
  showAll = false,
}: SetSelectProps) {
  const sets = useScryfallStore((s) => s.sets);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => {
    if (!sets) return [];
    const filtered = showAll
      ? sets
      : sets.filter((s) => MAIN_SET_TYPES.has(s.set_type) && !s.digital && !s.parent_set_code);
    return [...filtered].sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""));
  }, [sets, showAll]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    );
  }, [sorted, search]);

  const selected = value ? sorted.find((s) => s.code === value) : null;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Reset search and focus input when popover opens.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setSearch("");
    }
  }
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        className={cn(
          "h-7 w-full flex items-center gap-1.5 px-2 text-xs bg-background border rounded hover:bg-muted transition-colors text-left",
          !selected && "text-muted-foreground",
        )}
        onClick={() => setIsOpen((v) => !v)}
      >
        {selected ? (
          <>
            <ScryfallImg
              src={selected.icon_svg_uri}
              alt=""
              className={cn("h-3.5 w-3.5 shrink-0", SET_ICON_CLASS)}
            />
            <span className="flex-1 truncate">{selected.name}</span>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 truncate">{placeholder}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg flex flex-col max-h-72">
          <div className="p-1.5 border-b shrink-0">
            <Input
              ref={inputRef}
              className="h-6 text-xs"
              placeholder="Search sets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <ScrollArea className="flex-1">
            <div className="py-1">
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                  No sets found
                </div>
              )}
              {filtered.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className={cn(
                    "w-full text-left px-2 py-1 text-xs hover:bg-muted flex items-center gap-1.5",
                    value === s.code && "bg-muted",
                  )}
                  onClick={() => {
                    onChange(s.code);
                    setIsOpen(false);
                  }}
                >
                  <ScryfallImg
                    src={s.icon_svg_uri}
                    alt=""
                    className={cn("h-3.5 w-3.5 shrink-0", SET_ICON_CLASS)}
                  />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-[10px] text-muted-foreground uppercase shrink-0">
                    {s.code}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
