type PanelIconName = "git" | "compare" | "folder" | "file" | "sidebar";

export function PanelIcon({ name }: { name: PanelIconName }) {
  const className = "h-4 w-4 shrink-0";

  if (name === "git") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M12 3v13" />
        <path d="M7 8h8" />
        <circle cx="12" cy="18" r="3" />
      </svg>
    );
  }

  if (name === "compare") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M8 4H5a1 1 0 0 0-1 1v3" />
        <path d="M16 20h3a1 1 0 0 0 1-1v-3" />
        <path d="M4 9l5-5" />
        <path d="M20 15l-5 5" />
        <path d="M15 4h4a1 1 0 0 1 1 1v4" />
        <path d="M9 20H5a1 1 0 0 1-1-1v-4" />
      </svg>
    );
  }

  if (name === "folder") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      </svg>
    );
  }

  if (name === "file") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M7 3.5h7l4 4v13A1.5 1.5 0 0 1 16.5 22h-9A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4z" />
        <path d="M14 3v5h5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M4 6h16" />
      <path d="M4 12h10" />
      <path d="M4 18h16" />
    </svg>
  );
}
