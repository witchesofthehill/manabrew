import { Children, Fragment, isValidElement, useState } from "react";
import type { ReactNode } from "react";

export function ChoicePages({ children }: { children: ReactNode }) {
  const [page, setPage] = useState(0);
  const content =
    isValidElement<{ children: ReactNode }>(children) && children.type === Fragment
      ? children.props.children
      : children;
  const items = Children.toArray(content);
  if (items.length <= 5) return <>{items}</>;
  const options = items.slice(1, -1);
  const total = Math.ceil(options.length / 3);
  const current = Math.min(page, total - 1);
  return (
    <>
      {items[0]}
      {options.slice(current * 3, current * 3 + 3)}
      <div className="duel-choice-pages">
        <button
          aria-label="Previous choices"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          ‹
        </button>
        <span>
          {current + 1} / {total}
        </span>
        <button
          aria-label="Next choices"
          disabled={current === total - 1}
          onClick={() => setPage(current + 1)}
        >
          ›
        </button>
      </div>
      {items.at(-1)}
    </>
  );
}
