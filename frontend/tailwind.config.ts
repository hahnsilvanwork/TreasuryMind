import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        base:    "#06090F",
        surface: "#0C1220",
        card:    "#111827",
        card2:   "#162033",
        slate: {
          925: "#0C1220",
          950: "#06090F",
        },
        blue: {
          400: "#7BA8FF",
          500: "#4F7FFF",
          600: "#3A6AE8",
          900: "rgba(79,127,255,0.12)",
        },
        gold: {
          400: "#FBBF3A",
          500: "#F5A623",
          900: "rgba(245,166,35,0.12)",
        },
        green: {
          500: "#10B981",
          900: "rgba(16,185,129,0.12)",
        },
        red: {
          500: "#FF4757",
          900: "rgba(255,71,87,0.12)",
        },
        purple: {
          500: "#7C5CFC",
          900: "rgba(124,92,252,0.12)",
        },
      },
      fontFamily: {
        display: ["Syne", "sans-serif"],
        sans:    ["DM Sans", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", "15px"],
        xs:    ["12px", "16px"],
        sm:    ["13px", "20px"],
        base:  ["14px", "21px"],
        md:    ["15px", "22px"],
        lg:    ["16px", "24px"],
        xl:    ["18px", "26px"],
        "2xl": ["22px", "30px"],
        "3xl": ["28px", "36px"],
        "4xl": ["36px", "42px"],
      },
      borderRadius: {
        sm:  "6px",
        DEFAULT: "8px",
        md:  "10px",
        lg:  "14px",
        xl:  "18px",
        "2xl": "24px",
      },
      boxShadow: {
        card:  "0 2px 12px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.2)",
        blue:  "0 0 20px rgba(79,127,255,0.15), 0 0 60px rgba(79,127,255,0.05)",
        gold:  "0 0 20px rgba(245,166,35,0.2)",
        green: "0 0 20px rgba(16,185,129,0.15)",
        red:   "0 0 20px rgba(255,71,87,0.15)",
        glow:  "0 0 0 1px rgba(79,127,255,0.15), 0 8px 32px rgba(0,0,0,0.4)",
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "spin-slow":  "spin 3s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
