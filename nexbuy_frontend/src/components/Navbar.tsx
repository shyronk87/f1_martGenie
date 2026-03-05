"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onOpenAuth: () => void;
  onSignOut: () => void;
  isAuthenticated: boolean;
};

export default function Navbar({ onOpenAuth, onSignOut, isAuthenticated }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current) {
        return;
      }
      if (!containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-[#e7ddd3] bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-20 w-full max-w-[1480px] items-center justify-between px-6 md:px-10">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#6b4a34] text-white shadow">
            🏠
          </span>
          <span className="text-3xl font-black text-[#2d2a27]">智家购</span>
        </div>

        <nav className="hidden items-center gap-10 text-xl font-semibold text-[#3b342f] md:flex">
          <a href="#hero">首页</a>
          <a href="#products">产品</a>
          <a href="#assistant">AI助手</a>
          <a href="#about">关于</a>
        </nav>

        <div className="relative" ref={containerRef}>
          <button
            aria-label="Open user menu"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#dfd5cb] text-[22px] text-[#5d4939] hover:bg-[#f5efe8]"
            onClick={() => setMenuOpen((v) => !v)}
            type="button"
          >
            👤
          </button>

          {menuOpen ? (
            <div className="absolute right-0 mt-3 w-[260px] rounded-sm border border-[#efefef] bg-white p-3 shadow-xl">
              <button
                className="w-full text-left text-lg font-semibold text-[#313131]"
                onClick={() => {
                  setMenuOpen(false);
                  if (isAuthenticated) {
                    onSignOut();
                    return;
                  }
                  onOpenAuth();
                }}
                type="button"
              >
                {isAuthenticated ? "Sign out" : "Sign in / Register"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
