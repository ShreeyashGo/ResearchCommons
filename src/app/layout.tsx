import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Commons",
  description: "Collaborative research workspace",
};

const themeBoot = `(() => {
  try {
    const saved = localStorage.getItem("rc-theme");
    const dark = saved === "dark" || ((saved === null || saved === "system") && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        {children}
      </body>
    </html>
  );
}
