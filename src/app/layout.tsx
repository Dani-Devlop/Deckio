import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deckio — Smart Flashcards",
  description:
    "Organize flashcard decks, study with flip cards, take auto-generated quizzes and track your learning progress. Powered by FastAPI + PostgreSQL + Next.js.",
  keywords: ["flashcards", "study", "learning", "quiz", "FastAPI", "Next.js"],
  authors: [{ name: "Dani-Devlop" }],
  openGraph: {
    title: "Deckio — Smart Flashcards",
    description: "Decks, flip-card study, generated quizzes and learning analytics.",
    siteName: "Deckio",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
