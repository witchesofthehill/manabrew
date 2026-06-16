interface PromptHintProps {
  text: string;
}

export function PromptHint({ text }: PromptHintProps) {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}
