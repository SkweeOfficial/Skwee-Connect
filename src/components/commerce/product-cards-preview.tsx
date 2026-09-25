"use client";

import { ShoppingBag, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductMessagePayload } from "@/lib/commerce/types";

/**
 * WhatsApp-style read-only render of a catalog product card (single
 * product) or product list we sent. The name / price / image are the
 * snapshot saved at send time, so the thread still reads correctly after
 * the catalog changes. Namespace-free plain English, like
 * `InteractivePreview`, whose frame it mirrors.
 */
export function ProductCardsPreview({
  payload,
  className,
}: {
  payload: ProductMessagePayload;
  className?: string;
}) {
  const items = payload.sections.flatMap((s) => s.items);
  const first = items[0];
  const isList = payload.kind === "product_list";

  return (
    <div
      className={cn(
        "w-full max-w-[260px] overflow-hidden rounded-lg bg-card text-foreground shadow-sm ring-1 ring-border",
        className,
      )}
    >
      {first ? (
        <div className="flex gap-2 border-b border-border p-2">
          {first.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={first.image_url}
              alt=""
              className="h-14 w-14 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-muted">
              <ShoppingBag className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 text-sm">
            <p className="truncate font-semibold">
              {isList ? payload.header || first.name : first.name}
            </p>
            {isList ? (
              <p className="text-xs text-muted-foreground">
                {items.length} item{items.length === 1 ? "" : "s"}
              </p>
            ) : first.price_text ? (
              <p className="text-xs text-muted-foreground">{first.price_text}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {payload.body ? (
        <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm">
          {payload.body}
        </p>
      ) : null}

      {isList ? (
        <ul className="border-t border-border px-3 py-1.5 text-xs">
          {payload.sections.map((s, i) => (
            <li key={`${s.title}-${i}`} className="flex justify-between gap-2 py-0.5">
              <span className="truncate">{s.title}</span>
              <span className="shrink-0 text-muted-foreground">
                {s.items[0]?.price_text ?? ""}
                {s.items.length > 1 ? ` · ${s.items.length} sizes` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        disabled
        className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary"
      >
        <ShoppingCart className="h-3.5 w-3.5" />
        <span>{isList ? "View items" : "View"}</span>
      </button>
    </div>
  );
}
