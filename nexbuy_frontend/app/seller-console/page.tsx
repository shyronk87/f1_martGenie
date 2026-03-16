"use client";

import { useMemo, useState } from "react";
import { clearAccessToken, readAccessToken } from "@/lib/auth";
import AuthModal from "@/src/components/AuthModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

type SellerUrgency = "HOT" | "NORMAL" | "URGENT";

type SellerListing = {
  id: string;
  title: string;
  imageUrl: string;
  category: string;
  description: string;
  salePrice: number;
  floorPrice: number;
  inventory: number;
  urgency: SellerUrgency;
  specs: Array<{ label: string; value: string }>;
};

const INITIAL_LISTINGS: SellerListing[] = [
  {
    id: "seller-1",
    title: "Tatta Woven Rope Outdoor Orange Adjustable Patio Chaise Lounge",
    imageUrl: "https://img5.su-cdn.com/cdn-cgi/image/width=750,height=750,format=webp/mall/file/2023/08/18/70fd4556ff34417f9326d7bc2051b2d0.jpg",
    category: "Outdoor Seating",
    description: "Adjustable patio chaise built for outdoor lounging with woven rope structure and vivid accent color.",
    salePrice: 899,
    floorPrice: 729,
    inventory: 32,
    urgency: "HOT",
    specs: [
      { label: "Material", value: "Rope + Aluminum" },
      { label: "Color", value: "Orange" },
      { label: "Adjustable", value: "Yes" },
      { label: "Use", value: "Outdoor" },
    ],
  },
  {
    id: "seller-2",
    title: "Modern White Velvet Upholstered Sofa",
    imageUrl: "https://img5.su-cdn.com/cdn-cgi/image/width=750,height=750,format=webp/mall/file/2022/06/29/f7a667c79a54d587424a51794e842bf0.jpg",
    category: "Living Room / Sofa",
    description: "Soft modern sofa with clean silhouette, light upholstery, and broad appeal for living-room packages.",
    salePrice: 1999,
    floorPrice: 1649,
    inventory: 84,
    urgency: "NORMAL",
    specs: [
      { label: "Seats", value: "3" },
      { label: "Material", value: "Velvet" },
      { label: "Color", value: "White" },
      { label: "Style", value: "Modern" },
    ],
  },
];

function buildEmptyListing(index: number): SellerListing {
  return {
    id: `seller-new-${index}`,
    title: "",
    imageUrl: "",
    category: "",
    description: "",
    salePrice: 0,
    floorPrice: 0,
    inventory: 0,
    urgency: "NORMAL",
    specs: [
      { label: "Material", value: "" },
      { label: "Color", value: "" },
      { label: "Dimension", value: "" },
      { label: "Feature", value: "" },
    ],
  };
}

function formatMoney(value: number) {
  return `$${value.toLocaleString()}`;
}

export default function SellerConsolePage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAccessToken()));
  const [listings, setListings] = useState<SellerListing[]>(INITIAL_LISTINGS);
  const [activeListingId, setActiveListingId] = useState(INITIAL_LISTINGS[0]?.id ?? "");
  const [saveMessage, setSaveMessage] = useState("");

  const activeListing =
    listings.find((listing) => listing.id === activeListingId) ?? listings[0] ?? buildEmptyListing(0);

  const pricingSpread = useMemo(() => {
    const spread = Math.max(0, activeListing.salePrice - activeListing.floorPrice);
    const ratio = activeListing.salePrice > 0 ? Math.round((spread / activeListing.salePrice) * 100) : 0;
    return { spread, ratio };
  }, [activeListing.floorPrice, activeListing.salePrice]);

  function updateActiveListing(patch: Partial<SellerListing>) {
    setListings((current) =>
      current.map((listing) => (listing.id === activeListing.id ? { ...listing, ...patch } : listing)),
    );
    setSaveMessage("");
  }

  function updateSpec(index: number, key: "label" | "value", value: string) {
    const nextSpecs = activeListing.specs.map((spec, specIndex) =>
      specIndex === index ? { ...spec, [key]: value } : spec,
    );
    updateActiveListing({ specs: nextSpecs });
  }

  function handleCreateListing() {
    const next = buildEmptyListing(listings.length + 1);
    setListings((current) => [next, ...current]);
    setActiveListingId(next.id);
    setSaveMessage("");
  }

  function handleSaveMock() {
    setSaveMessage("Mock product draft saved locally.");
  }

  return (
    <>
      <WorkspaceShell
        currentPath="/seller-console"
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          clearAccessToken();
          setIsAuthenticated(false);
        }}
      >
        <section className="h-full overflow-y-auto px-6 py-8">
          <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="rounded-[30px] border border-[#dbe4ef] bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] p-5 shadow-[0_20px_50px_rgba(148,163,184,0.12)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7c8da5]">Seller console</p>
                  <h1 className="mt-2 text-3xl font-black tracking-[-0.05em] text-[#101828]">Manage listing inputs</h1>
                </div>
                <button
                  className="inline-flex h-11 items-center rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-4 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(15,23,42,0.18)] transition hover:brightness-105"
                  onClick={handleCreateListing}
                  type="button"
                >
                  New item
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {listings.map((listing) => (
                  <button
                    className={`flex w-full items-center gap-3 rounded-[24px] border px-3 py-3 text-left transition ${
                      listing.id === activeListing.id
                        ? "border-[#bfd7f5] bg-[linear-gradient(180deg,#eef6ff_0%,#dbeafe_100%)] shadow-[0_14px_32px_rgba(59,130,246,0.12)]"
                        : "border-[#dfe6ef] bg-white hover:border-[#c8d4e3] hover:bg-[#fbfdff]"
                    }`}
                    key={listing.id}
                    onClick={() => setActiveListingId(listing.id)}
                    type="button"
                  >
                    {listing.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={listing.title || "Listing image"} className="h-16 w-16 rounded-[18px] object-cover" src={listing.imageUrl} />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#e0ecff,#f8fafc)] text-xs font-semibold text-[#5b6b82]">
                        No image
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#101828]">
                        {listing.title || "Untitled draft"}
                      </p>
                      <p className="mt-1 text-xs text-[#667085]">
                        {listing.category || "No category"} · {listing.inventory} in stock
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <section className="rounded-[30px] border border-[#dbe4ef] bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] p-6 shadow-[0_20px_50px_rgba(148,163,184,0.12)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7c8da5]">Listing editor</p>
                  <h2 className="mt-2 text-3xl font-black tracking-[-0.05em] text-[#101828]">Product information</h2>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <label className="block md:col-span-2">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">Image URL</span>
                      <input className="h-12 w-full rounded-2xl border border-[#d7e1ec] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#9dc0e6]" onChange={(event) => updateActiveListing({ imageUrl: event.target.value })} value={activeListing.imageUrl} />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">Title</span>
                      <input className="h-12 w-full rounded-2xl border border-[#d7e1ec] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#9dc0e6]" onChange={(event) => updateActiveListing({ title: event.target.value })} value={activeListing.title} />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">Category</span>
                      <input className="h-12 w-full rounded-2xl border border-[#d7e1ec] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#9dc0e6]" onChange={(event) => updateActiveListing({ category: event.target.value })} value={activeListing.category} />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">Urgency</span>
                      <select className="h-12 w-full rounded-2xl border border-[#d7e1ec] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#9dc0e6]" onChange={(event) => updateActiveListing({ urgency: event.target.value as SellerUrgency })} value={activeListing.urgency}>
                        <option value="HOT">HOT</option>
                        <option value="NORMAL">NORMAL</option>
                        <option value="URGENT">URGENT</option>
                      </select>
                    </label>
                    <label className="block md:col-span-2">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">Description</span>
                      <textarea className="min-h-[120px] w-full rounded-[24px] border border-[#d7e1ec] bg-white px-4 py-3 text-sm text-[#101828] outline-none transition focus:border-[#9dc0e6]" onChange={(event) => updateActiveListing({ description: event.target.value })} value={activeListing.description} />
                    </label>
                  </div>
                </section>

                <aside className="rounded-[30px] border border-[#dbe4ef] bg-[linear-gradient(180deg,#f7fbff_0%,#eef4fb_100%)] p-6 shadow-[0_20px_50px_rgba(148,163,184,0.12)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7c8da5]">Seller rails</p>
                  <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[#101828]">Pricing and stock posture</h2>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">List price</span>
                      <input className="h-12 w-full rounded-2xl border border-[#d7e1ec] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#9dc0e6]" onChange={(event) => updateActiveListing({ salePrice: Number(event.target.value) || 0 })} type="number" value={activeListing.salePrice} />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">Lowest acceptable price</span>
                      <input className="h-12 w-full rounded-2xl border border-[#d7e1ec] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#9dc0e6]" onChange={(event) => updateActiveListing({ floorPrice: Number(event.target.value) || 0 })} type="number" value={activeListing.floorPrice} />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">Inventory</span>
                      <input className="h-12 w-full rounded-2xl border border-[#d7e1ec] bg-white px-4 text-sm text-[#101828] outline-none transition focus:border-[#9dc0e6]" onChange={(event) => updateActiveListing({ inventory: Number(event.target.value) || 0 })} type="number" value={activeListing.inventory} />
                    </label>
                  </div>

                  <div className="mt-6 grid gap-3">
                    <div className="rounded-[22px] border border-[#d8e5f1] bg-white/90 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#7c8da5]">Current list price</p>
                      <p className="mt-2 text-3xl font-black text-[#101828]">{formatMoney(activeListing.salePrice)}</p>
                    </div>
                    <div className="rounded-[22px] border border-[#d8e5f1] bg-white/90 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#7c8da5]">Negotiation floor</p>
                      <p className="mt-2 text-3xl font-black text-[#101828]">{formatMoney(activeListing.floorPrice)}</p>
                    </div>
                    <div className="rounded-[22px] border border-[#d8e5f1] bg-white/90 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#7c8da5]">Concession room</p>
                      <p className="mt-2 text-3xl font-black text-[#101828]">{formatMoney(pricingSpread.spread)}</p>
                      <p className="mt-1 text-sm text-[#667085]">{pricingSpread.ratio}% below list price</p>
                    </div>
                  </div>
                </aside>
              </div>

              <section className="rounded-[30px] border border-[#dbe4ef] bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] p-6 shadow-[0_20px_50px_rgba(148,163,184,0.12)]">
                <div className="flex flex-col gap-4 border-b border-[#e3ebf3] pb-5 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7c8da5]">Base data</p>
                    <h2 className="mt-2 text-3xl font-black tracking-[-0.05em] text-[#101828]">Specs and selling context</h2>
                  </div>
                  <button
                    className="inline-flex h-12 items-center rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] transition hover:brightness-105"
                    onClick={handleSaveMock}
                    type="button"
                  >
                    Save mock draft
                  </button>
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
                  <div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {activeListing.specs.map((spec, index) => (
                        <div className="rounded-[24px] border border-[#dde6ef] bg-white p-4" key={`${activeListing.id}-${index}`}>
                          <input
                            className="h-11 w-full rounded-2xl border border-[#d7e1ec] bg-[#fbfdff] px-4 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#9dc0e6]"
                            onChange={(event) => updateSpec(index, "label", event.target.value)}
                            placeholder="Spec label"
                            value={spec.label}
                          />
                          <input
                            className="mt-3 h-11 w-full rounded-2xl border border-[#d7e1ec] bg-[#fbfdff] px-4 text-sm text-[#101828] outline-none transition focus:border-[#9dc0e6]"
                            onChange={(event) => updateSpec(index, "value", event.target.value)}
                            placeholder="Spec value"
                            value={spec.value}
                          />
                        </div>
                      ))}
                    </div>
                    {saveMessage ? (
                      <div className="mt-4 rounded-[20px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm font-medium text-[#15803d]">
                        {saveMessage}
                      </div>
                    ) : null}
                  </div>

                  <aside className="rounded-[28px] border border-[#dbe4ef] bg-[linear-gradient(180deg,#f9fbfe_0%,#edf3fa_100%)] p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7c8da5]">Live preview</p>
                    <div className="mt-4 overflow-hidden rounded-[24px] border border-[#dbe4ef] bg-white">
                      {activeListing.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={activeListing.title || "Listing preview"} className="h-64 w-full object-cover" src={activeListing.imageUrl} />
                      ) : (
                        <div className="flex h-64 items-center justify-center bg-[linear-gradient(135deg,#e0ecff,#f8fafc)] text-sm font-medium text-[#667085]">
                          Product image preview
                        </div>
                      )}
                    </div>
                    <h3 className="mt-4 text-2xl font-black tracking-[-0.04em] text-[#101828]">
                      {activeListing.title || "Untitled draft"}
                    </h3>
                    <p className="mt-2 text-sm text-[#667085]">{activeListing.category || "No category yet"}</p>
                    <p className="mt-3 text-sm leading-7 text-[#475467]">
                      {activeListing.description || "Add a product description to help the seller agent explain concessions and defend pricing."}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <span className="rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-semibold text-[#1d4ed8]">
                        {formatMoney(activeListing.salePrice)}
                      </span>
                      <span className="rounded-full bg-[#eefaf3] px-3 py-1.5 text-xs font-semibold text-[#15803d]">
                        Floor {formatMoney(activeListing.floorPrice)}
                      </span>
                      <span className="rounded-full bg-[#f5f7fb] px-3 py-1.5 text-xs font-semibold text-[#475467]">
                        Stock {activeListing.inventory}
                      </span>
                      <span className="rounded-full bg-[#fff4e8] px-3 py-1.5 text-xs font-semibold text-[#b45309]">
                        {activeListing.urgency}
                      </span>
                    </div>
                  </aside>
                </div>
              </section>
            </div>
          </div>
        </section>
      </WorkspaceShell>

      <AuthModal
        onAuthSuccess={() => setIsAuthenticated(true)}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </>
  );
}
