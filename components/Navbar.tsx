'use client';

import Link from 'next/link';
import { BookOpen, ShieldCheck, LogOut, UploadCloud, LayoutDashboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter, usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';

export default function Navbar() {
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const checkUser = async () => {
      const { data } = await supabase.auth.getSession();
      setIsAdminLoggedIn(!!data.session);
    };

    checkUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAdminLoggedIn(!!session);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/admin/login');
  };

  return (
    <header className="sticky top-0 z-40 apple-glass border-b border-black/[0.06] dark:border-white/[0.08] transition-colors duration-200">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-lg bg-slate-900 dark:bg-slate-100 flex items-center justify-center text-white dark:text-slate-900 shadow-sm group-hover:scale-105 transition-transform">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100 tracking-tight text-sm">
              Buku Angkatan
            </span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
              Database
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-1.5">
          {isAdminLoggedIn ? (
            <>
              <Link
                href="/admin/dashboard"
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  pathname === '/admin/dashboard'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  Dashboard
                </span>
              </Link>
              <Link
                href="/admin/import"
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  pathname === '/admin/import'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <UploadCloud className="w-3.5 h-3.5" />
                  Import Master
                </span>
              </Link>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-full text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                Keluar
              </button>
            </>
          ) : (
            <Link
              href="/admin/login"
              className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium flex items-center gap-1 px-3 py-1.5 rounded-full hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Admin
            </Link>
          )}

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-800 mx-1" />

          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
