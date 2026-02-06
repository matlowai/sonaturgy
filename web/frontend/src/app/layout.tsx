import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { ToastContainer } from '@/components/common/Toast';
import { PlayerBar } from '@/components/common/PlayerBar';

export const metadata: Metadata = {
  title: 'ACE-Step V1.5',
  description: 'Open-Source Music Generation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-screen flex flex-col overflow-hidden">
        <Header />
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 min-h-0 overflow-y-auto p-4 pb-20">{children}</main>
        </div>
        <ToastContainer />
        <PlayerBar />
      </body>
    </html>
  );
}
