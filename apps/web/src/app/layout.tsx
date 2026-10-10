import type { Metadata, Viewport } from "next";
import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/600.css";
import "@/styles/globals.css";
import "@/styles/workspace.css";
import "@/features/documents/documents.css";
import "@/styles/sidebar.css";
import "@/styles/experience.css";

export const metadata: Metadata = {
  title: "ArogyaAI — Health information, closer to home",
  description:
    "A health information companion for Nepal. Review prescriptions and medicine labels, continue conversations, and use Nepali voice.",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#174d42" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WorkspaceLayout>{children}</WorkspaceLayout>
      </body>
    </html>
  );
}
