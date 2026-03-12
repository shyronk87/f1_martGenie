"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Props = {
  onOpenAuth: () => void;
  onSignOut: () => void;
  isAuthenticated: boolean;
  isBlurred?: boolean;
};

const navItems = [
  { label: "Home", href: "/" },
  { label: "Chat", href: "/chat" },
  { label: "Packages", href: "/recommendations" },
  { label: "Negotiation", href: "/negotiation" },
  { label: "Plaza", href: "/plaza" },
];

export default function Navbar({ onOpenAuth, onSignOut, isAuthenticated, isBlurred = false }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const profileCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current) {
        return;
      }
      if (!containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setProfileOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (profileCloseTimerRef.current) {
        clearTimeout(profileCloseTimerRef.current);
      }
    };
  }, []);

  function openProfileMenu() {
    if (profileCloseTimerRef.current) {
      clearTimeout(profileCloseTimerRef.current);
      profileCloseTimerRef.current = null;
    }
    setProfileOpen(true);
  }

  function closeProfileMenuWithDelay() {
    if (profileCloseTimerRef.current) {
      clearTimeout(profileCloseTimerRef.current);
    }
    profileCloseTimerRef.current = setTimeout(() => {
      setProfileOpen(false);
      profileCloseTimerRef.current = null;
    }, 180);
  }

  return (
    <header className="fixed inset-x-0 top-0 z-[80]">
      <div className="mx-auto flex w-full max-w-[1480px] items-center justify-between px-4 pt-0 md:px-6">
        <div
          className={`flex h-[72px] w-full items-center justify-between rounded-b-[24px] bg-[linear-gradient(180deg,#f9fbfd_0%,#e7ebf2_100%)] px-4 text-[#101828] shadow-[0_10px_30px_rgba(148,163,184,0.12)] transition duration-200 md:px-5 ${
            isBlurred ? "scale-[0.995] opacity-70 blur-[6px]" : ""
          }`}
        >
          <Link className="flex items-center" href="/">
            <p className="font-mono text-xl font-black uppercase tracking-[0.42em] text-[#0f172a] md:text-2xl">Nexbuy</p>
          </Link>

          <nav className="hidden items-center gap-8 text-base font-semibold text-[#475467] lg:flex">
            {navItems.map((item) => (
              <Link className="transition hover:text-[#101828]" href={item.href} key={item.label}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="relative flex items-center gap-2" ref={containerRef}>
            {isAuthenticated ? (
              <div
                className="relative hidden md:block"
                onMouseEnter={openProfileMenu}
                onMouseLeave={closeProfileMenuWithDelay}
              >
                <button
                  aria-label="Open user menu"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#d9e0ea] bg-[linear-gradient(180deg,#fbfcfe_0%,#eef2f7_100%)] text-[#475467] shadow-[0_10px_24px_rgba(148,163,184,0.12)] transition hover:border-[#c7d1dd] hover:text-[#101828]"
                  onClick={() => setProfileOpen((current) => !current)}
                  type="button"
                >
                  <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <path
                      d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                  </svg>
                </button>

                {profileOpen ? (
                  <div className="absolute right-0 top-full z-20 w-[220px] pt-3">
                    <div className="absolute inset-x-0 top-0 h-3" />
                    <div className="rounded-[24px] border border-[#dce3ed] bg-white p-3 shadow-[0_20px_60px_rgba(148,163,184,0.16)]">
                    <div className="space-y-1">
                      <Link
                        className="block w-full rounded-2xl px-3 py-3 text-left text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
                        href="/profile"
                        onClick={() => setProfileOpen(false)}
                      >
                        Personal Details
                      </Link>
                      <button
                        className="block w-full rounded-2xl px-3 py-3 text-left text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
                        onClick={() => setProfileOpen(false)}
                        type="button"
                      >
                        Order Details
                      </button>
                      <button
                        className="block w-full rounded-2xl px-3 py-3 text-left text-sm font-semibold text-[#b42318] transition hover:bg-[#fff1f1]"
                        onClick={() => {
                          setProfileOpen(false);
                          onSignOut();
                        }}
                        type="button"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                className="hidden rounded-2xl border border-[#cfd7e3] bg-[linear-gradient(180deg,#ffffff_0%,#eef2f7_100%)] px-5 py-2.5 text-sm font-bold text-[#0f172a] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_14px_30px_rgba(148,163,184,0.18)] transition hover:border-[#bfc9d8] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_18px_34px_rgba(148,163,184,0.22)] md:inline-flex"
                onClick={onOpenAuth}
                type="button"
              >
                Sign in
              </button>
            )}
            <button
              aria-label="Open navigation menu"
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#d9e0ea] bg-[linear-gradient(180deg,#fbfcfe_0%,#eef2f7_100%)] text-sm font-semibold text-[#475467] transition hover:border-[#c7d1dd] hover:bg-white lg:hidden"
              onClick={() => setMenuOpen((current) => !current)}
              type="button"
            >
              ≡
            </button>

            {menuOpen ? (
              <div className="absolute right-0 top-14 w-[260px] rounded-[24px] border border-[#dce3ed] bg-white p-3 shadow-[0_20px_60px_rgba(148,163,184,0.16)] lg:hidden">
                <div className="space-y-1">
                  {navItems.map((item) => (
                    <Link
                      className="block rounded-2xl px-3 py-2 text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
                      href={item.href}
                      key={item.label}
                      onClick={() => setMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
                {isAuthenticated ? (
                  <div className="mt-3 space-y-1 border-t border-[#e8edf3] pt-3">
                    <Link
                      className="block w-full rounded-2xl px-3 py-2 text-left text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
                      href="/profile"
                      onClick={() => setMenuOpen(false)}
                    >
                      Personal Details
                    </Link>
                    <button
                      className="block w-full rounded-2xl px-3 py-2 text-left text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
                      onClick={() => setMenuOpen(false)}
                      type="button"
                    >
                      Order Details
                    </button>
                    <button
                      className="block w-full rounded-2xl px-3 py-2 text-left text-sm font-semibold text-[#b42318] transition hover:bg-[#fff1f1]"
                      onClick={() => {
                        setMenuOpen(false);
                        onSignOut();
                      }}
                      type="button"
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <button
                    className="mt-3 w-full rounded-2xl border border-[#cfd7e3] bg-[linear-gradient(180deg,#ffffff_0%,#eef2f7_100%)] px-4 py-2.5 text-left text-sm font-bold text-[#0f172a] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_14px_30px_rgba(148,163,184,0.18)]"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenAuth();
                    }}
                    type="button"
                  >
                    Sign in
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
