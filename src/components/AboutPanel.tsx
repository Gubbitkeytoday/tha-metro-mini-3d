import { useState } from "react";
import { hasSupportLinks, PROJECT_LINKS, PROMPTPAY_QR_SRC, SUPPORT } from "../config/support";
import { formatMobile } from "../lib/promptpay";
import { useStrings } from "../i18n/useStrings";
import { clearPreferences } from "../lib/preferences";
import { useAppStore } from "../stores/useAppStore";
import { GLASS, GLASS_DIVIDER } from "./glass";

/**
 * About / privacy / support, behind a single "?" button.
 *
 * One panel rather than three, because these are the things a visitor looks
 * for *after* they understand the map, and each on its own would be another
 * button competing with the map for the corner.
 *
 * The privacy section is the reason this app has no cookie banner: it states
 * plainly what is and is not stored, which is the honest version of the same
 * obligation. See `src/lib/preferences.ts`.
 */

const LINK =
  "text-slate-700 underline decoration-slate-400 underline-offset-2 hover:text-slate-900";

/**
 * An account number with a copy button.
 *
 * Typing a payment id by hand off a screen is where a digit gets dropped, and
 * `navigator.clipboard` can reject (insecure context, denied permission) — so a
 * failure leaves the number selectable rather than pretending it copied.
 */
function CopyableId({
  label,
  value,
  display,
  copyLabel,
  copiedLabel,
}: {
  label: string;
  value: string;
  /** How to show it; the copied text is always the bare digits. */
  display?: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="text-slate-600">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <br />
      <span className="select-all font-mono text-sm tabular-nums text-slate-900">
        {display ?? formatMobile(value)}
      </span>{" "}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value.replace(/\D/g, ""))
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1_600);
            })
            .catch(() => {
              /* left selectable above — nothing to claim */
            });
        }}
        className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-300 pointer-coarse:min-h-9 pointer-coarse:px-2"
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </p>
  );
}

/**
 * Group a Thai bank account number the way a passbook prints it.
 *
 * A ten-digit number read off a screen in one run is where a digit gets
 * dropped; anything that is not ten digits is left alone rather than forced
 * into a shape it does not have.
 */
function formatBankAccount(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 9)}-${digits.slice(9)}`;
}

export function AboutPanel() {
  const t = useStrings();
  const open = useAppStore((s) => s.aboutOpen);
  const setOpen = useAppStore((s) => s.setAboutOpen);
  const setTourOpen = useAppStore((s) => s.setTourOpen);
  const validation = useAppStore((s) => s.validation);

  if (!open) return null;

  const support = [
    SUPPORT.githubSponsors && { label: "GitHub Sponsors", url: SUPPORT.githubSponsors },
    SUPPORT.kofi && { label: "Ko-fi", url: SUPPORT.kofi },
    SUPPORT.buyMeACoffee && { label: "Buy Me a Coffee", url: SUPPORT.buyMeACoffee },
    SUPPORT.custom,
  ].filter(Boolean) as { label: string; url: string }[];

  return (
    <div
      role="dialog"
      aria-label={t.about}
      className={[
        "pointer-events-auto z-40 flex max-h-[80dvh] flex-col overflow-hidden",
        "fixed inset-x-2 bottom-2 rounded-2xl pb-safe-b",
        "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[26rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
        GLASS,
      ].join(" ")}
    >
      <div className={`flex items-start gap-2 border-b px-4 py-3 ${GLASS_DIVIDER}`}>
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{t.about}</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t.close}
          className="-mr-1.5 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:text-lg"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-slate-700">
        <p>{t.aboutBody}</p>

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {t.aboutData}
          </h3>
          <p>{t.aboutDataBody}</p>
          {validation && (
            <p className="mt-1 tabular-nums text-slate-500">
              feed {validation.feedVersion} · {validation.routes} routes ·{" "}
              {validation.stations} stations · {validation.runs} runs
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {t.aboutPrivacy}
          </h3>
          <p>{t.aboutPrivacyBody}</p>
          <button
            type="button"
            onClick={clearPreferences}
            className="mt-2 rounded-md bg-slate-200/70 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300 pointer-coarse:min-h-11"
          >
            {t.clearSettings}
          </button>
        </section>

        {hasSupportLinks() && (
          <section>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {t.support}
            </h3>
            <p>{t.supportBody}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {support.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 pointer-coarse:min-h-11"
                >
                  {s.label}
                </a>
              ))}
            </div>
            {SUPPORT.promptPayId && (
              <div className="mt-3 flex items-start gap-3">
                {/* White plate behind the code: a QR on the glass panel's
                    translucent background is unreliable to scan, and quiet-zone
                    contrast is not a styling preference for a payment code. */}
                {PROMPTPAY_QR_SRC && (
                  <img
                    src={PROMPTPAY_QR_SRC}
                    alt={t.promptPayQrAlt}
                    width={112}
                    height={112}
                    className="h-28 w-28 shrink-0 rounded-lg bg-white p-1.5 ring-1 ring-slate-300/70"
                  />
                )}
                <div className="min-w-0 space-y-1.5">
                  <CopyableId
                    label="PromptPay"
                    value={SUPPORT.promptPayId}
                    copyLabel={t.copy}
                    copiedLabel={t.copied}
                  />
                  {SUPPORT.trueMoneyId && (
                    <CopyableId
                      label="TrueMoney Wallet"
                      value={SUPPORT.trueMoneyId}
                      copyLabel={t.copy}
                      copiedLabel={t.copied}
                    />
                  )}
                  {SUPPORT.bankAccount && (
                    <CopyableId
                      label={`${t.bankTransfer} · ${SUPPORT.bankAccount.bank}`}
                      value={SUPPORT.bankAccount.number}
                      display={formatBankAccount(SUPPORT.bankAccount.number)}
                      copyLabel={t.copy}
                      copiedLabel={t.copied}
                    />
                  )}
                  {/* The whole reason the digits are printed next to the code:
                      a payer can check one against the other before paying. */}
                  <p className="text-[11px] leading-snug text-slate-500">{t.promptPayVerify}</p>
                </div>
              </div>
            )}
          </section>
        )}

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {t.aboutProject}
          </h3>
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            <a className={LINK} href={PROJECT_LINKS.repository} target="_blank" rel="noopener noreferrer">
              {t.sourceCode}
            </a>
            <a className={LINK} href={PROJECT_LINKS.issues} target="_blank" rel="noopener noreferrer">
              {t.reportProblem}
            </a>
          </p>
        </section>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTourOpen(true);
          }}
          className="w-full rounded-md bg-slate-200/70 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-300 pointer-coarse:min-h-11"
        >
          {t.replayTour}
        </button>
      </div>
    </div>
  );
}

/** The "?" that opens the panel. Lives next to MapLibre's own controls. */
export function AboutButton() {
  const t = useStrings();
  const setOpen = useAppStore((s) => s.setAboutOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t.about}
      title={t.about}
      data-tour="about"
      className={`pointer-events-auto absolute right-2 top-28 z-20 flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold text-slate-700 hover:text-slate-900 sm:right-4 sm:top-32 pointer-coarse:h-11 pointer-coarse:w-11 ${GLASS}`}
    >
      ?
    </button>
  );
}
