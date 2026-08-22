import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hafiz Stationers POS',
  description: 'Point of Sale System for Hafiz Stationers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans bg-slate-100 text-slate-900">{children}</body>
    </html>
  );
}
