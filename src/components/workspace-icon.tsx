const paths = {
  money: "M3 5h18v14H3zM16 12h5M8 9v6M6 11h4",
  home: "M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10",
  customers:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  work: "M8 7V4h8v3M3 7h18v14H3zM3 12h18M10 12v3h4v-3",
  schedule: "M8 2v4M16 2v4M3 10h18M3 4h18v18H3zM7 14h3M14 14h3M7 18h3",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  edit: "m16 3 5 5M3 21l5-1L21 7l-5-5L3 15z",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
} as const;
export function WorkspaceIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
