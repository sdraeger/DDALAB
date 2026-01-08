/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      /* Motion Design System - Apple-inspired easing and timing */
      transitionTimingFunction: {
        "smooth-out":
          "cubic-bezier(0.16, 1, 0.3, 1)" /* Things entering - decelerates into place */,
        "smooth-in":
          "cubic-bezier(0.7, 0, 0.84, 0)" /* Things leaving - accelerates away */,
        "smooth-in-out":
          "cubic-bezier(0.87, 0, 0.13, 1)" /* Things moving - symmetric */,
        spring:
          "cubic-bezier(0.34, 1.56, 0.64, 1)" /* Playful bounce - use sparingly */,
      },
      transitionDuration: {
        fast: "150ms" /* Micro-interactions: hover, focus, button press */,
        normal: "200ms" /* Standard transitions: panel open, tab switch */,
        slow: "300ms" /* Larger movements: modal, sidebar */,
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        /* Smooth entrance animations */
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-out": {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-left": {
          "0%": { opacity: "0", transform: "translateX(8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-right": {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "scale-out": {
          "0%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.95)" },
        },
        /* Subtle pulse for loading states */
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        /* Smooth animations using our easing curves */
        "fade-in": "fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "fade-out": "fade-out 150ms cubic-bezier(0.7, 0, 0.84, 0) forwards",
        "slide-up": "slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "slide-down": "slide-down 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "slide-left": "slide-left 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "slide-right":
          "slide-right 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "scale-in": "scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "scale-out": "scale-out 150ms cubic-bezier(0.7, 0, 0.84, 0) forwards",
        "pulse-subtle": "pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
