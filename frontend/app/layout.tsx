import type { Metadata } from "next";
import { Header } from "@/components/common/Header";
import { MockProvider } from "@/components/common/MockProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaperCast",
  description: "Interactive, evidence-grounded audio learning assistant.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Header />
        <MockProvider>{children}</MockProvider>
      </body>
    </html>
  );
}
