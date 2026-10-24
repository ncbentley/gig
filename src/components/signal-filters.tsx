"use client";

import { ArrowDownRight, ArrowUpRight, Lock, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dateRangeError } from "@/lib/signal-range";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

const FIELD = "h-9 rounded-lg border-glow/35 bg-[#0a1630]/80 hover:border-glow/70 dark:bg-[#0a1630]/80 dark:hover:bg-[#0f2046]";
const FIELD_ACTIVE = "border-primary/60 text-primary shadow-[0_0_14px_-6px_rgb(245_197_66/0.7)] hover:border-primary/80";

function FilterSelect({
  name,
  label,
  options,
  disabled,
  onChange,
  value,
}: {
  name: string;
  label: string;
  options: Option[];
  disabled?: boolean;
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  const items = [{ value: "all", label: `All ${label.toLowerCase()}` }, ...options];
  return (
    <Select items={items} value={value || "all"} onValueChange={(v) => onChange(name, String(v ?? "all"))} disabled={disabled}>
      <SelectTrigger className={cn(FIELD, "min-w-36", value && value !== "all" && FIELD_ACTIVE)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const DIRECTIONS = [
  { value: "", label: "Long & short", icon: null },
  { value: "LONG", label: "Long", icon: ArrowUpRight },
  { value: "SHORT", label: "Short", icon: ArrowDownRight },
] as const;

function DirectionChips({ value, onChange }: { value: string; onChange: (name: string, value: string) => void }) {
  return (
    <div role="group" aria-label="Directions" className="flex flex-wrap gap-1.5">
      {DIRECTIONS.map((d) => {
        const active = (value || "") === d.value;
        return (
          <button
            key={d.value || "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange("direction", d.value)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "gold-fill border-primary/60 font-semibold shadow-[0_0_16px_-4px_rgb(245_197_66/0.65),inset_0_1px_0_rgb(255_255_255/0.45)]"
                : "border-glow/35 bg-[#0a1630]/80 text-foreground/90 hover:border-glow/70 hover:bg-[#0f2046]",
            )}
          >
            {d.icon && <d.icon className={cn("size-4", !active && (d.value === "LONG" ? "text-win" : "text-loss"))} />}
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

export function SignalFilters({
  sources,
  signalTypes,
  advanced,
  search,
  basic = true,
}: {
  sources: Option[];
  signalTypes: string[];
  advanced: boolean;
  search: boolean;
  /** Direction, date, source, and status. Hidden for a free account. */
  basic?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [fromDraft, setFromDraft] = useState(params.get("from") ?? "");
  const [toDraft, setToDraft] = useState(params.get("to") ?? "");

  useEffect(() => {
    setFromDraft(params.get("from") ?? "");
    setToDraft(params.get("to") ?? "");
  }, [params]);

  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(name);
    else next.set(name, value);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const hasAny = [...params.keys()].some((k) => k !== "page");

  const lockedHint = (el: React.ReactNode, key: string) =>
    advanced ? (
      el
    ) : (
      <Tooltip key={key}>
        <TooltipTrigger render={<div className="relative">{el}<Lock className="pointer-events-none absolute right-8 top-2.5 size-3.5 text-primary/80" /></div>} />
        <TooltipContent>Advanced filters are included with Gold</TooltipContent>
      </Tooltip>
    );

  const draftError = dateRangeError(fromDraft, toDraft);
  const appliedError = dateRangeError(params.get("from"), params.get("to"));
  const applyDates = () => {
    const next = new URLSearchParams(params.toString());
    if (fromDraft) next.set("from", fromDraft);
    else next.delete("from");
    if (toDraft) next.set("to", toDraft);
    else next.delete("to");
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const chips: { key: string; label: string }[] = [];
  const direction = params.get("direction");
  if (direction) chips.push({ key: "direction", label: direction === "LONG" ? "Long" : direction === "SHORT" ? "Short" : direction });
  const source = params.get("source");
  if (source) chips.push({ key: "source", label: sources.find((item) => item.value === source)?.label ?? "Source" });
  const status = params.get("status");
  if (status) chips.push({ key: "status", label: status });
  if (params.get("from")) chips.push({ key: "from", label: `From ${params.get("from")}` });
  if (params.get("to")) chips.push({ key: "to", label: `To ${params.get("to")}` });
  if (params.get("q")) chips.push({ key: "q", label: `Text “${params.get("q")}”` });
  if (params.get("entryType")) chips.push({ key: "entryType", label: params.get("entryType") ?? "" });
  if (params.get("signalType")) chips.push({ key: "signalType", label: params.get("signalType") ?? "" });

  return (
    <div
      aria-busy={pending}
      className={cn(
        "panel flex flex-wrap items-center gap-2 rounded-xl p-2.5 shadow-[0_0_22px_-12px_rgb(47_123_255/0.7)] ring-1 ring-glow/25",
        pending && "opacity-80",
      )}
    >
      {basic && <DirectionChips value={params.get("direction") ?? ""} onChange={set} />}
      {basic && <span aria-hidden className="mx-1 hidden h-6 w-px bg-glow/25 sm:block" />}
      {basic && sources.length > 0 && (
        <FilterSelect name="source" label="Sources" options={sources} value={params.get("source") ?? ""} onChange={set} />
      )}
      {basic && (
        <FilterSelect
          name="status"
          label="Statuses"
          value={params.get("status") ?? ""}
          onChange={set}
          options={[
            { value: "OPEN", label: "Open (pending / active)" },
            { value: "CLOSED", label: "Closed" },
            { value: "PENDING", label: "Pending" },
            { value: "ACTIVE", label: "Active" },
            { value: "PARTIAL", label: "Partial" },
            { value: "WON", label: "Won" },
            { value: "LOST", label: "Lost" },
            { value: "BREAKEVEN", label: "Breakeven" },
            { value: "EXPIRED", label: "Expired" },
            { value: "CANCELLED", label: "Cancelled" },
            { value: "MANUAL_REVIEW", label: "Ambiguous" },
          ]}
        />
      )}
      {basic && (
        <>
          <input
            type="date"
            aria-label="From date"
            value={fromDraft}
            onChange={(event) => setFromDraft(event.target.value)}
            className={cn(FIELD, "w-40 px-2 [color-scheme:dark]", fromDraft && FIELD_ACTIVE)}
          />
          <input
            type="date"
            aria-label="To date"
            value={toDraft}
            onChange={(event) => setToDraft(event.target.value)}
            className={cn(FIELD, "w-40 px-2 [color-scheme:dark]", toDraft && FIELD_ACTIVE)}
          />
          <Button type="button" size="sm" variant="outline" onClick={applyDates}>
            Apply dates
          </Button>
        </>
      )}
      {lockedHint(
        <FilterSelect
          name="entryType"
          label="Entry types"
          disabled={!advanced}
          value={params.get("entryType") ?? ""}
          onChange={set}
          options={[
            { value: "MARKET", label: "Market" },
            { value: "LIMIT", label: "Limit" },
            { value: "ZONE", label: "Zone" },
          ]}
        />,
        "entryType",
      )}
      {lockedHint(
        <FilterSelect
          name="signalType"
          label="Signal types"
          disabled={!advanced}
          value={params.get("signalType") ?? ""}
          onChange={set}
          options={signalTypes.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
        />,
        "signalType",
      )}
      {search && (
        <form
          role="search"
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            set("q", String(new FormData(e.currentTarget).get("q") ?? ""));
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input name="q" placeholder="Search source text…" className={cn(FIELD, "w-52 pl-8", params.get("q") && FIELD_ACTIVE)} defaultValue={params.get("q") ?? ""} />
        </form>
      )}
      {hasAny && (
        <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => start(() => router.replace(pathname, { scroll: false }))}>
          <X /> Clear
        </Button>
      )}
      {(draftError || appliedError) && (
        <p role="alert" className="basis-full text-sm text-loss">
          {draftError ?? appliedError}
        </p>
      )}
      {pending && (
        <p role="status" className="basis-full text-sm text-primary">
          Updating the list. The signals below are the previous results, not a new unfiltered result.
        </p>
      )}
      {chips.length > 0 && (
        <ul className="basis-full flex flex-wrap gap-1.5" aria-label="Applied filters">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={() => set(chip.key, "")}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                {chip.label}
                <X className="size-3" />
                <span className="sr-only">Remove {chip.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
