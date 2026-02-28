import { Chip, type ChipProps } from "@mui/material";
import { useTheme } from "@mui/material/styles";

export interface StatusChipProps extends ChipProps {
  /** true = active/on, false = inactive/off, null/undefined = unknown */
  isActive: boolean | null | undefined;
  /** Add overflow ellipsis to the label */
  truncate?: boolean;
}

export function StatusChip({ isActive, truncate, color, variant, sx, ...props }: StatusChipProps) {
  const theme = useTheme();
  const greenText = theme.palette.custom.chipTextOnSuccess;

  return (
    <Chip
      size="small"
      color={color ?? (isActive === true ? "success" : "default")}
      variant={variant ?? (isActive === true ? "filled" : "outlined")}
      sx={[
        {
          fontWeight: 700,
          borderWidth: isActive === false ? 2 : undefined,
          color: isActive === true ? greenText : undefined,
          "& .MuiChip-label": {
            fontWeight: 700,
            color: isActive === true ? greenText : undefined,
            ...(truncate
              ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
              : {}),
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      {...props}
    />
  );
}
