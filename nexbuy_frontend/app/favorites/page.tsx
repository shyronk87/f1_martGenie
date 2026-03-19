"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearAccessToken, fetchCurrentUser, logoutSession, readAccessToken } from "@/lib/auth";
import {
  deleteFavoriteBundle,
  deleteFavoriteProduct,
  fetchFavoriteBundles,
  fetchFavoriteProducts,
  type FavoriteBundleItem,
  type FavoriteProductItem,
} from "@/lib/favorites-api";
import { clearCurrentOrder, setOrderCheckout } from "@/lib/order-store";
import AuthModal from "@/src/components/AuthModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

function getSpecEntries(specs: Record<string, string> | null | undefined) {
  if (!specs) {
    return [];
  }

  return Object.entries(specs)
    .map(([label, value]) => [label.trim(), String(value ?? "").trim()] as const)
    .filter(([, value]) => value.length > 0)
    .slice(0, 6);
}

export default function FavoritesPage() {
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAccessToken()));
  const [activeSection, setActiveSection] = useState<"products" | "bundles">("products");
  const [favoriteProducts, setFavoriteProducts] = useState<FavoriteProductItem[]>([]);
  const [favoriteBundles, setFavoriteBundles] = useState<FavoriteBundleItem[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [removingProductSku, setRemovingProductSku] = useState<string | null>(null);
  const [removingBundleId, setRemovingBundleId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const token = readAccessToken();
      if (!token) {
        if (!cancelled) {
          setIsAuthenticated(false);
          setFavoriteProducts([]);
          setFavoriteBundles([]);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        await fetchCurrentUser(token);
        const [products, bundles] = await Promise.all([fetchFavoriteProducts(), fetchFavoriteBundles()]);
        if (cancelled) {
          return;
        }
        setIsAuthenticated(true);
        setFavoriteProducts(products);
        setFavoriteBundles(bundles);
      } catch (bootstrapError) {
        if (cancelled) {
          return;
        }
        clearAccessToken();
        setIsAuthenticated(false);
        setFavoriteProducts([]);
        setFavoriteBundles([]);
        setError(bootstrapError instanceof Error ? bootstrapError.message : "Could not load your favorites.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRemoveProduct(skuIdDefault: string) {
    setRemovingProductSku(skuIdDefault);
    setError("");
    try {
      await deleteFavoriteProduct(skuIdDefault);
      setFavoriteProducts((current) => current.filter((item) => item.sku_id_default !== skuIdDefault));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove this item.");
    } finally {
      setRemovingProductSku(null);
    }
  }

  async function handleRemoveBundle(bundleId: string) {
    setRemovingBundleId(bundleId);
    setError("");
    try {
      await deleteFavoriteBundle(bundleId);
      setFavoriteBundles((current) => current.filter((item) => item.bundle_id !== bundleId));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove this bundle.");
    } finally {
      setRemovingBundleId(null);
    }
  }

  function handlePlaceProductOrder(item: FavoriteProductItem) {
    const price = item.sale_price ?? 0;
    clearCurrentOrder();
    setOrderCheckout({
      source: "favorites",
      packageTitle: item.title,
      summary: item.recommendation_reason ?? item.description_text ?? "Saved from your favorites.",
      items: [
        {
          sku: item.sku_id_default,
          title: item.title,
          price,
          quantity: 1,
          imageUrl: item.image_url ?? null,
        },
      ],
      subtotal: price,
      negotiatedSavings: 0,
    });
    router.push("/order");
  }

  function handlePlaceBundleOrder(bundle: FavoriteBundleItem) {
    clearCurrentOrder();
    setOrderCheckout({
      source: "favorites",
      packageId: bundle.bundle_id,
      packageTitle: bundle.title,
      summary: bundle.summary ?? "Saved from your favorite bundles.",
      items: bundle.items.map((item) => ({
        sku: item.sku,
        title: item.title,
        price: item.price,
        quantity: item.quantity,
        imageUrl: item.imageUrl ?? null,
      })),
      subtotal: bundle.total_price ?? bundle.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      negotiatedSavings: 0,
    });
    router.push("/order");
  }

  const counts = {
    products: favoriteProducts.length,
    bundles: favoriteBundles.length,
  };

  return (
    <>
      <WorkspaceShell
        currentPath="/favorites"
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          void logoutSession().finally(() => {
            setIsAuthenticated(false);
            setFavoriteProducts([]);
            setFavoriteBundles([]);
            router.push("/chat");
          });
        }}
      >
        <section className="h-full overflow-y-auto px-6 py-6">
          <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="rounded-[32px] border border-[#dde4ed] bg-[linear-gradient(180deg,#ffffff_0%,#f4f7fb_100%)] p-5 shadow-[0_20px_60px_rgba(148,163,184,0.12)]">
              <p className="px-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#8b97a8]">My likes</p>
              <div className="mt-4 space-y-2">
                <button
                  className={`flex w-full items-center justify-between rounded-[24px] border px-4 py-4 text-left shadow-[0_12px_28px_rgba(59,130,246,0.08)] ${
                    activeSection === "products"
                      ? "border-[#dbe3ed] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)]"
                      : "border-[#dde4ed] bg-white"
                  }`}
                  onClick={() => setActiveSection("products")}
                  type="button"
                >
                  <span>
                    <span className="block text-sm font-semibold text-[#1d4ed8]">Single products</span>
                    <span className="mt-1 block text-sm text-[#4b5563]">Items you may want to revisit later.</span>
                  </span>
                  <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-semibold text-[#1d4ed8]">
                    {counts.products}
                  </span>
                </button>
                <button
                  className={`flex w-full items-center justify-between rounded-[24px] border px-4 py-4 text-left shadow-[0_12px_28px_rgba(59,130,246,0.08)] ${
                    activeSection === "bundles"
                      ? "border-[#dbe3ed] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)]"
                      : "border-[#dde4ed] bg-white"
                  }`}
                  onClick={() => setActiveSection("bundles")}
                  type="button"
                >
                  <span>
                    <span className="block text-sm font-semibold text-[#1d4ed8]">Product bundles</span>
                    <span className="mt-1 block text-sm text-[#4b5563]">Complete package sets you saved from recommendations.</span>
                  </span>
                  <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-semibold text-[#1d4ed8]">
                    {counts.bundles}
                  </span>
                </button>
              </div>
            </aside>

            <div className="rounded-[32px] border border-[#dde4ed] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbfd_100%)] p-6 shadow-[0_20px_60px_rgba(148,163,184,0.14)]">
              <div className="border-b border-[#e5eaf1] pb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Favorites</p>
                <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.04em] text-[#101828]">
                  {activeSection === "products" ? "Products you want to keep close" : "Bundles worth coming back to"}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-[#526173]">
                  {activeSection === "products"
                    ? "Save products from Plaza or Packages, then compare them, order them, or remove them later."
                    : "Save full recommendation sets, reopen them when you want the whole look, and order them in one go."}
                </p>
              </div>

              {error ? (
                <div className="mt-5 rounded-[20px] border border-[#f2c7cf] bg-[#fff6f7] px-4 py-3 text-sm text-[#b42318]">
                  {error}
                </div>
              ) : null}

              {!isAuthenticated ? (
                <div className="mt-6 rounded-[28px] border border-dashed border-[#d4dce7] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-6 py-16 text-center">
                  <p className="text-2xl font-semibold tracking-[-0.03em] text-[#101828]">Sign in to see your liked items</p>
                  <button
                    className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white"
                    onClick={() => setAuthOpen(true)}
                    type="button"
                  >
                    Sign in
                  </button>
                </div>
              ) : isLoading ? (
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div className="rounded-[28px] border border-[#e2e8f0] bg-white p-5" key={index}>
                      <div className="h-52 animate-pulse rounded-[20px] bg-[#e5e7eb]" />
                      <div className="mt-4 h-6 w-2/3 animate-pulse rounded bg-[#e5e7eb]" />
                      <div className="mt-3 h-4 w-full animate-pulse rounded bg-[#e5e7eb]" />
                    </div>
                  ))}
                </div>
              ) : activeSection === "products" ? (
                favoriteProducts.length === 0 ? (
                  <div className="mt-6 rounded-[28px] border border-dashed border-[#d4dce7] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-6 py-16 text-center">
                    <p className="text-2xl font-semibold tracking-[-0.03em] text-[#101828]">No liked products yet</p>
                    <p className="mt-3 text-sm leading-7 text-[#667085]">
                      Tap the heart on products in Plaza or Packages and they will show up here.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 grid gap-5 lg:grid-cols-2">
                    {favoriteProducts.map((item) => (
                      <article
                        className="overflow-hidden rounded-[28px] border border-[#dde5ef] bg-white shadow-[0_16px_36px_rgba(148,163,184,0.12)]"
                        key={item.sku_id_default}
                      >
                        {item.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={item.title} className="h-56 w-full object-cover" src={item.image_url} />
                        ) : (
                          <div className="h-56 bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]" />
                        )}
                        <div className="space-y-4 p-5">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                              {item.category_label || item.source_page || "Saved item"}
                            </p>
                            <h2 className="mt-2 text-xl font-semibold leading-8 tracking-[-0.03em] text-[#101828]">
                              {item.title}
                            </h2>
                            {item.description_text ? (
                              <p className="mt-3 text-sm leading-7 text-[#667085]">{item.description_text}</p>
                            ) : null}
                          </div>
                          {item.recommendation_reason ? (
                            <div className="rounded-[20px] border border-[#e8edf4] bg-[#f8fbff] px-4 py-3 text-sm leading-6 text-[#475467]">
                              {item.recommendation_reason}
                            </div>
                          ) : null}
                          {getSpecEntries(item.specs).length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {getSpecEntries(item.specs).map(([label, value]) => (
                                <span
                                  className="rounded-full border border-[#d9e4f2] bg-white px-3 py-1.5 text-sm text-[#344054]"
                                  key={`${item.sku_id_default}-${label}`}
                                >
                                  {label}: {value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="flex items-center justify-between gap-3 border-t border-[#e8edf4] pt-4">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-[#8b97a8]">Price</p>
                              <p className="mt-1 text-2xl font-black text-[#101828]">
                                {typeof item.sale_price === "number" ? `$${item.sale_price.toLocaleString()}` : "--"}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                className="inline-flex h-11 items-center justify-center rounded-full border border-[#d5dde8] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:bg-[#f8fafc]"
                                disabled={removingProductSku === item.sku_id_default}
                                onClick={() => void handleRemoveProduct(item.sku_id_default)}
                                type="button"
                              >
                                Remove
                              </button>
                              <button
                                className="inline-flex h-11 items-center justify-center rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white"
                                onClick={() => handlePlaceProductOrder(item)}
                                type="button"
                              >
                                Place order
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )
              ) : favoriteBundles.length === 0 ? (
                <div className="mt-6 rounded-[28px] border border-dashed border-[#d4dce7] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-6 py-16 text-center">
                  <p className="text-2xl font-semibold tracking-[-0.03em] text-[#101828]">No liked bundles yet</p>
                  <p className="mt-3 text-sm leading-7 text-[#667085]">
                    Tap the heart on package options in Packages and they will show up here.
                  </p>
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  {favoriteBundles.map((bundle) => (
                    <article
                      className="overflow-hidden rounded-[28px] border border-[#dde5ef] bg-white shadow-[0_16px_36px_rgba(148,163,184,0.12)]"
                      key={bundle.bundle_id}
                    >
                      <div className="border-b border-[#e8edf4] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                              {bundle.source_page || "Saved bundle"}
                            </p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#101828]">{bundle.title}</h2>
                            {bundle.summary ? (
                              <p className="mt-3 max-w-3xl text-sm leading-7 text-[#667085]">{bundle.summary}</p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <p className="text-xs uppercase tracking-[0.16em] text-[#8b97a8]">Bundle total</p>
                            <p className="mt-1 text-2xl font-black text-[#101828]">
                              {typeof bundle.total_price === "number"
                                ? `$${bundle.total_price.toLocaleString()}`
                                : `$${bundle.items.reduce((sum, item) => sum + item.price * item.quantity, 0).toLocaleString()}`}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-4 p-5 md:grid-cols-3">
                        {bundle.items.map((item) => (
                          <div className="rounded-[22px] border border-[#e8edf4] bg-[#f8fbff] p-4" key={`${bundle.bundle_id}-${item.sku}`}>
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img alt={item.title} className="h-36 w-full rounded-[18px] object-cover" src={item.imageUrl} />
                            ) : (
                              <div className="h-36 rounded-[18px] bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]" />
                            )}
                            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#8b97a8]">
                              {item.categoryLabel || "Bundle item"}
                            </p>
                            <h3 className="mt-2 text-base font-semibold leading-7 text-[#101828]">{item.title}</h3>
                            <p className="mt-2 text-sm font-semibold text-[#1f2937]">${item.price.toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-end gap-3 border-t border-[#e8edf4] p-5">
                        <button
                          className="inline-flex h-11 items-center justify-center rounded-full border border-[#d5dde8] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:bg-[#f8fafc]"
                          disabled={removingBundleId === bundle.bundle_id}
                          onClick={() => void handleRemoveBundle(bundle.bundle_id)}
                          type="button"
                        >
                          Remove
                        </button>
                        <button
                          className="inline-flex h-11 items-center justify-center rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white"
                          onClick={() => handlePlaceBundleOrder(bundle)}
                          type="button"
                        >
                          Place order
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </WorkspaceShell>

      <AuthModal
        onAuthSuccess={async () => {
          const token = readAccessToken();
          if (!token) {
            return;
          }
          await fetchCurrentUser(token);
          setIsAuthenticated(true);
          const [products, bundles] = await Promise.all([fetchFavoriteProducts(), fetchFavoriteBundles()]);
          setFavoriteProducts(products);
          setFavoriteBundles(bundles);
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </>
  );
}
