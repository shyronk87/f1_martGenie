"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken, type AuthUser } from "@/lib/auth";
import {
  buildMemoryPayloadFromAnswers,
  fetchMemoryProfile,
  fetchOnboardingQuestions,
  saveMemoryProfile,
  type MemoryProfilePayload,
  type OnboardingQuestion,
} from "@/lib/memory-api";
import {
  createUserAddress,
  fetchUserAddresses,
  setDefaultUserAddress,
  updateUserAddress,
  type UserAddress,
  type UserAddressPayload,
} from "@/lib/profile-api";
import AuthModal from "@/src/components/AuthModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

function prettifyAnswer(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildAnswersFromProfile(profile: MemoryProfilePayload | null) {
  if (!profile) {
    return {} as Record<string, string | string[]>;
  }

  return {
    ...(profile.raw_answers ?? {}),
    housing_type: profile.housing_type ?? "",
    space_tier: profile.space_tier ?? "",
    room_priorities: profile.room_priorities ?? [],
    household_members: profile.household_members ?? [],
    style_preferences: profile.style_preferences ?? [],
    function_preferences: profile.function_preferences ?? [],
    price_philosophy: profile.price_philosophy ?? "",
    negative_constraints: profile.negative_constraints ?? [],
    decision_priority: profile.decision_priority ?? "",
    ...(profile.notes ? { notes_custom: profile.notes } : {}),
  } as Record<string, string | string[]>;
}

function hasAnyAnswer(answers: Record<string, string | string[]>) {
  return Object.values(answers).some((value) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : false,
  );
}

function emptyAddress(): UserAddressPayload {
  return {
    recipient_name: null,
    phone_number: null,
    country: null,
    province_state: null,
    city: null,
    district: null,
    street_line_1: null,
    street_line_2: null,
    postal_code: null,
    delivery_notes: null,
    is_default: false,
  };
}

function addressField(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value : "Not set";
}

function formatAddressLine(address: UserAddress) {
  return [address.country, address.province_state, address.city, address.district]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" / ");
}

type AddressDraft = {
  id: string | null;
  payload: UserAddressPayload;
};

export default function ProfilePage() {
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string | string[]>>({});
  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [activeSection, setActiveSection] = useState<"memory" | "address">("memory");
  const [isEditingMemory, setIsEditingMemory] = useState(false);
  const [addressDraft, setAddressDraft] = useState<AddressDraft | null>(null);

  async function bootstrap() {
    setIsLoading(true);
    setError("");

    const token = readAccessToken();
    if (!token) {
      setIsAuthenticated(false);
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const [currentUser, memory, onboardingQuestions, addressResponse] = await Promise.all([
        fetchCurrentUser(token),
        fetchMemoryProfile(),
        fetchOnboardingQuestions(),
        fetchUserAddresses(),
      ]);

      setUser(currentUser);
      setIsAuthenticated(true);
      setQuestions(onboardingQuestions);
      const initialAnswers = buildAnswersFromProfile(memory.profile);
      setAnswers(initialAnswers);
      setSavedAnswers(initialAnswers);
      setAddresses(addressResponse.addresses);
      setIsEditingMemory(false);
      setAddressDraft(null);
    } catch (bootstrapError) {
      clearAccessToken();
      setIsAuthenticated(false);
      setUser(null);
      setError(
        bootstrapError instanceof Error
          ? bootstrapError.message
          : "Could not load your profile details.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  function setMultiValue(questionKey: string, value: string, checked: boolean) {
    setAnswers((current) => {
      const previous = current[questionKey];
      const values = Array.isArray(previous) ? [...previous] : [];
      const next = checked
        ? Array.from(new Set([...values, value]))
        : values.filter((item) => item !== value);
      return { ...current, [questionKey]: next };
    });
  }

  async function handleSaveMemory() {
    setIsSaving(true);
    setError("");
    setSaveMessage("");

    try {
      await saveMemoryProfile(buildMemoryPayloadFromAnswers(answers));

      setSavedAnswers(answers);
      setIsEditingMemory(false);
      setSaveMessage("Your memory preferences have been updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your changes.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveAddress() {
    if (!addressDraft) {
      return;
    }

    setIsSaving(true);
    setError("");
    setSaveMessage("");

    try {
      const response = addressDraft.id
        ? await updateUserAddress(addressDraft.id, addressDraft.payload)
        : await createUserAddress(addressDraft.payload);
      setAddresses(response.addresses);
      setAddressDraft(null);
      setSaveMessage("Your address information has been updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your address.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSetDefaultAddress(addressId: string) {
    setError("");
    setSaveMessage("");
    try {
      const response = await setDefaultUserAddress(addressId);
      setAddresses(response.addresses);
      setSaveMessage("Default address updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update default address.");
    }
  }

  const defaultAddressId = useMemo(
    () => addresses.find((address) => address.is_default)?.id ?? null,
    [addresses],
  );

  return (
    <>
      <WorkspaceShell
        currentPath="/profile"
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          clearAccessToken();
          setIsAuthenticated(false);
          router.push("/");
        }}
      >
        <section className="h-full overflow-y-auto px-6 py-6">
          <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="rounded-[32px] border border-[#dde4ed] bg-[linear-gradient(180deg,#ffffff_0%,#f4f7fb_100%)] p-5 shadow-[0_20px_60px_rgba(148,163,184,0.12)]">
              <p className="px-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#8b97a8]">
                User details
              </p>
              <div className="mt-4 space-y-2">
                <button
                  className={`flex w-full items-center justify-between rounded-[24px] border px-4 py-4 text-left shadow-[0_12px_28px_rgba(59,130,246,0.08)] ${
                    activeSection === "memory"
                      ? "border-[#dbe3ed] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)]"
                      : "border-[#dde4ed] bg-white"
                  }`}
                  onClick={() => setActiveSection("memory")}
                  type="button"
                >
                  <span>
                    <span className="block text-sm font-semibold text-[#1d4ed8]">Long-term memory</span>
                    <span className="mt-1 block text-sm text-[#4b5563]">Review and update your saved preferences</span>
                  </span>
                  <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-semibold text-[#1d4ed8]">
                    {activeSection === "memory" ? "Active" : "Open"}
                  </span>
                </button>

                <button
                  className={`flex w-full items-center justify-between rounded-[24px] border px-4 py-4 text-left shadow-[0_12px_28px_rgba(59,130,246,0.08)] ${
                    activeSection === "address"
                      ? "border-[#dbe3ed] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)]"
                      : "border-[#dde4ed] bg-white"
                  }`}
                  onClick={() => setActiveSection("address")}
                  type="button"
                >
                  <span>
                    <span className="block text-sm font-semibold text-[#1d4ed8]">Address information</span>
                    <span className="mt-1 block text-sm text-[#4b5563]">Manage your shipping addresses</span>
                  </span>
                  <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-semibold text-[#1d4ed8]">
                    {activeSection === "address" ? "Active" : "Open"}
                  </span>
                </button>
              </div>
            </aside>

            <section className="rounded-[32px] border border-[#dde4ed] bg-white/90 shadow-[0_24px_80px_rgba(148,163,184,0.12)] backdrop-blur-xl">
              <div className="border-b border-[#e4e9f0] px-6 py-6 md:px-8">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8b97a8]">
                  {activeSection === "memory" ? "Long-term memory" : "Address information"}
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-[#101828]">
                  {activeSection === "memory" ? "Your saved shopping preferences" : "Your saved delivery addresses"}
                </h2>
                <p className="mt-3 max-w-3xl text-base leading-7 text-[#667085]">
                  {activeSection === "memory"
                    ? "Review what MartGennie already knows about your style, household, and shopping habits. Edit them anytime when your preferences change."
                    : "Save up to three addresses, choose a default one for future orders, and update any address when your delivery details change."}
                </p>
              </div>

              <div className="px-6 py-6 md:px-8">
                {isLoading ? (
                  <div className="space-y-4">
                    {[0, 1, 2].map((item) => (
                      <div
                        className="h-32 animate-pulse rounded-[28px] border border-[#e5eaf1] bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]"
                        key={item}
                      />
                    ))}
                  </div>
                ) : !isAuthenticated ? (
                  <div className="rounded-[28px] border border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 shadow-[0_16px_40px_rgba(148,163,184,0.08)]">
                    <p className="text-lg font-semibold text-[#101828]">Sign in to view your profile</p>
                    <p className="mt-2 text-sm leading-7 text-[#667085]">
                      This page stores personal preferences and shipping details, so it is only available after authentication.
                    </p>
                    <div className="mt-4">
                      <button
                        className="inline-flex h-[48px] items-center rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white"
                        onClick={() => setAuthOpen(true)}
                        type="button"
                      >
                        Sign in
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="flex items-start justify-between gap-4 rounded-[28px] border border-[#e5eaf1] bg-[#f8fafc] px-5 py-4">
                      <div>
                        <p className="text-sm font-semibold text-[#101828]">{user?.email}</p>
                        <p className="mt-1 text-sm text-[#667085]">
                          {activeSection === "memory"
                            ? hasAnyAnswer(savedAnswers)
                              ? "These are the answers currently saved to your profile."
                              : "You have not saved any long-term memory answers yet."
                            : `${addresses.length}/3 addresses saved${defaultAddressId ? ", with one set as default." : "."}`}
                        </p>
                      </div>

                      {activeSection === "memory" ? (
                        !isEditingMemory ? (
                          <button
                            className="h-[44px] shrink-0 rounded-2xl border border-[#cfd7e3] bg-white px-4 text-sm font-semibold text-[#0f172a] transition hover:border-[#bfc9d8] hover:bg-[#f9fbfd]"
                            onClick={() => {
                              setAnswers(savedAnswers);
                              setIsEditingMemory(true);
                              setError("");
                              setSaveMessage("");
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                        ) : null
                      ) : addresses.length < 3 && !addressDraft ? (
                        <button
                          className="h-[44px] shrink-0 rounded-2xl border border-[#cfd7e3] bg-white px-4 text-sm font-semibold text-[#0f172a] transition hover:border-[#bfc9d8] hover:bg-[#f9fbfd]"
                          onClick={() => {
                            setAddressDraft({ id: null, payload: { ...emptyAddress(), is_default: addresses.length === 0 } });
                            setError("");
                            setSaveMessage("");
                          }}
                          type="button"
                        >
                          Add address
                        </button>
                      ) : null}
                    </div>

                    {activeSection === "memory" ? (
                      !isEditingMemory ? (
                        hasAnyAnswer(savedAnswers) ? (
                          questions.map((question, index) => {
                            const value = savedAnswers[question.key];
                            const customAnswer =
                              question.custom_input_key ? savedAnswers[question.custom_input_key] : undefined;
                            const customValue = typeof customAnswer === "string" ? customAnswer : "";
                            const displayValues = Array.isArray(value)
                              ? value.map(prettifyAnswer)
                              : typeof value === "string" && value.trim()
                                ? value
                                    .split("\n")
                                    .map((item) => item.trim())
                                    .filter(Boolean)
                                : [];
                            const mergedDisplayValues = customValue.trim()
                              ? [...displayValues, ...customValue.split(/\n|,/).map((item: string) => item.trim()).filter(Boolean)]
                              : displayValues;

                            return (
                              <section
                                className="rounded-[28px] border border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.08)]"
                                key={question.key}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#dbeafe_0%,#bfdbfe_100%)] text-sm font-bold text-[#1d4ed8]">
                                    {index + 1}
                                  </div>
                                  <div className="w-full">
                                    <p className="text-base font-semibold text-[#101828]">{question.question}</p>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                      {mergedDisplayValues.length > 0 ? (
                                        mergedDisplayValues.map((item, itemIndex) => (
                                          <span
                                            className="rounded-full bg-[#eef2ff] px-3 py-1.5 text-sm font-medium text-[#4338ca]"
                                            key={`${question.key}-${itemIndex}-${item}`}
                                          >
                                            {item}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-sm text-[#98a2b3]">No answer saved yet.</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </section>
                            );
                          })
                        ) : (
                          <div className="rounded-[28px] border border-dashed border-[#d4dce7] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-6 py-12 text-center">
                            <p className="text-lg font-semibold text-[#101828]">No saved answers yet</p>
                            <p className="mt-2 text-sm leading-7 text-[#667085]">
                              Click edit to set your long-term shopping preferences for the first time.
                            </p>
                          </div>
                        )
                      ) : (
                        <>
                          {questions.map((question, index) => (
                            <section
                              className="rounded-[28px] border border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.08)]"
                              key={question.key}
                            >
                              <div className="flex items-start gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#dbeafe_0%,#bfdbfe_100%)] text-sm font-bold text-[#1d4ed8]">
                                  {index + 1}
                                </div>
                                <div>
                                  <p className="text-base font-semibold text-[#101828]">{question.question}</p>
                                  {question.helper_text ? (
                                    <p className="mt-2 text-sm leading-6 text-[#667085]">{question.helper_text}</p>
                                  ) : null}
                                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[#8b97a8]">
                                    {question.multi_select ? "Select all that apply" : "Select one option"}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-4">
                                {question.type === "choice" ? (
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {question.options.map((option) => {
                                      const checked = question.multi_select
                                        ? Array.isArray(answers[question.key]) && answers[question.key].includes(option)
                                        : answers[question.key] === option;

                                      return (
                                        <label
                                          className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                                            checked
                                              ? "border-[#93c5fd] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)] text-[#1d4ed8] shadow-[0_12px_28px_rgba(59,130,246,0.12)]"
                                              : "border-[#dbe3ed] bg-[#f8fafc] text-[#475467] hover:border-[#c7d2e2] hover:bg-white"
                                          }`}
                                          key={option}
                                        >
                                          <span
                                            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                                              checked
                                                ? "border-[#60a5fa] bg-[#2563eb] text-white"
                                                : "border-[#c5d0dd] bg-white text-transparent"
                                            }`}
                                          >
                                            ✓
                                          </span>
                                          <input
                                            checked={checked}
                                            className="sr-only"
                                            name={question.key}
                                            onChange={(event) =>
                                              question.multi_select
                                                ? setMultiValue(question.key, option, event.target.checked)
                                                : setAnswers((current) => ({ ...current, [question.key]: option }))
                                            }
                                            type={question.multi_select ? "checkbox" : "radio"}
                                          />
                                          <span>{prettifyAnswer(option)}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <textarea
                                    className="min-h-[128px] w-full rounded-[24px] border border-[#d7dee8] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 text-sm text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#93c5fd] focus:shadow-[0_0_0_4px_rgba(147,197,253,0.18)]"
                                    onChange={(event) =>
                                      setAnswers((current) => ({ ...current, [question.key]: event.target.value }))
                                    }
                                    placeholder={question.placeholder ?? "Type your answer here..."}
                                    value={typeof answers[question.key] === "string" ? answers[question.key] : ""}
                                  />
                                )}
                              </div>

                              {question.allow_custom_input && question.custom_input_key ? (
                                <div className="mt-4">
                                  <label className="block">
                                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[#8b97a8]">
                                      {question.custom_input_label ?? "Other details"}
                                    </span>
                                    <textarea
                                      className="min-h-[96px] w-full rounded-[20px] border border-[#d7dee8] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 text-sm text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#93c5fd] focus:shadow-[0_0_0_4px_rgba(147,197,253,0.18)]"
                                      onChange={(event) =>
                                        setAnswers((current) => ({
                                          ...current,
                                          [question.custom_input_key as string]: event.target.value,
                                        }))
                                      }
                                      placeholder={question.custom_input_placeholder ?? "Add anything else..."}
                                      value={
                                        typeof answers[question.custom_input_key] === "string"
                                          ? answers[question.custom_input_key]
                                          : ""
                                      }
                                    />
                                  </label>
                                </div>
                              ) : null}
                            </section>
                          ))}

                          <div className="flex justify-end gap-2 pt-2">
                            <button
                              className="h-[44px] rounded-2xl border border-[#d8dee8] bg-white px-4 text-sm font-semibold text-[#475467] transition hover:bg-[#f8fafc]"
                              onClick={() => {
                                setAnswers(savedAnswers);
                                setIsEditingMemory(false);
                                setError("");
                                setSaveMessage("");
                              }}
                              type="button"
                            >
                              Cancel
                            </button>
                            <button
                              className="h-[44px] rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-4 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.22)] transition hover:brightness-105 disabled:opacity-60"
                              disabled={isSaving}
                              onClick={handleSaveMemory}
                              type="button"
                            >
                              {isSaving ? "Saving..." : "Save"}
                            </button>
                          </div>
                        </>
                      )
                    ) : (
                      <>
                        {addresses.length > 0 ? (
                          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {addresses.map((address) => (
                              <section
                                className="rounded-[28px] border border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.08)]"
                                key={address.id}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-base font-semibold text-[#101828]">
                                      {addressField(address.recipient_name)}
                                    </p>
                                    <p className="mt-1 text-sm text-[#667085]">{addressField(address.phone_number)}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {address.is_default ? (
                                      <span className="rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-semibold text-[#2563eb]">
                                        Default
                                      </span>
                                    ) : null}
                                    <button
                                      className="rounded-2xl border border-[#d8dee8] bg-white px-3 py-2 text-xs font-semibold text-[#475467] transition hover:bg-[#f8fafc]"
                                      onClick={() => {
                                        const { id, ...payload } = address;
                                        setAddressDraft({ id, payload });
                                        setError("");
                                        setSaveMessage("");
                                      }}
                                      type="button"
                                    >
                                      Edit
                                    </button>
                                  </div>
                                </div>
                                <div className="mt-4 space-y-2 text-sm text-[#475467]">
                                  <p>{formatAddressLine(address) || "Region not set"}</p>
                                  <p>{addressField(address.street_line_1)}</p>
                                  {address.street_line_2 ? <p>{address.street_line_2}</p> : null}
                                  <p>{addressField(address.postal_code)}</p>
                                  {address.delivery_notes ? <p>{address.delivery_notes}</p> : null}
                                </div>
                                {!address.is_default ? (
                                  <button
                                    className="mt-4 rounded-2xl border border-[#d8dee8] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] transition hover:border-[#bfc9d8] hover:bg-[#f9fbfd]"
                                    onClick={() => void handleSetDefaultAddress(address.id)}
                                    type="button"
                                  >
                                    Set as default
                                  </button>
                                ) : null}
                              </section>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-[28px] border border-dashed border-[#d4dce7] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-6 py-12 text-center">
                            <p className="text-lg font-semibold text-[#101828]">No saved addresses yet</p>
                            <p className="mt-2 text-sm leading-7 text-[#667085]">
                              Add up to three shipping addresses and choose one as the default address for future orders.
                            </p>
                          </div>
                        )}

                        {addressDraft ? (
                          <section className="rounded-[28px] border border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.08)]">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="text-base font-semibold text-[#101828]">
                                  {addressDraft.id ? "Edit address" : "Add a new address"}
                                </p>
                                <p className="mt-1 text-sm text-[#667085]">
                                  Save complete delivery details for shipping and logistics.
                                </p>
                              </div>
                              <label className="flex items-center gap-2 text-sm font-medium text-[#475467]">
                                <input
                                  checked={addressDraft.payload.is_default}
                                  onChange={(event) =>
                                    setAddressDraft((current) =>
                                      current
                                        ? { ...current, payload: { ...current.payload, is_default: event.target.checked } }
                                        : current,
                                    )
                                  }
                                  type="checkbox"
                                />
                                Default address
                              </label>
                            </div>

                            <div className="mt-5 grid gap-4 md:grid-cols-2">
                              {[
                                ["recipient_name", "Recipient", "Full name"],
                                ["phone_number", "Phone", "Phone number"],
                                ["country", "Country", "Country"],
                                ["province_state", "Province / State", "Province or state"],
                                ["city", "City", "City"],
                                ["district", "District", "District"],
                                ["street_line_1", "Street line 1", "Street address"],
                                ["street_line_2", "Street line 2", "Apartment, suite, etc. (optional)"],
                                ["postal_code", "Postal code", "Postal code"],
                              ].map(([key, label, placeholder]) => (
                                <label
                                  className="rounded-[28px] border border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.08)]"
                                  key={key}
                                >
                                  <span className="mb-3 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                                    {label}
                                  </span>
                                  <input
                                    className="h-12 w-full rounded-2xl border border-[#d7dee8] bg-white px-4 text-sm text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#93c5fd] focus:shadow-[0_0_0_4px_rgba(147,197,253,0.18)]"
                                    onChange={(event) =>
                                      setAddressDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              payload: {
                                                ...current.payload,
                                                [key]: event.target.value || null,
                                              },
                                            }
                                          : current,
                                      )
                                    }
                                    placeholder={placeholder}
                                    value={(addressDraft.payload[key as keyof UserAddressPayload] as string | null) ?? ""}
                                  />
                                </label>
                              ))}
                              <label className="rounded-[28px] border border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.08)] md:col-span-2">
                                <span className="mb-3 block text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                                  Delivery notes
                                </span>
                                <textarea
                                  className="min-h-[120px] w-full rounded-[24px] border border-[#d7dee8] bg-white p-4 text-sm text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#93c5fd] focus:shadow-[0_0_0_4px_rgba(147,197,253,0.18)]"
                                  onChange={(event) =>
                                    setAddressDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            payload: {
                                              ...current.payload,
                                              delivery_notes: event.target.value || null,
                                            },
                                          }
                                        : current,
                                    )
                                  }
                                  placeholder="Delivery notes, landmark, gate code, or other instructions..."
                                  value={addressDraft.payload.delivery_notes ?? ""}
                                />
                              </label>
                            </div>

                            <div className="mt-5 flex justify-end gap-2">
                              <button
                                className="h-[44px] rounded-2xl border border-[#d8dee8] bg-white px-4 text-sm font-semibold text-[#475467] transition hover:bg-[#f8fafc]"
                                onClick={() => {
                                  setAddressDraft(null);
                                  setError("");
                                  setSaveMessage("");
                                }}
                                type="button"
                              >
                                Cancel
                              </button>
                              <button
                                className="h-[44px] rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-4 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.22)] transition hover:brightness-105 disabled:opacity-60"
                                disabled={isSaving}
                                onClick={handleSaveAddress}
                                type="button"
                              >
                                {isSaving ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </section>
                        ) : null}
                      </>
                    )}

                    {error ? (
                      <div className="rounded-[20px] border border-[#fecaca] bg-[#fff1f2] px-4 py-3 text-sm font-medium text-[#b42318]">
                        {error}
                      </div>
                    ) : null}

                    {saveMessage ? (
                      <div className="rounded-[20px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm font-medium text-[#15803d]">
                        {saveMessage}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
      </WorkspaceShell>
      <AuthModal
        onAuthSuccess={async () => {
          await bootstrap();
          setError("");
          setSaveMessage("");
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </>
  );
}
