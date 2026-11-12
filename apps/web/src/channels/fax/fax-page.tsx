import type { FaxDocument } from "@/types/domain"
import { cn } from "@/lib/utils"

/**
 * A rendered fax page. Paper stays paper-coloured in dark mode on purpose:
 * it's a picture of a document, not UI chrome.
 */

type Block =
  | { kind: "title"; text: string }
  | { kind: "field"; label: string; value: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "signature"; name: string }

const docs: Record<string, Block[][]> = {
  "fx-referral": [
    [
      { kind: "title", text: "Patient referral" },
      { kind: "field", label: "Patient", value: "Okafor, Ruth A." },
      { kind: "field", label: "DOB", value: "03/14/1961" },
      { kind: "field", label: "MRN", value: "00418823" },
      {
        kind: "field",
        label: "Referring",
        value: "Dr. Lena Park, Acme Family Medicine",
      },
      { kind: "field", label: "Specialty", value: "Cardiology" },
      {
        kind: "para",
        text: "Reason for referral: intermittent palpitations over six weeks, abnormal ECG on 10/28 (attached, p.3). Please evaluate for paroxysmal AF.",
      },
      { kind: "para", text: "Urgency: routine, within 2 weeks." },
    ],
    [
      { kind: "title", text: "Current medications" },
      {
        kind: "list",
        items: [
          "Lisinopril 10 mg, once daily",
          "Atorvastatin 20 mg, once daily",
          "Metformin 500 mg, twice daily",
          "Vitamin D3 2000 IU, once daily",
        ],
      },
      { kind: "para", text: "Allergies: penicillin (rash)." },
    ],
    [
      { kind: "title", text: "ECG summary, 10/28/2026" },
      {
        kind: "para",
        text: "Sinus rhythm with frequent premature atrial complexes. Rate 88. No acute ST changes.",
      },
      { kind: "signature", name: "Lena Park, MD" },
    ],
  ],
  "fx-consent": [
    [
      { kind: "title", text: "Consent to release records" },
      {
        kind: "para",
        text: "I authorize Acme Health to release my medical records described below to the recipient listed, for the purpose of continuing care.",
      },
      {
        kind: "field",
        label: "Records",
        value: "Visit notes and labs, 01/2025 to present",
      },
      {
        kind: "field",
        label: "Recipient",
        value: "Records desk, (212) 555-0199",
      },
      { kind: "field", label: "Expires", value: "11/11/2027" },
    ],
    [
      {
        kind: "para",
        text: "I understand I may revoke this authorization in writing at any time, except where action has already been taken.",
      },
      { kind: "signature", name: "Ruth A. Okafor" },
      { kind: "field", label: "Date", value: "11/11/2026" },
    ],
  ],
  "fx-laborder": [
    [
      { kind: "title", text: "Lab order A-55821" },
      { kind: "field", label: "Patient", value: "Nguyen, Daniel" },
      { kind: "field", label: "DOB", value: "07/02/1988" },
      { kind: "field", label: "Fasting", value: "Yes, 10 hours" },
      {
        kind: "list",
        items: [
          "CBC with differential",
          "Comprehensive metabolic panel",
          "Lipid panel",
          "Hemoglobin A1c",
        ],
      },
      { kind: "signature", name: "Lena Park, MD" },
    ],
  ],
}

function pageFor(fax: FaxDocument, page: number): Block[] {
  const known = docs[fax.id]?.[page - 1]
  if (known) return known
  return [
    { kind: "title", text: fax.title },
    {
      kind: "para",
      text: `Page ${page} of ${fax.pages}. The real server renders the uploaded file here.`,
    },
  ]
}

function header(fax: FaxDocument, page: number) {
  const d = new Date(fax.createdAt)
  const stamp = `${d.toLocaleString("en-US", { month: "short" }).toUpperCase()}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
  const from = (
    fax.direction === "outbound" ? fax.appNumber : fax.peerNumber
  ).replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3")
  const p = (n: number) => String(n).padStart(3, "0")
  return `${stamp}   FROM ${from}   P.${p(page)}/${p(fax.pages)}`
}

const grain =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .05 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"

export function FaxPage({
  fax,
  page,
  thumbnail = false,
  className,
}: {
  fax: FaxDocument
  page: number
  thumbnail?: boolean
  className?: string
}) {
  if (thumbnail) {
    return (
      <span
        className={cn(
          "flex aspect-[8.5/11] flex-col gap-[3px] rounded-[2px] border border-neutral-300 bg-paper p-1.5",
          className
        )}
        aria-hidden
      >
        <span className="h-px w-full bg-neutral-500" />
        <span className="mt-1 h-[3px] w-2/3 bg-neutral-800" />
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className="h-px bg-neutral-300"
            style={{ width: `${70 + ((i * 37 + page * 13) % 30)}%` }}
          />
        ))}
      </span>
    )
  }

  const blocks = pageFor(fax, page)
  return (
    <figure
      className={cn(
        "relative aspect-[8.5/11] overflow-hidden rounded-[3px] border border-neutral-300 bg-paper text-neutral-900 shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_24px_-12px_rgb(0_0_0/0.18)] dark:border-neutral-700",
        className
      )}
      style={{ backgroundImage: grain }}
      aria-label={`${fax.title}, page ${page} of ${fax.pages}`}
    >
      <div className="[container-type:inline-size] border-b border-neutral-800/70 px-[6%] py-[1.6%] font-mono text-[clamp(7px,1.45cqw,10px)] tracking-wider text-neutral-800">
        <span className="block truncate text-[9px] sm:text-[10px]">
          {header(fax, page)}
        </span>
      </div>
      <div
        className="space-y-3 px-[9%] pt-[7%] text-[11px] leading-relaxed [filter:contrast(1.15)] sm:text-[12px]"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        <div className="mb-5 flex items-center justify-between border-b-2 border-neutral-900 pb-2">
          <span className="text-[13px] font-bold tracking-tight sm:text-[15px]">
            ACME HEALTH
          </span>
          <span className="text-[9px] text-neutral-600 sm:text-[10px]">
            500 Howard St · San Francisco CA · (628) 555-0150
          </span>
        </div>
        {blocks.map((b, i) => {
          switch (b.kind) {
            case "title":
              return (
                <h3
                  key={i}
                  className="pb-1 text-[13px] font-bold tracking-wide uppercase sm:text-[14px]"
                >
                  {b.text}
                </h3>
              )
            case "field":
              return (
                <div
                  key={i}
                  className="flex gap-3 border-b border-dotted border-neutral-400 pb-1"
                >
                  <span className="w-20 shrink-0 font-bold">{b.label}:</span>
                  <span>{b.value}</span>
                </div>
              )
            case "para":
              return <p key={i}>{b.text}</p>
            case "list":
              return (
                <ul key={i} className="list-['☐__'] space-y-1 pl-5">
                  {b.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              )
            case "signature":
              return (
                <div key={i} className="pt-6">
                  <svg
                    viewBox="0 0 160 40"
                    className="h-9 w-40 text-neutral-900"
                    aria-hidden
                  >
                    <path
                      d="M4 30c10-14 16-22 20-20s-6 22 0 20 10-18 16-16-2 14 4 13 8-12 14-10 0 10 6 9 10-8 16-8 6 6 12 5 14-6 22-8 18-2 30-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="w-48 border-t border-neutral-900 pt-1 text-[10px]">
                    {b.name}
                  </div>
                </div>
              )
          }
        })}
      </div>
    </figure>
  )
}
