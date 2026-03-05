"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import AuthModal from "@/src/components/AuthModal";
import Navbar from "@/src/components/Navbar";

type ProductCard = {
  tag: string;
  emoji: string;
  category: string;
  name: string;
  price: string;
};

const featuredProducts: ProductCard[] = [
  { tag: "Top Pick", emoji: "🛋️", category: "Living Room", name: "Modular Cat-Friendly Sofa", price: "$1,299" },
  { tag: "New", emoji: "🪵", category: "Dining", name: "Extendable Oak Dining Set", price: "$2,005" },
  { tag: "Bundle", emoji: "💡", category: "Lighting", name: "Warm Arc Floor Lamp", price: "$580" },
  { tag: "Popular", emoji: "🧺", category: "Accessories", name: "Washable Neutral Rug", price: "$885" },
];

export default function HomePage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Checking account session...");

  useEffect(() => {
    async function syncAuthState() {
      const token = readAccessToken();
      if (!token) {
        setIsAuthenticated(false);
        setStatusMessage("Sign in to unlock your AI shopping workspace.");
        return;
      }

      try {
        const user = await fetchCurrentUser(token);
        setIsAuthenticated(true);
        setStatusMessage(`Signed in as ${user.email}`);
      } catch {
        clearAccessToken();
        setIsAuthenticated(false);
        setStatusMessage("Saved session expired. Please sign in again.");
      }
    }

    void syncAuthState();
  }, []);

  function handleSignOut() {
    clearAccessToken();
    setIsAuthenticated(false);
    setStatusMessage("Signed out.");
  }

  return (
    <main className="min-h-screen bg-[#f2efeb] text-[#2f2a26]">
      <Navbar
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={handleSignOut}
      />

      <section
        className="mx-auto grid w-full max-w-[1400px] gap-12 px-6 py-14 lg:grid-cols-2"
        id="hero"
      >
        <div>
          <div className="inline-flex items-center rounded-full border border-[#e5d9cd] bg-white/70 px-5 py-2 text-sm font-semibold text-[#9a7b61]">
            AI-driven buyer agent for complex home shopping
          </div>
          <h1 className="mt-6 text-5xl leading-[1.04] font-black md:text-7xl">
            Design Your Whole-Home
            <br />
            <span className="text-[#9a7a63]">Shopping Workflow</span>
          </h1>
          <p className="mt-6 max-w-2xl text-xl leading-[1.8] text-[#867366]">
            Describe one room request, and Nexbuy agents scan products, build bundles,
            and present decision-ready plans with timeline transparency.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              className="inline-flex h-12 items-center rounded-xl bg-[#6b4a34] px-7 text-base font-bold text-white"
              href="/chat"
            >
              Try Now
            </Link>
            <button
              className="inline-flex h-12 items-center rounded-xl border border-[#d5c6b8] bg-white px-6 text-base font-semibold text-[#5d4a3b]"
              onClick={() => setAuthOpen(true)}
              type="button"
            >
              Sign in / Register
            </button>
          </div>
          <p className="mt-4 text-sm text-[#8f7d71]">{statusMessage}</p>
        </div>

        <div className="rounded-3xl border border-[#e8ded3] bg-white p-6 shadow-xl shadow-[#c8b8a43d]" id="assistant">
          <div className="flex items-center gap-4 border-b border-[#e8dfd5] pb-4">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#836349] text-white">
              🤖
            </span>
            <div>
              <p className="text-2xl font-black">Nexbuy Buyer Agent</p>
              <p className="text-base text-[#67b887]">Online</p>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-base">
            <div className="ml-auto w-fit rounded-2xl bg-[#6b4a34] px-5 py-2 text-white">
              Budget $3,000. Build a warm wood living room for two cats.
            </div>
            <div className="w-fit rounded-2xl border border-[#e7ddd2] bg-[#f9f6f3] px-5 py-2 text-[#5a4940]">
              Scanning 4,500 products... Found 42 matches. Building 3 optimized bundles now.
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1400px] px-6 py-8" id="products">
        <p className="text-center text-sm font-bold tracking-[0.22em] text-[#d1ad83] uppercase">
          Featured Sandbox Products
        </p>
        <h2 className="mt-2 text-center text-5xl font-black md:text-6xl">Curated For Demo</h2>
        <p className="mt-3 text-center text-xl text-[#97867a]">
          Curated cards from your Homary sandbox to validate bundle-generation workflows.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {featuredProducts.map((item) => (
            <article className="rounded-3xl bg-[#ece8e3] p-5" key={item.name}>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-[#7f6a59]">
                {item.tag}
              </span>
              <div className="my-8 text-center text-5xl">{item.emoji}</div>
              <p className="text-sm text-[#9e8f84]">{item.category}</p>
              <h3 className="mt-1 text-3xl font-black">{item.name}</h3>
              <p className="mt-2 text-3xl font-black text-[#5d4838]">{item.price}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="mt-12 bg-[linear-gradient(90deg,#403a35_0%,#25282f_50%,#34383f_100%)] px-6 py-20 text-center text-white"
        id="about"
      >
        <h2 className="text-5xl font-black md:text-7xl">Launch Your 10x Shopping Workflow</h2>
        <p className="mx-auto mt-4 max-w-4xl text-xl text-[#d6c6b5] md:text-2xl">
          From inspiration to order draft with transparent AI actions, bundle logic, and faster
          decision cycles.
        </p>
        <Link
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#cab090] px-10 py-4 text-xl font-black text-white shadow"
          href="/chat"
        >
          Enter Workspace
        </Link>
      </section>

      <AuthModal
        onAuthSuccess={() => {
          setIsAuthenticated(true);
          setStatusMessage("Signed in. You can now open the workspace.");
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </main>
  );
}
