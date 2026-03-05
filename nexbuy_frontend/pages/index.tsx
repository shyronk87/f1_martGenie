
"use client";

import { useEffect, useState } from "react";
import {
  clearAccessToken,
  fetchCurrentUser,
  readAccessToken,
} from "@/lib/auth";
import AuthModal from "@/src/components/AuthModal";
import Navbar from "@/src/components/Navbar";

const products = [
  { tag: "热销", emoji: "🪵", category: "餐厅家具", name: "北欧实木餐桌", price: "¥3,299" },
  { tag: "新品", emoji: "🗿", category: "客厅家具", name: "大理石茶几", price: "¥1,899" },
  { tag: "推荐", emoji: "📚", category: "书房家具", name: "原木书架", price: "¥2,599" },
  { tag: "爆款", emoji: "🛋️", category: "客厅家具", name: "皮质沙发", price: "¥5,999" },
];

export default function HomePage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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

  function handleSignOut() {
    clearAccessToken();
    setIsAuthenticated(false);
  }

  return (
    <main className="min-h-screen bg-[#f2efeb] text-[#2f2a26]">
      <Navbar
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={handleSignOut}
      />

      <section id="hero" className="mx-auto grid w-full max-w-[1400px] gap-12 px-6 py-14 lg:grid-cols-2">
        <div>
          <div className="inline-flex items-center rounded-full border border-[#e5d9cd] bg-white/70 px-5 py-2 text-sm font-semibold text-[#9a7b61]">
            ✧ AI 驱动的智能家具推荐
          </div>
          <h1 className="mt-6 text-6xl leading-[1.05] font-black md:text-7xl">
            发现您的
            <br />
            <span className="text-[#9a7a63]">理想家居</span>
          </h1>
          <p className="mt-6 max-w-2xl text-2xl leading-[1.7] text-[#867366]">
            通过 AI 智能分析，为您推荐最适合的家具搭配方案。从现代简约到复古优雅，找到属于您的独特风格。
          </p>
          <div className="mt-8 flex max-w-2xl items-center gap-3 rounded-2xl bg-white p-2 shadow-lg shadow-[#bfa98f33]">
            <input
              className="h-12 flex-1 rounded-xl bg-[#f4f1ee] px-4 text-lg placeholder:text-[#b3a297] outline-none"
              placeholder="描述您想要的家具风格..."
              readOnly
            />
            <button className="h-12 rounded-xl bg-[#6b4a34] px-7 text-lg font-bold text-white">搜索</button>
          </div>
        </div>

        <div className="rounded-3xl border border-[#e8ded3] bg-white p-6 shadow-xl shadow-[#c8b8a43d]">
          <div className="flex items-center gap-4 border-b border-[#e8dfd5] pb-4">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#836349] text-white">✧</span>
            <div>
              <p className="text-3xl font-black">AI 家居顾问</p>
              <p className="text-lg text-[#67b887]">● 在线</p>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-lg">
            <div className="ml-auto w-fit rounded-2xl bg-[#6b4a34] px-5 py-2 text-white">我想要一个简约风格的客厅</div>
            <div className="w-fit rounded-2xl border border-[#e7ddd2] bg-[#f9f6f3] px-5 py-2 text-[#5a4940]">
              ✧ 为您推荐北欧极简系列，浅木色搭配白色大理石...
            </div>
          </div>
        </div>
      </section>

      <section id="products" className="mx-auto w-full max-w-[1400px] px-6 py-8">
        <p className="text-center text-sm font-bold tracking-[0.22em] text-[#d1ad83] uppercase">Featured Products</p>
        <h2 className="mt-2 text-center text-6xl font-black">精选产品</h2>
        <p className="mt-3 text-center text-2xl text-[#97867a]">每一件产品都经过精心挑选，融合自然材质与现代设计</p>
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {products.map((item) => (
            <article key={item.name} className="rounded-3xl bg-[#ece8e3] p-5">
              <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-[#7f6a59]">{item.tag}</span>
              <div className="my-9 text-center text-6xl">{item.emoji}</div>
              <p className="text-base text-[#9e8f84]">{item.category}</p>
              <h3 className="mt-1 text-4xl font-black">{item.name}</h3>
              <p className="mt-2 text-4xl font-black text-[#5d4838]">{item.price}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="about" className="mt-12 bg-[linear-gradient(90deg,#403a35_0%,#25282f_50%,#34383f_100%)] px-6 py-20 text-center text-white">
        <h2 className="text-7xl font-black">开始您的家居之旅</h2>
        <p className="mx-auto mt-4 max-w-4xl text-3xl text-[#d6c6b5]">让 AI 助手帮您发现完美的家具搭配，打造理想中的家</p>
        <button
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#cab090] px-10 py-4 text-2xl font-black text-white shadow"
          onClick={() => setAuthOpen(true)}
          type="button"
        >
          ✧ 立即体验 AI 助手
        </button>
      </section>

      <AuthModal
        onAuthSuccess={() => setIsAuthenticated(true)}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </main>
  );
}
