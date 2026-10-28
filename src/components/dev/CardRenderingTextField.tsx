import { useState } from "react";
import { Input } from "@/components/ui/input";

interface CardRenderingTextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
}

export function CardRenderingTextField({
  label,
  value,
  onChange,
  placeholder,
  numeric = false,
}: CardRenderingTextFieldProps) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  return (
    <label className="grid gap-1.5 text-ui-label font-medium text-muted-foreground">
      {label}
      <Input
        aria-label={label}
        value={editing ? draft : value}
        placeholder={placeholder}
        inputMode={numeric ? "numeric" : undefined}
        onFocus={() => {
          setDraft(value);
          setEditing(true);
        }}
        onBlur={() => setEditing(false)}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
      />
    </label>
  );
}
