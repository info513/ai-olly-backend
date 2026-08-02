import type { Config } from "tailwindcss";

/**
 * AI OLLY Design System — token bindings.
 * Values live as CSS variables in globals.css (dark-mode-first). Tailwind maps
 * semantic names onto them so components consume tokens, never raw hex.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          base: "var(--surface-base)",
          raised: "var(--surface-raised)",
          overlay: "var(--surface-overlay)",
          sunken: "var(--surface-sunken)",
        },
        border: {
          subtle: "var(--border-subtle)",
          strong: "var(--border-strong)",
        },
        ink: {
          primary: "var(--ink-primary)",
          secondary: "var(--ink-secondary)",
          tertiary: "var(--ink-tertiary)",
          disabled: "var(--ink-disabled)",
        },
        brand: {
          navy: "var(--brand-navy)",
          navyDeep: "var(--brand-navy-deep)",
          navySoft: "var(--brand-navy-soft)",
          cream: "var(--brand-cream)",
          creamSoft: "var(--brand-cream-soft)",
          goldDeep: "var(--brand-gold-deep)",
        },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        ai: {
          confident: "var(--ai-confident)",
          handoff: "var(--ai-handoff)",
          unknown: "var(--ai-unknown)",
        },
        // shadcn-compatible aliases (so primitives read naturally)
        background: "var(--surface-base)",
        foreground: "var(--ink-primary)",
        ring: "var(--brand-gold-deep)",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "20px",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        e1: "0 1px 2px rgba(0,0,0,0.25), 0 0 0 1px var(--border-subtle)",
        e2: "0 10px 30px -10px rgba(0,0,0,0.55), 0 0 0 1px var(--border-subtle)",
        e3: "0 24px 60px -12px rgba(0,0,0,0.65), 0 0 0 1px var(--border-strong)",
        glow: "0 0 0 3px color-mix(in srgb, var(--brand-gold-deep) 40%, transparent)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-up": "slide-up 240ms ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
