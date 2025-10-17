/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bull:  { DEFAULT: "#10b981",  50:"#ecfdf5",100:"#d1fae5",200:"#a7f3d0",300:"#6ee7b7",400:"#34d399",500:"#10b981",600:"#059669",700:"#047857",800:"#065f46",900:"#064e3b"},
        bear:  { DEFAULT: "#f43f5e",  50:"#fff1f2",100:"#ffe4e6",200:"#fecdd3",300:"#fda4af",400:"#fb7185",500:"#f43f5e",600:"#e11d48",700:"#be123c",800:"#9f1239",900:"#881337"},
        accent:{ DEFAULT: "#fbbf24" },
      },
      boxShadow: {
        card: "0 8px 30px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
