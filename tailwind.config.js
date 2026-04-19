/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./sidepanel/**/*.{html,js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          uat: "#2563eb",
          prod: "#dc2626",
          success: "#10b981",
          warning: "#d97706",
        },
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "1rem" }],
      },
      maxWidth: {
        panel: "380px",
      },
      width: {
        modal: "min(340px, 90vw)",
      },
    },
  },
  plugins: [],
};
