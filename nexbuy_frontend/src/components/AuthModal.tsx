"use client";

import { useEffect, useState } from "react";
import {
  fetchMemoryProfile,
  fetchOnboardingQuestions,
  MemoryProfilePayload,
  OnboardingQuestion,
  saveMemoryProfile,
} from "@/lib/memory-api";
import AuthForm from "@/src/components/AuthForm";

type Props = {
  open: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void;
};

export default function AuthModal({ open, onClose, onAuthSuccess }: Props) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const [onboardingError, setOnboardingError] = useState("");

  useEffect(() => {
    if (!open) {
      setShowOnboarding(false);
      setQuestions([]);
      setAnswers({});
      setIsSavingOnboarding(false);
      setOnboardingError("");
    }
  }, [open]);

  function setMultiValue(questionKey: string, value: string, checked: boolean) {
    setAnswers((current) => {
      const prev = current[questionKey];
      const arr = Array.isArray(prev) ? [...prev] : [];
      const next = checked ? Array.from(new Set([...arr, value])) : arr.filter((v) => v !== value);
      return { ...current, [questionKey]: next };
    });
  }

  async function handleAuthenticated() {
    const memory = await fetchMemoryProfile();

    if (memory.onboarding_required) {
      const onboardingQuestions = await fetchOnboardingQuestions();
      setQuestions(onboardingQuestions);
      setAnswers({});
      setOnboardingError("");
      setShowOnboarding(true);
      return;
    }

    await onAuthSuccess?.();
    onClose();
  }

  async function handleSubmitOnboarding() {
    setIsSavingOnboarding(true);
    setOnboardingError("");

    try {
      const negativeInput = answers.negative_constraints;
      const negativeConstraints = Array.isArray(negativeInput)
        ? negativeInput
        : typeof negativeInput === "string"
          ? negativeInput
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean)
          : [];

      const payload: MemoryProfilePayload = {
        housing_type: typeof answers.housing_type === "string" ? answers.housing_type : null,
        space_tier: null,
        household_members: Array.isArray(answers.household_members) ? answers.household_members : [],
        style_preferences: Array.isArray(answers.style_preferences) ? answers.style_preferences : [],
        price_philosophy:
          typeof answers.price_philosophy === "string" ? answers.price_philosophy : null,
        negative_constraints: negativeConstraints,
        raw_answers: answers,
      };

      await saveMemoryProfile(payload);
      await onAuthSuccess?.();
      onClose();
    } catch (error) {
      setOnboardingError(error instanceof Error ? error.message : "Failed to save onboarding.");
    } finally {
      setIsSavingOnboarding(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.46)] px-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
    >
      <div
        className={`w-full ${showOnboarding ? "max-w-[1080px]" : "max-w-[680px]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex justify-end">
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/55 bg-white/85 text-2xl text-[#2f2a26] shadow-[0_14px_32px_rgba(15,23,42,0.16)] transition hover:bg-white"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        {showOnboarding ? (
          <div className="overflow-hidden rounded-[36px] border border-white/50 bg-[linear-gradient(135deg,rgba(255,255,255,0.92)_0%,rgba(242,246,251,0.92)_100%)] shadow-[0_36px_100px_rgba(15,23,42,0.2)] backdrop-blur-xl">
            <div className="grid min-h-[720px] lg:grid-cols-[0.95fr_1.25fr]">
              <aside className="relative overflow-hidden border-b border-[#d9e3ee] bg-[linear-gradient(180deg,#0f172a_0%,#131f36_48%,#172554_100%)] px-7 py-8 text-white lg:border-b-0 lg:border-r">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.22),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(96,165,250,0.18),transparent_18%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.08),transparent_30%)]" />
                <div className="relative">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-100/70">
                    Welcome to MartGennie
                  </p>
                  <h3 className="mt-4 max-w-sm text-4xl font-black tracking-[-0.05em]">
                    Let&apos;s make your next recommendations feel personal.
                  </h3>
                  <p className="mt-4 max-w-sm text-base leading-7 text-slate-200/80">
                    Answer a few quick questions once. We will use them to shape your product picks, bundles, and future negotiations across the platform.
                  </p>

                  <div className="mt-10 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                    <div className="rounded-[24px] border border-white/10 bg-white/8 p-4 backdrop-blur-md">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Step</p>
                      <p className="mt-2 text-2xl font-black">{questions.length} questions</p>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-white/8 p-4 backdrop-blur-md">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Time</p>
                      <p className="mt-2 text-2xl font-black">1 minute</p>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-white/8 p-4 backdrop-blur-md">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Result</p>
                      <p className="mt-2 text-2xl font-black">Smarter picks</p>
                    </div>
                  </div>
                </div>
              </aside>

              <section className="relative bg-[linear-gradient(180deg,#fbfcfe_0%,#f3f6fa_100%)]">
                <div className="border-b border-[#e1e7ef] px-6 py-5 md:px-8">
                  <p className="text-sm font-semibold text-[#101828]">Your shopping profile</p>
                  <p className="mt-1 text-sm text-[#667085]">
                    Pick the options that sound like you. You can refine them later.
                  </p>
                </div>

                <div className="custom-onboarding-scroll max-h-[540px] overflow-y-auto px-6 py-6 md:px-8">
                  <div className="space-y-4">
                    {questions.map((question, index) => (
                      <section
                        className="rounded-[28px] border border-[#dde5ef] bg-white/88 p-5 shadow-[0_16px_40px_rgba(148,163,184,0.1)] backdrop-blur-sm"
                        key={question.key}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#dbeafe_0%,#bfdbfe_100%)] text-sm font-bold text-[#1d4ed8]">
                            {index + 1}
                          </div>
                          <div>
                            <p className="text-base font-semibold text-[#101828]">{question.question}</p>
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
                                  ? Array.isArray(answers[question.key]) &&
                                    answers[question.key].includes(option)
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
                                    <span>{option}</span>
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
                              placeholder="Add one preference or constraint per line..."
                              value={typeof answers[question.key] === "string" ? answers[question.key] : ""}
                            />
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#e1e7ef] bg-white/70 px-6 py-5 md:px-8">
                  {onboardingError ? <p className="mb-3 text-sm text-[#c24157]">{onboardingError}</p> : null}
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-[#667085]">
                      Your answers will be saved to personalize future shopping sessions.
                    </p>
                    <button
                      className="h-[52px] shrink-0 rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.22)] transition hover:brightness-105 disabled:opacity-60"
                      disabled={isSavingOnboarding}
                      onClick={handleSubmitOnboarding}
                      type="button"
                    >
                      {isSavingOnboarding ? "Saving..." : "Save and continue"}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <AuthForm onSuccess={handleAuthenticated} />
        )}

        <style jsx global>{`
          .custom-onboarding-scroll::-webkit-scrollbar {
            width: 10px;
          }

          .custom-onboarding-scroll::-webkit-scrollbar-track {
            background: rgba(226, 232, 240, 0.5);
            border-radius: 999px;
          }

          .custom-onboarding-scroll::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, rgba(148, 163, 184, 0.9), rgba(100, 116, 139, 0.9));
            border-radius: 999px;
            border: 2px solid rgba(248, 250, 252, 0.9);
          }
        `}</style>
      </div>
    </div>
  );
}
