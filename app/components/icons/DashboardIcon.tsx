import type { SVGProps } from "react";

export function DashboardIcon(props: SVGProps<SVGSVGElement>) {
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
        d="M3 13a8 8 0 1 1 16 0v6a2 2 0 0 1-2 2H7a4 4 0 0 1-4-4v-4Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M9 13a3 3 0 0 1 6 0"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
