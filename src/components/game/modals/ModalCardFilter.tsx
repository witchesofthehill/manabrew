import { useEffect, useRef } from "react";
import { MODAL_INPUT } from "../game.styles";

interface ModalCardFilterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function ModalCardFilter({
  value,
  onChange,
  placeholder = "Filter cards...",
  autoFocus = false,
}: ModalCardFilterProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="px-4 pb-2">
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={MODAL_INPUT}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    </div>
  );
}
