import { Paper, type PaperProps } from "@mui/material";

export function SectionPaper({ sx, ...props }: PaperProps) {
  return (
    <Paper
      sx={[{ p: 1.25 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      {...props}
    />
  );
}
