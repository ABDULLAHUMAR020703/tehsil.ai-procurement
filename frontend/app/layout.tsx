import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { APP_DESCRIPTION, APP_NAME } from '@/lib/appMeta';

const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

const themeInitScript = `
(function(){
  try {
    var k='procurement-theme';
    var t=localStorage.getItem(k);
    var dark=false;
    if(t==='dark') dark=true;
    else if(t==='light') dark=false;
    else dark=window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark',dark);
  } catch(e) {}
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={fontSans.variable}>
      <body className={`${fontSans.className} min-h-screen antialiased`} suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

