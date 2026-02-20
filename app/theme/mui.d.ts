import "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Palette {
    custom: {
      chipTextOnSuccess: string;
      deyeNeutralGray: string;
      deyeFullBlue: string;
      deyeNegativeRed: string;
    };
  }

  interface PaletteOptions {
    custom?: {
      chipTextOnSuccess?: string;
      deyeNeutralGray?: string;
      deyeFullBlue?: string;
      deyeNegativeRed?: string;
    };
  }
}

