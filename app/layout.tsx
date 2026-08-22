import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Живая карта клиента",
  description: "Динамическая модель психологического состояния клиента",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
