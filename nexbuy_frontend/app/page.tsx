"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import AuthModal from "@/src/components/AuthModal";

const systemHighlights = [
  {
    title: "Multi-agent procurement engine",
    detail: "Buyer and seller agents negotiate against hard constraints instead of producing soft suggestions.",
  },
  {
    title: "Operational transparency",
    detail: "Timeline logs, bundle rationale, and negotiation history stay visible while the system executes.",
  },
  {
    title: "Decision-ready output",
    detail: "Plans are scored, itemized, and kept actionable so the user can bargain or check out without context switching.",
  },
];

const capabilityCards = [
  {
    eyebrow: "Chat workspace",
    title: "Start with one request and watch the workflow run",
    copy: "Describe your room, budget, and must-have items in chat. MartGennie turns that request into a tracked recommendation workflow with visible logs and plan output.",
    image: "/main_page/chat.png",
    href: "/chat",
    cta: "Open chat workspace",
  },
  {
    eyebrow: "Product recommendations",
    title: "Review shortlisted products and curated bundles",
    copy: "Browse the products, showcase wins, and memory-based recommendations that MartGennie surfaces after it understands what you are trying to buy.",
    image: "/main_page/product.png",
    href: "/plaza",
    cta: "View recommendation plaza",
  },
  {
    eyebrow: "Negotiation",
    title: "Send the agent to bargain with clear price limits",
    copy: "Move from recommendation to price action. The negotiation view shows buyer offers, seller responses, and the final deal path round by round.",
    image: "/main_page/negotiate.png",
    href: "/negotiation",
    cta: "Go to negotiation view",
  },
];

const heroProducts = [
  {
    category: "Lead seating",
    title: '91" Beige Modern Chesterfield Sofa 3-Seater Button Tufted Velvet',
    price: "$1,999.99",
    image:
      "https://img5.su-cdn.com/cdn-cgi/image/width=750,height=750,format=webp/mall/file/2022/06/29/f7a667c79a54d587424a51794e842bf0.jpg",
  },
  {
    category: "Anchor table",
    title: "Modern White Extendable Coffee Table with Ring-shaped Metal Pedestal",
    price: "$649.99",
    image:
      "https://img5.su-cdn.com/cdn-cgi/image/width=750,height=750,format=webp/mall/2021/04/06/e6490b902737494e9bb56e7c6566f4be.jpg",
  },
  {
    category: "Media console",
    title: "Crator Wood Modern Extendable TV Stand Black and Gray Media Console with 3-Drawer",
    price: "$599.99",
    image:
      "https://img5.su-cdn.com/cdn-cgi/image/width=750,height=750,format=webp/mall/file/2022/01/12/1c6ce4a8e77145bf937849583358663a.jpg",
  },
];

const heroProductLayout = [
  { wrapper: "left-12 top-10 w-[64%]", image: "aspect-[0.92/1]", rotation: "-8deg", baseZIndex: 10 },
  { wrapper: "right-8 top-24 w-[42%]", image: "aspect-[0.95/1]", rotation: "6deg", baseZIndex: 30 },
  { wrapper: "bottom-8 right-16 w-[52%]", image: "aspect-[1.08/1]", rotation: "-3deg", baseZIndex: 20 },
];

const executionFeed = [
  "[01] Requirement parsed: living room / two cats / budget-sensitive",
  "[02] Memory profile loaded: pet-safe materials prioritized",
  "[03] 42 candidate SKUs matched across seating, storage, lighting",
  "[04] 3 bundle configurations scored for fit, risk, and spend",
  "[05] Buyer agent armed with target and max acceptable thresholds",
];

const footerColumns = [
  {
    title: "Product",
    items: ["Chat workspace", "Recommendation plaza", "Negotiation flow", "Bundle planning"],
  },
  {
    title: "Resources",
    items: ["Getting started", "Use cases", "System guide", "Workflow notes"],
  },
  {
    title: "Company",
    items: ["About MartGennie", "Roadmap", "Updates", "Contact"],
  },
  {
    title: "Legal",
    items: ["Privacy", "Terms", "Data handling", "Security"],
  },
  {
    title: "Connect",
    items: ["Email", "GitHub", "Community", "Feedback"],
  },
];

export default function HomePage() {
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeHeroProduct, setActiveHeroProduct] = useState<number | null>(null);

  useEffect(() => {
    async function syncAuthState() {
      const token = readAccessToken();
      if (!token) {
        setIsAuthenticated(false);
        return;
      }

      try {
        await fetchCurrentUser(token);
        setIsAuthenticated(true);
      } catch {
        clearAccessToken();
        setIsAuthenticated(false);
      }
    }

    void syncAuthState();
  }, []);

  function handleTryNow() {
    if (isAuthenticated) {
      router.push("/chat");
      return;
    }
    setAuthOpen(true);
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#f9fbfd_0%,#e7ebf2_100%)] text-[#101828]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.95),transparent_28%),radial-gradient(circle_at_80%_18%,rgba(191,200,214,0.5),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.55),transparent_40%)]" />

      <div className="relative">
        <section className="mx-auto w-full max-w-[1480px] px-6 pb-12 pt-12" id="hero">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-stretch">
            <div className="flex max-w-4xl flex-col lg:min-h-[620px] lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#d7dee8] bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#6b7788] backdrop-blur-xl">
                  AI-native procurement stack
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_18px_rgba(16,185,129,0.28)]" />
                </div>
                <h1 className="mt-8 max-w-4xl text-5xl font-black tracking-[-0.04em] text-[#101828] md:text-7xl md:leading-[0.96]">
                  The Future of Complex Procurement.
                  <span className="mt-3 block bg-[linear-gradient(90deg,#111827_0%,#4b5563_28%,#7c8da3_58%,#3b82f6_82%,#111827_100%)] bg-clip-text text-transparent">
                    Driven by Multi-Agent Negotiation.
                  </span>
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-[#667085] md:text-xl">
                  MartGennie turns product discovery, bundle ranking, and price negotiation into a single
                  controlled workflow. It behaves less like a storefront and more like an execution
                  engine for high-value purchase decisions.
                </p>
                <div className="mt-10 grid gap-3 md:grid-cols-3">
                  {systemHighlights.map((item, index) => (
                    <article
                      className="rounded-[24px] border border-[#dce3ed] bg-white/82 p-4 backdrop-blur-xl transition duration-300 hover:border-[#c2ccd8] hover:bg-white hover:shadow-[0_18px_48px_rgba(148,163,184,0.14)]"
                      key={item.title}
                      style={{ animation: `fadeUp 0.6s ease ${index * 0.08}s both` }}
                    >
                      <p className="text-sm font-semibold tracking-[-0.02em] text-[#101828]">{item.title}</p>
                      <p className="mt-2 text-sm leading-6 text-[#667085]">{item.detail}</p>
                    </article>
                  ))}
                </div>
              </div>
              <div className="mt-12">
                <div className="flex justify-center lg:justify-end lg:pr-[-2px] xl:pr-[-18px]">
                  <button
                    className="group relative inline-flex min-h-16 items-center justify-center overflow-hidden rounded-[24px] p-[1px] transition duration-300 hover:scale-[1.02] md:min-h-[76px]"
                    onClick={handleTryNow}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="button-beam pointer-events-none absolute inset-[-35%] rounded-[28px] opacity-80 blur-md transition duration-300 group-hover:opacity-100"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-[22px] bg-[radial-gradient(circle_at_center,rgba(125,211,252,0.14),transparent_58%)] opacity-0 transition duration-300 group-hover:opacity-100"
                    />
                    <span className="relative z-10 inline-flex items-center gap-4 rounded-[23px] border border-[#d8dee8] bg-[linear-gradient(180deg,#ffffff_0%,#eef2f7_100%)] px-10 py-4 text-xl font-black tracking-[-0.02em] text-[#101828] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_50px_rgba(148,163,184,0.18)] md:px-14 md:py-5 md:text-2xl">
                      <span className="absolute inset-0 rounded-[23px] bg-[linear-gradient(115deg,transparent_18%,rgba(255,255,255,0.72)_34%,rgba(125,211,252,0.16)_50%,rgba(255,255,255,0.76)_58%,transparent_76%)] opacity-70 transition duration-300 group-hover:opacity-100" />
                      <span className="relative z-10">Initialize Workspace</span>
                      <span className="relative z-10 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#d7dee8] bg-white text-lg text-[#2563eb] transition duration-300 group-hover:border-sky-300/40 group-hover:bg-sky-50 group-hover:text-[#0f172a]">
                        ↗
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <aside
              className="relative h-[620px] rounded-[36px] p-5"
              onMouseLeave={() => setActiveHeroProduct(null)}
            >
              {heroProducts.map((product, index) => {
                const layout = heroProductLayout[index];
                const isActive = activeHeroProduct === index;
                return (
                  <div
                    className={`absolute ${layout.wrapper} overflow-hidden rounded-[30px] transition-all duration-500 ease-out`}
                    key={product.title}
                    onMouseEnter={() => setActiveHeroProduct(index)}
                    style={{
                      zIndex: isActive ? 40 : layout.baseZIndex,
                      transform: `rotate(${layout.rotation}) scale(${isActive ? 1.045 : 1}) translateY(${isActive ? "-10px" : "0px"})`,
                      boxShadow: isActive
                        ? "0 35px 120px rgba(148,163,184,0.24)"
                        : "0 30px 90px rgba(148,163,184,0.24)",
                      filter: activeHeroProduct !== null && !isActive ? "brightness(0.78) saturate(0.9)" : "none",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={product.title}
                      className={`${layout.image} w-full object-cover transition duration-500 ${isActive ? "scale-[1.04]" : "scale-100"}`}
                      src={product.image}
                    />
                  </div>
                );
              })}
              <div className="absolute left-6 top-8 h-40 w-40 rounded-full bg-slate-300/35 blur-3xl" />
              <div className="absolute bottom-12 right-6 h-36 w-36 rounded-full bg-sky-200/35 blur-3xl" />
            </aside>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-[1480px] gap-5 px-6 py-6 lg:grid-cols-[0.8fr_1.2fr]" id="system">
          <article className="rounded-[32px] border border-[#dce3ed] bg-white/82 p-6 backdrop-blur-2xl">
            <p className="text-xs uppercase tracking-[0.22em] text-[#8b97a8]">System trace</p>
            <h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-[#101828] md:text-4xl">
              Built for monitored decisions, not decorative AI.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-8 text-[#667085]">
              The interface should feel like a procurement terminal. Every recommendation is tied
              to execution state, every bargain is bounded by constraints, and every output is
              structured for action.
            </p>
          </article>
          <article className="rounded-[32px] border border-[#dce3ed] bg-[linear-gradient(180deg,#ffffff_0%,#eef2f7_100%)] p-5 backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-[#e3e8ef] pb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#8b97a8]">Execution log</p>
                <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[#101828]">Agent pipeline</h3>
              </div>
              <span className="rounded-full border border-emerald-500/16 bg-emerald-50 px-3 py-1 font-mono text-[11px] text-emerald-700">
                RUNNING
              </span>
            </div>
            <div className="mt-4 space-y-3 font-mono text-sm">
              {executionFeed.map((line, index) => (
                <div
                  className="rounded-2xl border border-[#dde5ef] bg-white px-4 py-3 text-[#3b556e]"
                  key={line}
                  style={{ animation: `fadeUp 0.55s ease ${index * 0.1}s both` }}
                >
                  {line}
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="mx-auto w-full max-w-[1480px] px-6 py-8">
          <div className="border-b border-[#dce3ed] pb-5">
            <p className="text-xs uppercase tracking-[0.22em] text-[#8b97a8]">Core surfaces</p>
            <h2 className="mt-2 max-w-4xl text-4xl font-black tracking-[-0.04em] text-[#101828] md:text-5xl">
              A cleaner product story, presented as focused operational surfaces.
            </h2>
          </div>
          <div className="mt-8 space-y-8">
            {capabilityCards.map((card, index) => {
              const reverse = index % 2 === 1;
              return (
                <article
                  className={`grid gap-8 rounded-[34px] border border-[#dde3ec] bg-[linear-gradient(180deg,#ffffff_0%,#f2f5f9_100%)] p-6 shadow-[0_22px_60px_rgba(148,163,184,0.1)] md:h-[620px] md:p-8 lg:grid-cols-[0.7fr_1.3fr] ${
                    reverse ? "lg:[&>*:first-child]:order-2 lg:[&>*:last-child]:order-1" : ""
                  }`}
                  key={card.title}
                  style={{ animation: `fadeUp 0.7s ease ${index * 0.08}s both` }}
                >
                  <div className="flex h-full flex-col justify-center px-2 md:px-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b97a8]">{card.eyebrow}</p>
                    <h3 className="mt-4 text-3xl font-black tracking-[-0.04em] text-[#101828] md:text-4xl">{card.title}</h3>
                    <p className="mt-4 max-w-xl text-lg leading-8 text-[#667085]">{card.copy}</p>
                    <Link className="mt-8 inline-flex text-base font-semibold text-[#c26d22] transition hover:text-[#9a5318]" href={card.href}>
                      {card.cta} →
                    </Link>
                  </div>
                  <div className="flex h-full items-center justify-center overflow-hidden rounded-[28px] border border-[#dce3ed] bg-[#f6f8fb] shadow-[0_16px_40px_rgba(148,163,184,0.12)]">
                    <Image
                      alt={card.title}
                      className="h-full w-full object-contain"
                      height={760}
                      src={card.image}
                      width={1080}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1480px] px-6 pb-16 pt-10">
          <div className="rounded-[28px] bg-[linear-gradient(180deg,#f2f5f8_0%,#eceff4_100%)] px-5 py-10 md:px-8 lg:px-10">
            <div className="grid gap-10 border-t border-[#d6dde7] pt-8 md:grid-cols-2 lg:grid-cols-5">
              {footerColumns.map((column) => (
                <div key={column.title}>
                  <p className="text-sm font-semibold text-[#111827]">{column.title}</p>
                  <div className="mt-5 space-y-3">
                    {column.items.map((item) => (
                      <p className="text-sm leading-6 text-[#667085]" key={item}>
                        {item}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <AuthModal
        onAuthSuccess={() => {
          setIsAuthenticated(true);
          router.push("/chat");
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />

      <style jsx global>{`
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes buttonBeamSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        .button-beam {
          background: conic-gradient(
            from 90deg,
            rgba(125, 211, 252, 0.02) 0deg,
            rgba(125, 211, 252, 0.24) 60deg,
            rgba(255, 255, 255, 0.06) 120deg,
            rgba(99, 102, 241, 0.22) 200deg,
            rgba(125, 211, 252, 0.02) 360deg
          );
          animation: buttonBeamSpin 7s linear infinite;
        }
      `}</style>
    </main>
  );
}
