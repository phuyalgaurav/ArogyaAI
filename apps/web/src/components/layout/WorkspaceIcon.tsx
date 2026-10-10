const paths = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3z",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  image: "M4 3h12l4 4v14H4z M14 3v5h6 M7 15l3-3 3 3 2-2 2 4H7z",
  medicine: "M8 3h8v4H8z M7 7h10v14H7z M9 11h6 M12 9v4",
  library: "M3 5h7l2 2 2-2h7v15h-7l-2 2-2-2H3z M12 7v15",
  ask: "M3 4h18v13H8l-5 4z M7 8h10 M7 12h7",
  language:
    "M3 5h11 M8 3v2 M5 5c0 5 4 8 8 9 M12 5c0 5-4 8-9 9 M14 21l4-11 4 11 M15 18h6",
  engines: "M3 17h3V9H3z M10 17h3V3h-3z M17 17h3V6h-3z M2 21h20",
  privacy: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  send: "M12 20V4 M5 11l7-7 7 7",
  stop: "M6 6h12v12H6z",
  microphone:
    "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8",
};

export function WorkspaceIcon({
  name,
  size = 24,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
