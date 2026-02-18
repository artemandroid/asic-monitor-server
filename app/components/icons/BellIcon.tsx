import type { SVGProps } from "react";

export function BellIcon(props: SVGProps<SVGSVGElement>) {
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
        d="M6 9a6 6 0 1 1 12 0c0 3 1 4 2 5H4c1-1 2-2 2-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 19a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
