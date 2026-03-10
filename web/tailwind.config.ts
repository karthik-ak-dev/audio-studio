import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        bg: {
          DEFAULT: "#080e10",
          surface: "#1f3338",
          card: "rgba(232,243,245,0.04)",
          elevated: "#233b41",
        },
        accent: {
          DEFAULT: "#8cff05",
          glow: "rgba(140,255,5,0.4)",
        },
        text: {
          DEFAULT: "#e8f3f5",
          muted: "#7b9fa8",
        },
        border: {
          DEFAULT: "rgba(65,95,102,0.4)",
        },
        gold: "#ffd700",
        silver: "#c0c0c0",
      },
      maxWidth: {
        container: "1400px",
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
      },
      boxShadow: {
        glow: "0 0 12px rgba(140,255,5,0.4)",
        "glow-sm": "0 0 8px rgba(140,255,5,0.3)",
        "glow-lg": "0 0 24px rgba(140,255,5,0.5)",
        elevated: "0 25px 50px -12px rgb(0 0 0 / 0.25)",
      },
      backdropBlur: {
        md: "12px",
        xl: "24px",
      },
      keyframes: {
        "slide-up": {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(1.4)", opacity: "0" },
        },
      },
      animation: {
        "slide-up": "slide-up 0.4s ease-out",
        shimmer: "shimmer 2s infinite",
        blink: "blink 1.2s ease-in-out infinite",
        "pulse-ring": "pulse-ring 1.5s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
