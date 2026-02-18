import type { SVGProps } from "react";

type ButtonSpinnerIconProps = SVGProps<SVGSVGElement> & {
  color?: string;
};

export function ButtonSpinnerIcon({ color = "currentColor", ...props }: ButtonSpinnerIconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke={color} strokeWidth="3" strokeLinecap="round" fill="none">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
