const PATHS: Record<string, string> = {
  plot: "M3 3v18h18M7 15l4-5 3 3 5-7",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M9 6l6 6-6 6",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3",
  pause: "M8 5v14M16 5v14",
  play: "M7 5l12 7-12 7z",
  logs: "M4 6h16M4 12h16M4 18h10",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  graph: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 7.2l6.8 9.6M9 6h6",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  refresh: "M20 11a8 8 0 1 0-2.3 6.3M20 4v7h-7",
  split: "M4 4h16v16H4zM4 12h16",
  layout: "M3 3h18v18H3zM3 9h18M9 9v12",
  ok: "M5 12.5l4.5 4.5L19 7.5",
  warn: "M12 3l10 18H2zM12 10v5M12 18v.5",
  error: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v6M12 16.5v.5",
  stale: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2",
};

export function Icon({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
