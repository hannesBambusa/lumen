/**
 * Hand-drawn 16px icons on a 16 grid, stroked not filled, so they sit at the same visual
 * weight as the label beside them. No icon library: eight icons is not worth a dependency,
 * and a library's grid would not match this one.
 */

const COMMON = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function InboxIcon() {
  return (
    <svg {...COMMON}>
      <path d="M2 9.5h3l1 2h4l1-2h3" />
      <path d="M3.4 3h9.2l1.4 6.5v2.9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.5L3.4 3Z" />
    </svg>
  );
}

export function SentIcon() {
  return (
    <svg {...COMMON}>
      <path d="M14 2 7 9" />
      <path d="M14 2 9.5 14 7 9 2 6.5 14 2Z" />
    </svg>
  );
}

export function DraftIcon() {
  return (
    <svg {...COMMON}>
      <path d="M11 2.5 13.5 5 6 12.5l-3.2.7.7-3.2L11 2.5Z" />
    </svg>
  );
}

export function ArchiveIcon() {
  return (
    <svg {...COMMON}>
      <path d="M2 5.5h12V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5Z" />
      <path d="M1.5 3h13v2.5h-13zM6.5 8.5h3" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...COMMON}>
      <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5 4.7 13a1 1 0 0 0 1 1h4.6a1 1 0 0 0 1-1L12 4.5" />
    </svg>
  );
}

export function NowIcon() {
  return (
    <svg {...COMMON}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8l2.2 1.6" />
    </svg>
  );
}

export function PeopleIcon() {
  return (
    <svg {...COMMON}>
      <circle cx="6.2" cy="6" r="2.6" />
      <path d="M1.8 13.4c.5-2.2 2.3-3.5 4.4-3.5s3.9 1.3 4.4 3.5" />
      <path d="M10.8 3.7a2.6 2.6 0 0 1 0 4.6M12 9.9c1.3.4 2.2 1.6 2.5 3.1" />
    </svg>
  );
}

export function FilesIcon() {
  return (
    <svg {...COMMON}>
      <path d="M9 1.8H4.5a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.3L9 1.8Z" />
      <path d="M8.8 2v3.2h3.4" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg {...COMMON}>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </svg>
  );
}
