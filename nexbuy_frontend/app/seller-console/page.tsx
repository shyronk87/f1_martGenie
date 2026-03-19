"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { clearAccessToken, fetchCurrentUser, logoutSession, readAccessToken } from "@/lib/auth";
import AuthModal from "@/src/components/AuthModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

type SellerDraft = {
  title: string;
  roomPlacement: string;
  productType: string;
  description: string;
  imageUrl: string;
  imageName: string;
  salePrice: string;
  floorPrice: string;
  inventory: string;
  urgency: "steady" | "active" | "priority";
  specNarrative: string;
};

const ROOM_OPTIONS = [
  "Living room",
  "Dining room",
  "Bedroom",
  "Outdoor",
  "Lighting",
  "Storage",
];

const PRODUCT_TYPE_OPTIONS = [
  "Sofa",
  "Chair",
  "Table",
  "Coffee table",
  "Bed",
  "Storage cabinet",
  "Lighting",
];

const URGENCY_OPTIONS: Array<{ value: SellerDraft["urgency"]; label: string; description: string }> = [
  { value: "steady", label: "Steady", description: "Normal selling pace" },
  { value: "active", label: "Active", description: "Would like to convert soon" },
  { value: "priority", label: "Priority", description: "High priority to move inventory" },
];

const INITIAL_DRAFT: SellerDraft = {
  title: "",
  roomPlacement: "Living room",
  productType: "Sofa",
  description: "",
  imageUrl: "",
  imageName: "",
  salePrice: "",
  floorPrice: "",
  inventory: "",
  urgency: "steady",
  specNarrative: "",
};

function extractKeywordChips(text: string) {
  const normalized = text
    .replace(/\r/g, " ")
    .replace(/[，、；;|]/g, ",")
    .replace(/\n/g, ",")
    .split(",")
    .flatMap((segment) => segment.split("."))
    .map((segment) => segment.trim())
    .filter(Boolean);

  const unique = new Set<string>();

  for (const segment of normalized) {
    const words = segment
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && word.length <= 24);

    if (segment.length <= 36) {
      unique.add(segment);
    } else {
      for (const word of words) {
        unique.add(word);
      }
    }

    if (unique.size >= 10) {
      break;
    }
  }

  return Array.from(unique).slice(0, 10);
}

function formatCurrency(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "--";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function SellerConsolePage() {
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAccessToken()));
  const [draft, setDraft] = useState<SellerDraft>(INITIAL_DRAFT);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token || !isAuthenticated) {
      return;
    }

    void fetchCurrentUser(token)
      .then(() => setIsAuthenticated(true))
      .catch(() => {
        clearAccessToken();
        setIsAuthenticated(false);
      });
  }, [isAuthenticated]);

  const extractedKeywords = useMemo(() => extractKeywordChips(draft.specNarrative), [draft.specNarrative]);

  function updateDraft<K extends keyof SellerDraft>(key: K, value: SellerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveMessage("");
  }

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        const imageUrl = reader.result;
        setDraft((current) => ({
          ...current,
          imageUrl,
          imageName: file.name,
        }));
        setSaveMessage("");
      }
    };
    reader.readAsDataURL(file);
  }

  function handleSaveDraft() {
    setSaveMessage("Mock listing draft saved locally.");
  }

  function handleResetDraft() {
    setDraft(INITIAL_DRAFT);
    setSaveMessage("");
  }

  return (
    <>
      <WorkspaceShell
        currentPath="/seller-console"
        isAuthenticated={isAuthenticated}
        onNewConversation={() => router.push("/chat")}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          void logoutSession().finally(() => {
            setIsAuthenticated(false);
            router.push("/chat");
          });
        }}
      >
        <section className="h-full overflow-y-auto px-6 py-6">
          <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="rounded-[32px] border border-[#dde4ed] bg-[linear-gradient(180deg,#ffffff_0%,#f4f7fb_100%)] p-5 shadow-[0_20px_60px_rgba(148,163,184,0.12)]">
              <p className="px-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#8b97a8]">
                Seller console
              </p>
              <div className="mt-4 space-y-2">
                <button
                  className="flex w-full items-center justify-between rounded-[24px] border border-[#dbe3ed] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)] px-4 py-4 text-left shadow-[0_12px_28px_rgba(59,130,246,0.08)]"
                  type="button"
                >
                  <span>
                    <span className="block text-sm font-semibold text-[#1d4ed8]">List product</span>
                    <span className="mt-1 block text-sm text-[#4b5563]">Create and review one draft.</span>
                  </span>
                  <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-semibold text-[#1d4ed8]">
                    Active
                  </span>
                </button>
              </div>
            </aside>

            <div className="rounded-[32px] border border-[#dde4ed] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbfd_100%)] p-6 shadow-[0_20px_60px_rgba(148,163,184,0.14)]">
              <div className="flex flex-col gap-4 border-b border-[#e5eaf1] pb-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                    Product listing
                  </p>
                  <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.04em] text-[#101828]">
                    Build a cleaner seller draft
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-[#526173]">
                    Upload a product image, describe the item in plain language, and let the system pull out the
                    keywords buyers are most likely to care about.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    className="h-11 rounded-full border border-[#d6dee8] bg-white px-5 text-sm font-semibold text-[#344054] transition hover:bg-[#f8fafc]"
                    onClick={handleResetDraft}
                    type="button"
                  >
                    Reset
                  </button>
                  <button
                    className="h-11 rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(15,23,42,0.18)] transition hover:brightness-105"
                    onClick={handleSaveDraft}
                    type="button"
                  >
                    Save mock draft
                  </button>
                </div>
              </div>

              {saveMessage ? (
                <div className="mt-4 rounded-[20px] border border-[#d6e9db] bg-[linear-gradient(180deg,#f4fbf6_0%,#ebf7ef_100%)] px-4 py-3 text-sm text-[#25613e]">
                  {saveMessage}
                </div>
              ) : null}

              <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1.2fr)_360px]">
                <div className="space-y-6">
                  <section className="rounded-[28px] border border-[#e4e9f1] bg-white px-5 py-5">
                    <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Product image</p>
                        <label className="flex min-h-[250px] cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-[#cbd5e1] bg-[linear-gradient(180deg,#f8fbff_0%,#eef5fd_100%)] px-6 py-8 text-center transition hover:border-[#93c5fd] hover:bg-[linear-gradient(180deg,#f3f8ff_0%,#e8f1fc_100%)]">
                          {draft.imageUrl ? (
                            <Image
                              alt={draft.title || "Uploaded product"}
                              className="h-[210px] w-full rounded-[22px] object-cover shadow-[0_16px_34px_rgba(148,163,184,0.18)]"
                              height={840}
                              src={draft.imageUrl}
                              unoptimized
                              width={840}
                            />
                          ) : (
                            <>
                              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#527190]">
                                Upload
                              </span>
                              <p className="mt-4 text-base font-semibold text-[#123b5f]">Drop in a product image</p>
                              <p className="mt-2 max-w-[220px] text-sm leading-6 text-[#667085]">
                                Use a clean hero shot so the draft preview feels closer to a real listing.
                              </p>
                            </>
                          )}
                          <input accept="image/*" className="sr-only" onChange={handleImageUpload} type="file" />
                        </label>
                        <p className="text-xs text-[#98a2b3]">
                          {draft.imageName ? `Uploaded: ${draft.imageName}` : "PNG, JPG, or WEBP"}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                            Product title
                          </span>
                          <input
                            className="h-12 w-full rounded-[18px] border border-[#d7dfe9] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#7aa2d8]"
                            onChange={(event) => updateDraft("title", event.target.value)}
                            placeholder="Modern modular sectional with walnut coffee table"
                            value={draft.title}
                          />
                        </label>

                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="block">
                            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                              Best room fit
                            </span>
                            <select
                              className="h-12 w-full rounded-[18px] border border-[#d7dfe9] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#7aa2d8]"
                              onChange={(event) => updateDraft("roomPlacement", event.target.value)}
                              value={draft.roomPlacement}
                            >
                              {ROOM_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                              Product category
                            </span>
                            <select
                              className="h-12 w-full rounded-[18px] border border-[#d7dfe9] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#7aa2d8]"
                              onChange={(event) => updateDraft("productType", event.target.value)}
                              value={draft.productType}
                            >
                              {PRODUCT_TYPE_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                            Listing description
                          </span>
                          <textarea
                            className="min-h-[144px] w-full rounded-[22px] border border-[#d7dfe9] bg-white px-4 py-3 text-sm leading-6 text-[#101828] outline-none transition focus:border-[#7aa2d8]"
                            onChange={(event) => updateDraft("description", event.target.value)}
                            placeholder="Describe the product in a few lines: what it is, where it fits, and what makes it sellable."
                            value={draft.description}
                          />
                        </label>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[28px] border border-[#e4e9f1] bg-white px-5 py-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Pricing setup</p>
                        <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[#101828]">
                          Set the commercial guardrails
                        </h2>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                          List price
                        </span>
                        <input
                          className="h-12 w-full rounded-[18px] border border-[#d7dfe9] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#7aa2d8]"
                          inputMode="decimal"
                          onChange={(event) => updateDraft("salePrice", event.target.value)}
                          placeholder="899"
                          value={draft.salePrice}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                          Lowest acceptable price
                        </span>
                        <input
                          className="h-12 w-full rounded-[18px] border border-[#d7dfe9] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#7aa2d8]"
                          inputMode="decimal"
                          onChange={(event) => updateDraft("floorPrice", event.target.value)}
                          placeholder="729"
                          value={draft.floorPrice}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                          Inventory
                        </span>
                        <input
                          className="h-12 w-full rounded-[18px] border border-[#d7dfe9] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#7aa2d8]"
                          inputMode="numeric"
                          onChange={(event) => updateDraft("inventory", event.target.value)}
                          placeholder="24"
                          value={draft.inventory}
                        />
                      </label>
                    </div>

                    <label className="mt-4 block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                        Inventory priority
                      </span>
                      <select
                        className="h-12 w-full rounded-[18px] border border-[#d7dfe9] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#7aa2d8]"
                        onChange={(event) => updateDraft("urgency", event.target.value as SellerDraft["urgency"])}
                        value={draft.urgency}
                      >
                        {URGENCY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </section>

                  <section className="rounded-[28px] border border-[#e4e9f1] bg-white px-5 py-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Specification input</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[#101828]">
                      Describe the specs in one paragraph
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-7 text-[#667085]">
                      Instead of filling many spec rows, write a short paragraph about materials, dimensions, finishes,
                      comfort, and any standout details. We will pull the useful keywords out automatically.
                    </p>

                    <textarea
                      className="mt-5 min-h-[170px] w-full rounded-[22px] border border-[#d7dfe9] bg-white px-4 py-3 text-sm leading-7 text-[#101828] outline-none transition focus:border-[#7aa2d8]"
                      onChange={(event) => updateDraft("specNarrative", event.target.value)}
                      placeholder="Example: Solid walnut coffee table, removable seat cushions, microfiber upholstery, modular corner layout, low profile silhouette, and easy-wipe surfaces for daily family use."
                      value={draft.specNarrative}
                    />

                    <div className="mt-5 rounded-[24px] border border-[#e6ebf2] bg-[linear-gradient(180deg,#f8fbff_0%,#f2f7fd_100%)] px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-[#123b5f]">Detected keywords</p>
                        <span className="text-xs text-[#7b8798]">
                          {extractedKeywords.length > 0 ? `${extractedKeywords.length} extracted` : "Waiting for details"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {extractedKeywords.length > 0 ? (
                          extractedKeywords.map((keyword) => (
                            <span
                              className="rounded-full border border-[#d6e4f5] bg-white px-3 py-1.5 text-sm font-medium text-[#1f3b64]"
                              key={keyword}
                            >
                              {keyword}
                            </span>
                          ))
                        ) : (
                          <p className="text-sm leading-6 text-[#7b8798]">
                            Once you add more product details, the main selling keywords will show up here.
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                </div>

                <aside className="space-y-5">
                  <section className="rounded-[28px] border border-[#e4e9f1] bg-[linear-gradient(180deg,#ffffff_0%,#f4f8fc_100%)] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.12)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Live preview</p>
                    <div className="mt-4 overflow-hidden rounded-[24px] border border-[#dde5ef] bg-white">
                      {draft.imageUrl ? (
                        <Image
                          alt={draft.title || "Product preview"}
                          className="h-[220px] w-full object-cover"
                          height={880}
                          src={draft.imageUrl}
                          unoptimized
                          width={880}
                        />
                      ) : (
                        <div className="flex h-[220px] items-center justify-center bg-[linear-gradient(180deg,#f7fafc_0%,#eef3f8_100%)] text-sm font-medium text-[#7b8798]">
                          Image preview
                        </div>
                      )}

                      <div className="space-y-4 px-5 py-5">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b97a8]">
                            {draft.roomPlacement} / {draft.productType}
                          </p>
                          <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[#101828]">
                            {draft.title || "Your draft title will appear here"}
                          </h3>
                          <p className="mt-3 text-sm leading-7 text-[#667085]">
                            {draft.description || "Add a short listing description to preview how the draft will read to a buyer."}
                          </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[20px] border border-[#e4e9f1] bg-[#f8fbff] px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.16em] text-[#8b97a8]">List price</p>
                            <p className="mt-2 text-lg font-semibold text-[#101828]">{formatCurrency(draft.salePrice)}</p>
                          </div>
                          <div className="rounded-[20px] border border-[#e4e9f1] bg-[#f8fbff] px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.16em] text-[#8b97a8]">Lowest acceptable</p>
                            <p className="mt-2 text-lg font-semibold text-[#101828]">{formatCurrency(draft.floorPrice)}</p>
                          </div>
                          <div className="rounded-[20px] border border-[#e4e9f1] bg-[#f8fbff] px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.16em] text-[#8b97a8]">Inventory</p>
                            <p className="mt-2 text-lg font-semibold text-[#101828]">{draft.inventory || "--"}</p>
                          </div>
                          <div className="rounded-[20px] border border-[#e4e9f1] bg-[#f8fbff] px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.16em] text-[#8b97a8]">Priority</p>
                            <p className="mt-2 text-lg font-semibold text-[#101828]">
                              {URGENCY_OPTIONS.find((option) => option.value === draft.urgency)?.label ?? "Steady"}
                            </p>
                            <p className="mt-1 text-xs text-[#7b8798]">
                              {URGENCY_OPTIONS.find((option) => option.value === draft.urgency)?.description}
                            </p>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b97a8]">Extracted keywords</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {extractedKeywords.length > 0 ? (
                              extractedKeywords.map((keyword) => (
                                <span
                                  className="rounded-full bg-[#eef4ff] px-3 py-1.5 text-sm font-medium text-[#1d4ed8]"
                                  key={`preview-${keyword}`}
                                >
                                  {keyword}
                                </span>
                              ))
                            ) : (
                              <p className="text-sm leading-6 text-[#7b8798]">
                                The key phrases extracted from your paragraph will show up here.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </aside>
              </div>
            </div>
          </div>
        </section>
      </WorkspaceShell>

      <AuthModal
        onAuthSuccess={() => {
          setAuthOpen(false);
          setIsAuthenticated(true);
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </>
  );
}
