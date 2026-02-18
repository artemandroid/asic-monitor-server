import type { SVGProps } from "react";

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4 12a8 8 0 0 1 .2-1.8l-2-1.2 2-3.4 2.3.7a8.2 8.2 0 0 1 3-1.7l.4-2.4h4.2l.4 2.4a8.2 8.2 0 0 1 3 1.7l2.3-.7 2 3.4-2 1.2A8 8 0 0 1 20 12c0 .6-.1 1.2-.2 1.8l2 1.2-2 3.4-2.3-.7a8.2 8.2 0 0 1-3 1.7l-.4 2.4H9.9l-.4-2.4a8.2 8.2 0 0 1-3-1.7l-2.3.7-2-3.4 2-1.2A8 8 0 0 1 4 12Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}
