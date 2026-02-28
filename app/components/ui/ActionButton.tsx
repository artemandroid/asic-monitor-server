import { Button, type ButtonProps } from "@mui/material";

const rootSx = {
  borderRadius: "8px",
  "&.Mui-disabled": {
    backgroundColor: "transparent",
    color: "#9ca3af",
    borderColor: "#d1d5db",
  },
} as const;

export interface ActionButtonProps extends ButtonProps {
  minWidth?: number;
}

export function ActionButton({ minWidth = 86, sx, ...props }: ActionButtonProps) {
  return (
    <Button
      size="small"
      sx={[{ minWidth }, rootSx, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      {...props}
    />
  );
}
