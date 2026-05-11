"use client";

import { useState } from "react";

export function LazyDetails({
  summary,
  children,
  className,
  defaultOpen = false,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      open={defaultOpen}
      className={className}
      onToggle={(event) => {
        setIsOpen((event.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary className="cursor-pointer list-none">{summary}</summary>
      {isOpen ? children : null}
    </details>
  );
}
