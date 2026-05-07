"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ScaleEntry = { min: number; max: number; units: number };
type Settings = { name: string; scale: ScaleEntry[]; historyEnabled: boolean };
type HistoryEntry = {
  id: string;
  timestamp: string;
  bg: number;
  units: number;
  range: string;
};
type AppBackup = {
  version: 1;
  exportedAt: string;
  settings: Settings;
  history: HistoryEntry[];
};
type ViewportSize = { height: number | null; offsetTop: number };
type OnboardingStep = "name" | "scale" | "review";

const STORAGE_KEY = "insulin-dose-settings-v1";
const HISTORY_KEY = "insulin-dose-history-v1";
const IS_DEV = process.env.NODE_ENV === "development";

const COMMON_SCALE: ScaleEntry[] = [
  { min: 70, max: 150, units: 0 },
  { min: 151, max: 200, units: 2 },
  { min: 201, max: 250, units: 4 },
  { min: 251, max: 300, units: 6 },
  { min: 301, max: 350, units: 8 },
  { min: 351, max: 400, units: 10 },
];

const PERSONAL_SCALE: ScaleEntry[] = [
  { min: 60, max: 124, units: 0 },
  { min: 125, max: 150, units: 2 },
  { min: 151, max: 200, units: 4 },
  { min: 201, max: 250, units: 6 },
  { min: 251, max: 300, units: 8 },
  { min: 301, max: 350, units: 10 },
  { min: 351, max: 400, units: 12 },
  { min: 401, max: 450, units: 14 },
];

const EMPTY_SETTINGS: Settings = { name: "", scale: [], historyEnabled: true };

function labelFor(entry: ScaleEntry) {
  return `${entry.min}–${entry.max}`;
}

function sortScale(scale: ScaleEntry[]) {
  return [...scale].sort((a, b) => a.min - b.min);
}

function lookup(
  value: number,
  scale: ScaleEntry[],
): { entry: ScaleEntry } | { error: string } {
  const sorted = sortScale(scale);
  if (sorted.length === 0) return { error: "Set up your scale first" };

  const lowest = sorted[0].min;
  const highest = sorted.at(-1)?.max ?? 0;
  if (value < lowest) return { error: "Treat low blood sugar first" };
  if (value > highest) return { error: "Above scale — consult doctor" };

  const entry = sorted.find((s) => value >= s.min && value <= s.max);
  return entry ? { entry } : { error: "No matching range" };
}

function isValidScaleEntry(value: unknown): value is ScaleEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ScaleEntry>;
  return (
    Number.isFinite(entry.min) &&
    Number.isFinite(entry.max) &&
    Number.isFinite(entry.units)
  );
}

function parseSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Settings>;
  if (!Array.isArray(candidate.scale) || candidate.scale.length === 0) return null;
  if (!candidate.scale.every(isValidScaleEntry)) return null;
  return {
    name: typeof candidate.name === "string" ? candidate.name : "",
    scale: candidate.scale,
    historyEnabled: candidate.historyEnabled !== false,
  };
}

function isValidHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.timestamp === "string" &&
    Number.isFinite(entry.bg) &&
    Number.isFinite(entry.units) &&
    typeof entry.range === "string"
  );
}

function parseHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidHistoryEntry);
}

function parseBackup(value: unknown): { settings: Settings; history: HistoryEntry[] } | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<AppBackup> & Partial<Settings>;

  if (candidate.settings) {
    const settings = parseSettings(candidate.settings);
    if (!settings) return null;

    return {
      settings,
      history: parseHistory(candidate.history),
    };
  }

  // Backward compatibility: older exports were settings-only JSON.
  const settings = parseSettings(candidate);
  if (!settings) return null;

  return {
    settings,
    history: [],
  };
}

function formatHistoryDate(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatHistoryTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function dateInputValue(timestamp: string) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function timeInputValue(timestamp: string) {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function mergeDateAndTime(timestamp: string, nextDate: string, nextTime: string) {
  const current = new Date(timestamp);
  const [year, month, day] = nextDate.split("-").map(Number);
  const [hour, minute] = nextTime.split(":").map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return timestamp;
  }

  current.setFullYear(year, month - 1, day);
  current.setHours(hour, minute, 0, 0);
  return current.toISOString();
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Home() {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const lastAutoSavedRef = useRef<{ key: string; time: number } | null>(null);
  const [value, setValue] = useState("");
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("name");
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState("");
  const [viewport, setViewport] = useState<ViewportSize>({
    height: null,
    offsetTop: 0,
  });

  useEffect(() => {
    const updateViewport = () => {
      const visualViewport = window.visualViewport;
      setViewport({
        height: visualViewport?.height ?? window.innerHeight,
        offsetTop: visualViewport?.offsetTop ?? 0,
      });
    };

    updateViewport();
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    const savedHistory = window.localStorage.getItem(HISTORY_KEY);
    if (savedHistory) {
      try {
        setHistory(parseHistory(JSON.parse(savedHistory)));
      } catch {
        setHistory([]);
      }
    }

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      startOnboarding();
      setHydrated(true);
      return;
    }

    try {
      const parsed = parseSettings(JSON.parse(saved));
      if (parsed) {
        setSettings(parsed);
        setHasCompletedOnboarding(true);
      } else {
        startOnboarding();
      }
    } catch {
      startOnboarding();
    }

    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !hasCompletedOnboarding) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [hasCompletedOnboarding, hydrated, settings]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history, hydrated]);

  const scale = useMemo(() => sortScale(settings.scale), [settings.scale]);
  const bg = useMemo(() => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }, [value]);
  const result = useMemo(
    () => (bg !== null ? lookup(bg, scale) : null),
    [bg, scale],
  );
  const canSaveSettings = settings.scale.length > 0;

  useEffect(() => {
    if (!hydrated || !hasCompletedOnboarding || !settings.historyEnabled) return;
    if (bg === null || !result || !("entry" in result)) return;

    const key = `${bg}:${result.entry.units}:${labelFor(result.entry)}`;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      const last = lastAutoSavedRef.current;
      if (last?.key === key && now - last.time < 5 * 60_000) return;

      lastAutoSavedRef.current = { key, time: now };
      setHistory((current) => [
        {
          id: createId(),
          timestamp: new Date().toISOString(),
          bg,
          units: result.entry.units,
          range: labelFor(result.entry),
        },
        ...current,
      ]);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [bg, hasCompletedOnboarding, hydrated, result, settings.historyEnabled]);

  function startOnboarding() {
    setSettings(EMPTY_SETTINGS);
    setSettingsOpen(true);
    setIsOnboarding(true);
    setOnboardingStep("name");
    setHasCompletedOnboarding(false);
  }

  function updateScale(index: number, field: keyof ScaleEntry, rawValue: string) {
    const parsed = Number.parseInt(rawValue, 10);
    setSettings((current) => ({
      ...current,
      scale: current.scale.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, [field]: Number.isFinite(parsed) ? parsed : 0 }
          : entry,
      ),
    }));
  }

  function addScaleRow() {
    setSettings((current) => {
      const sorted = sortScale(current.scale);
      const last = sorted.at(-1) ?? { min: 70, max: 150, units: 0 };
      return {
        ...current,
        scale: [
          ...current.scale,
          { min: last.max + 1, max: last.max + 50, units: last.units + 2 },
        ],
      };
    });
  }

  function removeScaleRow(index: number) {
    setSettings((current) => ({
      ...current,
      scale:
        current.scale.length > 1
          ? current.scale.filter((_, entryIndex) => entryIndex !== index)
          : current.scale,
    }));
  }

  function finishSetup() {
    if (!canSaveSettings) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setHasCompletedOnboarding(true);
    setIsOnboarding(false);
    setSettingsOpen(false);
  }

  function downloadSettings() {
    const backup: AppBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      history,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sliding-scale-backup.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function uploadSettings(file: File | undefined) {
    if (!file) return;

    try {
      const imported = parseBackup(JSON.parse(await file.text()));
      if (!imported) {
        window.alert("That file does not look like a valid Sliding Scale backup.");
        return;
      }

      setSettings(imported.settings);
      setHistory(imported.history);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(imported.settings));
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(imported.history));
      setHasCompletedOnboarding(true);
      setIsOnboarding(false);
      setSettingsOpen(false);
      setToast("Backup restored");
    } catch {
      window.alert("Could not import backup JSON.");
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  function clearLocalSettingsForTesting() {
    window.localStorage.removeItem(STORAGE_KEY);
    setValue("");
    startOnboarding();
  }

  function restorePersonalScaleForDev() {
    const restored = { ...settings, scale: PERSONAL_SCALE };
    setSettings(restored);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
    setHasCompletedOnboarding(true);
    setIsOnboarding(false);
    setSettingsOpen(false);
  }

  function updateHistoryEntry(id: string, updates: Partial<HistoryEntry>) {
    setHistory((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)),
    );
    setToast("Saved");
  }

  function removeHistoryEntry(id: string) {
    setHistory((current) => current.filter((entry) => entry.id !== id));
  }

  function clearHistory() {
    setHistory([]);
    window.localStorage.removeItem(HISTORY_KEY);
  }

  function setHistoryEnabled(historyEnabled: boolean) {
    setSettings((current) => ({ ...current, historyEnabled }));
  }

  return (
    <main
      className="fixed inset-x-0 top-0 overflow-hidden bg-[#070b12] px-4 py-[max(1rem,env(safe-area-inset-top))] text-white"
      style={{
        height: viewport.height ? `${viewport.height}px` : "100dvh",
        transform: `translateY(${viewport.offsetTop}px)`,
      }}
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(150,255,67,0.13),transparent_34%),radial-gradient(circle_at_90%_30%,rgba(151,71,255,0.16),transparent_28%)]" />

      <div className="relative mx-auto flex h-full min-h-0 w-full max-w-md flex-col gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-5">
        <header className="flex shrink-0 items-center justify-between pt-2">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d9ff63]">
              {settings.name ? `Hi, ${settings.name}` : "Diabetes"}
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-white">
              Insulin Dose
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="grid h-12 w-12 place-items-center rounded-2xl bg-[#171d29] text-xl shadow-[0_16px_40px_rgba(0,0,0,0.35)] ring-1 ring-white/10 active:scale-95"
            aria-label="Open settings"
          >
            ⚙︎
          </button>
        </header>

        <section className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden rounded-[34px] bg-[#111722]/90 p-4 text-center shadow-[0_28px_70px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-xl sm:p-6">
          {!result ? (
            <>
              <p className="text-[clamp(4rem,18dvh,7rem)] font-black tracking-tight text-[#d9ff63] drop-shadow-[0_0_34px_rgba(217,255,99,0.18)]">
                BG?
              </p>
              <p className="mt-3 text-xl font-black text-white">
                Enter your blood glucose below
              </p>
              <p className="mt-2 text-base font-bold text-slate-400">
                Dose appears here
              </p>
              {history[0] && (
                <p className="mx-auto mt-5 rounded-full bg-[#202839] px-4 py-2 text-sm font-bold text-slate-300 ring-1 ring-white/10">
                  Last: {history[0].bg} mg/dL → {history[0].units} units
                </p>
              )}
            </>
          ) : "error" in result ? (
            <>
              <p className="mx-auto max-w-xs text-[clamp(1.7rem,7dvh,2.25rem)] font-black leading-tight text-[#ffb86b]">
                {result.error}
              </p>
              <p className="mt-3 text-base font-bold text-slate-400">
                BG {bg} mg/dL
              </p>
            </>
          ) : (
            <>
              <p className="text-[clamp(5rem,30dvh,9rem)] font-black leading-none tracking-[-0.08em] text-[#d9ff63] drop-shadow-[0_0_34px_rgba(217,255,99,0.24)]">
                {result.entry.units}
              </p>
              <p className="mt-3 text-2xl font-black text-white">
                {result.entry.units === 0 ? "No coverage" : "units"}
              </p>
              <p className="mx-auto mt-3 rounded-full bg-[#202839] px-4 py-2 text-base font-bold text-slate-300 ring-1 ring-white/10">
                BG {bg} mg/dL · {labelFor(result.entry)}
              </p>
            </>
          )}
        </section>

        <label className="flex shrink-0 items-end gap-3 rounded-[28px] bg-[#171d29] px-5 py-4 shadow-[0_18px_45px_rgba(0,0,0,0.35)] ring-1 ring-white/10 focus-within:ring-2 focus-within:ring-[#d9ff63]/50 sm:py-5">
          <input
            type="number"
            inputMode="decimal"
            placeholder="Blood glucose"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-3xl font-black tracking-tight text-white outline-none placeholder:text-slate-600 sm:text-4xl"
          />
          <span className="pb-1 text-sm font-black text-slate-500">mg/dL</span>
        </label>
      </div>

      {settingsOpen && (
        <div className="absolute inset-0 z-30 flex items-end bg-black/55 backdrop-blur-sm">
          <section className="mx-auto flex max-h-[90%] w-full max-w-md flex-col rounded-t-[34px] bg-[#111722] p-4 shadow-[0_-24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/10">
            <SheetHeader
              isOnboarding={isOnboarding}
              step={onboardingStep}
              onClose={() => setSettingsOpen(false)}
            />

            {isOnboarding ? (
              <OnboardingFlow
                step={onboardingStep}
                settings={settings}
                canSave={canSaveSettings}
                uploadInputRef={uploadInputRef}
                onNameChange={(name) => setSettings((current) => ({ ...current, name }))}
                onNext={() => setOnboardingStep("scale")}
                onBack={() =>
                  setOnboardingStep(onboardingStep === "review" ? "scale" : "name")
                }
                onUseCommon={() => {
                  setSettings((current) => ({ ...current, scale: COMMON_SCALE }));
                  setOnboardingStep("review");
                }}
                onUseCustom={() => {
                  setSettings((current) => ({
                    ...current,
                    scale: current.scale.length
                      ? current.scale
                      : [{ min: 70, max: 150, units: 0 }],
                  }));
                  setOnboardingStep("review");
                }}
                onUpload={(file) => void uploadSettings(file)}
                onUpdateScale={updateScale}
                onAddScaleRow={addScaleRow}
                onRemoveScaleRow={removeScaleRow}
                onFinish={finishSetup}
              />
            ) : (
              <SettingsPanel
                settings={settings}
                history={history}
                uploadInputRef={uploadInputRef}
                onNameChange={(name) => setSettings((current) => ({ ...current, name }))}
                onUseCommon={() =>
                  setSettings((current) => ({ ...current, scale: COMMON_SCALE }))
                }
                onUpdateScale={updateScale}
                onAddScaleRow={addScaleRow}
                onRemoveScaleRow={removeScaleRow}
                onHistoryEnabledChange={setHistoryEnabled}
                onUpdateHistoryEntry={updateHistoryEntry}
                onRemoveHistoryEntry={removeHistoryEntry}
                onClearHistory={clearHistory}
                onDownload={downloadSettings}
                onUpload={(file) => void uploadSettings(file)}
                onClearDev={clearLocalSettingsForTesting}
                onRestoreDev={restorePersonalScaleForDev}
                onDone={finishSetup}
              />
            )}
          </section>
        </div>
      )}

      {toast && (
        <div className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
          <div className="rounded-full bg-[#d9ff63] px-5 py-3 text-sm font-black text-[#070b12] shadow-[0_12px_40px_rgba(217,255,99,0.22)]">
            {toast}
          </div>
        </div>
      )}
    </main>
  );
}

function SheetHeader({
  isOnboarding,
  step,
  onClose,
}: {
  isOnboarding: boolean;
  step: OnboardingStep;
  onClose: () => void;
}) {
  const stepNumber = step === "name" ? 1 : step === "scale" ? 2 : 3;

  return (
    <div className="flex shrink-0 items-center justify-between pb-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d9ff63]">
          {isOnboarding ? `Step ${stepNumber} of 3` : "Customize"}
        </p>
        <h2 className="text-2xl font-black">
          {isOnboarding ? "Quick setup" : "Settings"}
        </h2>
      </div>
      {!isOnboarding && (
        <button
          type="button"
          onClick={onClose}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-[#202839] text-xl font-black text-white ring-1 ring-white/10 active:scale-95"
          aria-label="Close settings"
        >
          ×
        </button>
      )}
    </div>
  );
}

function OnboardingFlow({
  step,
  settings,
  canSave,
  uploadInputRef,
  onNameChange,
  onNext,
  onBack,
  onUseCommon,
  onUseCustom,
  onUpload,
  onUpdateScale,
  onAddScaleRow,
  onRemoveScaleRow,
  onFinish,
}: {
  step: OnboardingStep;
  settings: Settings;
  canSave: boolean;
  uploadInputRef: React.RefObject<HTMLInputElement | null>;
  onNameChange: (name: string) => void;
  onNext: () => void;
  onBack: () => void;
  onUseCommon: () => void;
  onUseCustom: () => void;
  onUpload: (file: File | undefined) => void;
  onUpdateScale: (index: number, field: keyof ScaleEntry, value: string) => void;
  onAddScaleRow: () => void;
  onRemoveScaleRow: (index: number) => void;
  onFinish: () => void;
}) {
  if (step === "name") {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-between gap-6 overflow-y-auto pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <div className="space-y-5">
          <div className="rounded-3xl bg-[#202839] p-5 ring-1 ring-white/10">
            <p className="text-3xl font-black leading-tight">Let’s set up your calculator.</p>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-400">
              Your settings stay on this device. No account needed.
            </p>
          </div>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              Name optional
            </span>
            <input
              type="text"
              placeholder="Your name"
              value={settings.name}
              onChange={(event) => onNameChange(event.target.value)}
              className="mt-2 w-full rounded-2xl bg-[#202839] px-4 py-4 text-xl font-black text-white outline-none ring-1 ring-white/10 placeholder:text-slate-600 focus:ring-[#d9ff63]/50"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={onNext}
          className="w-full rounded-2xl bg-[#d9ff63] py-4 text-base font-black text-[#070b12] active:scale-[0.99]"
        >
          Continue
        </button>
      </div>
    );
  }

  if (step === "scale") {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-between gap-5 overflow-y-auto pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <div className="space-y-3">
          <p className="rounded-3xl bg-[#202839] p-5 text-sm font-semibold leading-6 text-slate-300 ring-1 ring-white/10">
            Choose the easiest starting point. You can edit everything before saving.
          </p>
          <ChoiceButton
            title="Use common example"
            subtitle="Starts with a typical 70–400 correction scale. Edit it next."
            accent="lime"
            onClick={onUseCommon}
          />
          <ChoiceButton
            title="Enter my prescribed scale"
            subtitle="Start with one blank row and add ranges from your doctor’s instructions."
            accent="purple"
            onClick={onUseCustom}
          />
          <ChoiceButton
            title="Upload saved settings"
            subtitle="Restore from a JSON backup file."
            accent="dark"
            onClick={() => uploadInputRef.current?.click()}
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => onUpload(event.target.files?.[0])}
          />
        </div>
        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-2xl bg-[#202839] py-4 text-base font-black text-white ring-1 ring-white/10 active:scale-[0.99]"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <p className="mb-3 rounded-2xl bg-[#202839] p-4 text-sm font-semibold leading-6 text-slate-300 ring-1 ring-white/10">
          Review your scale carefully. This should match your prescribed insulin instructions.
        </p>
        <ScaleEditor
          scale={settings.scale}
          onUpdateScale={onUpdateScale}
          onAddScaleRow={onAddScaleRow}
          onRemoveScaleRow={onRemoveScaleRow}
        />
      </div>
      <div className="grid shrink-0 grid-cols-[0.8fr_1.2fr] gap-2 border-t border-white/10 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onBack}
          className="rounded-2xl bg-[#202839] py-4 text-base font-black text-white ring-1 ring-white/10 active:scale-[0.99]"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onFinish}
          disabled={!canSave}
          className={
            canSave
              ? "rounded-2xl bg-[#d9ff63] py-4 text-base font-black text-[#070b12] active:scale-[0.99]"
              : "rounded-2xl bg-slate-700 py-4 text-base font-black text-slate-400"
          }
        >
          Save & start
        </button>
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  history,
  uploadInputRef,
  onNameChange,
  onUseCommon,
  onUpdateScale,
  onAddScaleRow,
  onRemoveScaleRow,
  onHistoryEnabledChange,
  onUpdateHistoryEntry,
  onRemoveHistoryEntry,
  onClearHistory,
  onDownload,
  onUpload,
  onClearDev,
  onRestoreDev,
  onDone,
}: {
  settings: Settings;
  history: HistoryEntry[];
  uploadInputRef: React.RefObject<HTMLInputElement | null>;
  onNameChange: (name: string) => void;
  onUseCommon: () => void;
  onUpdateScale: (index: number, field: keyof ScaleEntry, value: string) => void;
  onAddScaleRow: () => void;
  onRemoveScaleRow: (index: number) => void;
  onHistoryEnabledChange: (enabled: boolean) => void;
  onUpdateHistoryEntry: (id: string, updates: Partial<HistoryEntry>) => void;
  onRemoveHistoryEntry: (id: string) => void;
  onClearHistory: () => void;
  onDownload: () => void;
  onUpload: (file: File | undefined) => void;
  onClearDev: () => void;
  onRestoreDev: () => void;
  onDone: () => void;
}) {
  const [view, setView] = useState<"main" | "scale">("main");

  if (view === "scale") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4 flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setView("main")}
            className="grid h-11 w-11 place-items-center rounded-2xl bg-[#202839] text-xl font-black text-white ring-1 ring-white/10 active:scale-95"
            aria-label="Back to settings"
          >
            ‹
          </button>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              Settings
            </p>
            <h3 className="text-2xl font-black text-white">Sliding scale</h3>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
          <p className="mb-3 rounded-2xl bg-[#202839] p-4 text-sm font-semibold leading-6 text-slate-300 ring-1 ring-white/10">
            Edit the ranges and units used by the calculator. Make sure this
            matches your prescribed scale.
          </p>
          <button
            type="button"
            onClick={onUseCommon}
            className="mb-3 w-full rounded-2xl bg-[#202839] px-3 py-3 text-sm font-black text-slate-300 ring-1 ring-white/10 active:scale-[0.99]"
          >
            Use common default
          </button>
          <ScaleEditor
            scale={settings.scale}
            onUpdateScale={onUpdateScale}
            onAddScaleRow={onAddScaleRow}
            onRemoveScaleRow={onRemoveScaleRow}
          />
        </div>

        <div className="shrink-0 border-t border-white/10 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setView("main")}
            className="w-full rounded-2xl bg-[#d9ff63] py-4 text-base font-black text-[#070b12] active:scale-[0.99]"
          >
            Back to settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pb-4">
        <section>
          <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Name
          </label>
          <input
            type="text"
            placeholder="Your name"
            value={settings.name}
            onChange={(event) => onNameChange(event.target.value)}
            className="mt-2 w-full rounded-2xl bg-[#202839] px-4 py-3 text-base font-black text-white outline-none ring-1 ring-white/10 placeholder:text-slate-600 focus:ring-[#d9ff63]/50"
          />
        </section>

        <HistoryPanel
          history={history}
          enabled={settings.historyEnabled}
          onEnabledChange={onHistoryEnabledChange}
          onUpdateEntry={onUpdateHistoryEntry}
          onRemoveEntry={onRemoveHistoryEntry}
          onClearHistory={onClearHistory}
        />

        <section>
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Dose settings
          </h3>
          <button
            type="button"
            onClick={() => setView("scale")}
            className="mt-2 flex w-full items-center justify-between rounded-3xl bg-[#202839] p-5 text-left ring-1 ring-white/10 active:scale-[0.99]"
          >
            <span>
              <span className="block text-lg font-black text-white">Sliding scale</span>
              <span className="mt-1 block text-sm font-semibold text-slate-500">
                {settings.scale.length} range{settings.scale.length === 1 ? "" : "s"}
              </span>
            </span>
            <span className="text-2xl font-black text-[#d9ff63]">›</span>
          </button>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Backup / restore
          </h3>
          <p className="text-xs font-semibold leading-5 text-slate-500">
            Export includes settings, sliding scale, and saved readings.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onDownload}
              className="rounded-2xl bg-[#202839] px-3 py-3 text-sm font-black text-white ring-1 ring-white/10 active:scale-[0.99]"
            >
              Export all
            </button>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="rounded-2xl bg-[#202839] px-3 py-3 text-sm font-black text-white ring-1 ring-white/10 active:scale-[0.99]"
            >
              Restore
            </button>
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => onUpload(event.target.files?.[0])}
          />

          {IS_DEV && (
            <div className="mt-3 rounded-2xl border border-[#ffb86b]/30 bg-[#ffb86b]/10 p-3">
              <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-[#ffb86b]">
                Dev tools
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onClearDev}
                  className="rounded-xl bg-[#ffb86b] px-3 py-3 text-xs font-black text-[#070b12] active:scale-[0.99]"
                >
                  Clear storage
                </button>
                <button
                  type="button"
                  onClick={onRestoreDev}
                  className="rounded-xl bg-[#d9ff63] px-3 py-3 text-xs font-black text-[#070b12] active:scale-[0.99]"
                >
                  Restore my scale
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-white/10 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-2xl bg-[#d9ff63] py-4 text-base font-black text-[#070b12] active:scale-[0.99]"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function HistoryPanel({
  history,
  enabled,
  onEnabledChange,
  onUpdateEntry,
  onRemoveEntry,
  onClearHistory,
}: {
  history: HistoryEntry[];
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onUpdateEntry: (id: string, updates: Partial<HistoryEntry>) => void;
  onRemoveEntry: (id: string) => void;
  onClearHistory: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const chartEntries = [...history].reverse().slice(-20);
  const maxBg = Math.max(250, ...chartEntries.map((entry) => entry.bg));
  const points = chartEntries
    .map((entry, index) => {
      const x = chartEntries.length <= 1 ? 50 : (index / (chartEntries.length - 1)) * 100;
      const y = 90 - Math.min(1, entry.bg / maxBg) * 78;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            History
          </h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Auto-save readings after you type
          </p>
        </div>
        <button
          type="button"
          onClick={() => onEnabledChange(!enabled)}
          className={
            enabled
              ? "rounded-full bg-[#d9ff63] px-4 py-2 text-xs font-black text-[#070b12]"
              : "rounded-full bg-[#202839] px-4 py-2 text-xs font-black text-slate-300 ring-1 ring-white/10"
          }
        >
          {enabled ? "On" : "Off"}
        </button>
      </div>

      <div className="rounded-3xl bg-[#202839] p-4 ring-1 ring-white/10">
        {history.length === 0 ? (
          <p className="py-6 text-center text-sm font-semibold text-slate-500">
            No readings saved yet.
          </p>
        ) : (
          <>
            <svg viewBox="0 0 100 100" className="h-32 w-full overflow-visible">
              <defs>
                <linearGradient id="historyLine" x1="0" x2="1" y1="0" y2="0">
                  <stop stopColor="#D9FF63" />
                  <stop offset="1" stopColor="#9B5CFF" />
                </linearGradient>
              </defs>
              <polyline
                points={points}
                fill="none"
                stroke="url(#historyLine)"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="4"
              />
              {chartEntries.map((entry, index) => {
                const x = chartEntries.length <= 1 ? 50 : (index / (chartEntries.length - 1)) * 100;
                const y = 90 - Math.min(1, entry.bg / maxBg) * 78;
                return <circle key={entry.id} cx={x} cy={y} r="3" fill="#D9FF63" />;
              })}
            </svg>

            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500">
                {history.length} saved reading{history.length === 1 ? "" : "s"}
              </p>
              <button
                type="button"
                onClick={onClearHistory}
                className="rounded-full bg-black/20 px-3 py-1 text-xs font-black text-slate-300"
              >
                Clear all
              </button>
            </div>
          </>
        )}
      </div>

      {history.length > 0 && (
        <div className="space-y-2">
          {history.slice(0, 30).map((entry) => {
            const isEditing = editingId === entry.id;

            return (
              <div
                key={entry.id}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-2xl bg-[#202839] px-4 py-3 ring-1 ring-white/10"
              >
                <div>
                  <p className="text-sm font-black text-white">
                    {formatHistoryDate(entry.timestamp)} · {formatHistoryTime(entry.timestamp)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Range {entry.range}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-[#d9ff63]">{entry.bg}</p>
                  <p className="text-xs font-semibold text-slate-500">mg/dL</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-white">{entry.units}</p>
                  <p className="text-xs font-semibold text-slate-500">units</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingId(isEditing ? null : entry.id)}
                  className={
                    isEditing
                      ? "grid h-9 w-9 place-items-center rounded-xl bg-[#d9ff63] text-sm font-black text-[#070b12]"
                      : "grid h-9 w-9 place-items-center rounded-xl bg-black/20 text-sm font-black text-slate-300"
                  }
                  aria-label="Edit history entry time"
                >
                  ✎
                </button>

                {isEditing && (
                  <>
                    <div className="col-span-4 grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                          Date
                        </span>
                        <input
                          type="date"
                          value={dateInputValue(entry.timestamp)}
                          onChange={(event) =>
                            onUpdateEntry(entry.id, {
                              timestamp: mergeDateAndTime(
                                entry.timestamp,
                                event.target.value,
                                timeInputValue(entry.timestamp),
                              ),
                            })
                          }
                          className="mt-1 w-full rounded-xl bg-black/20 px-3 py-2 text-sm font-black text-white outline-none ring-1 ring-white/10"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                          Time
                        </span>
                        <input
                          type="time"
                          value={timeInputValue(entry.timestamp)}
                          onChange={(event) =>
                            onUpdateEntry(entry.id, {
                              timestamp: mergeDateAndTime(
                                entry.timestamp,
                                dateInputValue(entry.timestamp),
                                event.target.value,
                              ),
                            })
                          }
                          className="mt-1 w-full rounded-xl bg-black/20 px-3 py-2 text-sm font-black text-white outline-none ring-1 ring-white/10"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveEntry(entry.id)}
                      className="col-span-4 rounded-xl bg-[#ffb86b]/20 py-2 text-xs font-black text-[#ffb86b]"
                    >
                      Remove entry
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ChoiceButton({
  title,
  subtitle,
  accent,
  onClick,
}: {
  title: string;
  subtitle: string;
  accent: "lime" | "purple" | "dark";
  onClick: () => void;
}) {
  const classes =
    accent === "lime"
      ? "bg-[#d9ff63] text-[#070b12]"
      : accent === "purple"
        ? "bg-[#9b5cff] text-white"
        : "bg-[#202839] text-white ring-1 ring-white/10";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-3xl p-5 text-left active:scale-[0.99] ${classes}`}
    >
      <span className="block text-lg font-black">{title}</span>
      <span className="mt-1 block text-sm font-semibold opacity-75">{subtitle}</span>
    </button>
  );
}

function ScaleEditor({
  scale,
  onUpdateScale,
  onAddScaleRow,
  onRemoveScaleRow,
}: {
  scale: ScaleEntry[];
  onUpdateScale: (index: number, field: keyof ScaleEntry, value: string) => void;
  onAddScaleRow: () => void;
  onRemoveScaleRow: (index: number) => void;
}) {
  return (
    <>
      <div className="mt-2 space-y-2">
        {scale.map((entry, index) => (
          <div
            key={`${entry.min}-${entry.max}-${index}`}
            className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 rounded-2xl bg-[#202839] p-2 text-white ring-1 ring-white/10"
          >
            <NumberSetting
              label="Min"
              value={entry.min}
              onChange={(next) => onUpdateScale(index, "min", next)}
            />
            <NumberSetting
              label="Max"
              value={entry.max}
              onChange={(next) => onUpdateScale(index, "max", next)}
            />
            <NumberSetting
              label="Units"
              value={entry.units}
              onChange={(next) => onUpdateScale(index, "units", next)}
            />
            <button
              type="button"
              onClick={() => onRemoveScaleRow(index)}
              className="self-end rounded-xl bg-black/20 px-3 py-2 text-sm font-black"
              aria-label="Remove scale row"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAddScaleRow}
        className="mt-2 w-full rounded-2xl bg-[#9b5cff] py-3 text-sm font-black text-white active:scale-[0.99]"
      >
        Add range
      </button>
    </>
  );
}

function NumberSetting({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-black uppercase opacity-55">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl bg-black/20 px-2 py-2 text-base font-black outline-none ring-1 ring-white/10"
      />
    </label>
  );
}
