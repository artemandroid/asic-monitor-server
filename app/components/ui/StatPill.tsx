import { Box, type BoxProps } from "@mui/material";
import type { ReactNode } from "react";

interface StatPillProps extends Omit<BoxProps, "border" | "borderColor"> {
  borderColor: string;
  gap?: number;
  children: ReactNode;
}

export function StatPill({ borderColor, gap = 0.6, sx, children, ...props }: StatPillProps) {
  return (
    <Box
      sx={[
        {
          px: 0.9,
          py: 0.35,
          borderRadius: 1.2,
          border: `1px solid ${borderColor}`,
          display: "inline-flex",
          alignItems: "center",
          gap,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      {...props}
    >
      {children}
    </Box>
  );
}
