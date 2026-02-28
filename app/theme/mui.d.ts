import "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Theme {
    app: {
      header: {
        controlSize: number;
        logoSize: number;
        gap: number;
        iconSizeDefault: number;
        iconSizeTheme: number;
        language: {
          triggerRadiusClosed: number;
          triggerRadiusOpen: string;
          menuRadius: string;
          itemHeight: number;
          itemRadius: number;
          itemFontWeight: number;
        };
      };
    };
  }

  interface ThemeOptions {
    app?: {
      header?: {
        controlSize?: number;
        logoSize?: number;
        gap?: number;
        iconSizeDefault?: number;
        iconSizeTheme?: number;
        language?: {
          triggerRadiusClosed?: number;
          triggerRadiusOpen?: string;
          menuRadius?: string;
          itemHeight?: number;
          itemRadius?: number;
          itemFontWeight?: number;
        };
      };
    };
  }

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
