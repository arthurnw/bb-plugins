// The thread's estimated cost in the composer footer, just left of the context
// donut, inserted into bb's own markup.
import { definePluginApp, experimental_useRpcKeyedQuery, useComposer } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatTokens, formatUsd } from "./format.ts";
import { rpcContract, type ThreadCost } from "./rpc.ts";

/**
 * bb's internal markup, not a plugin API: the right-hand group of the primary
 * composer's footer and its context donut. If a bb update renames them, the
 * cost moves to the end of the group or stops showing.
 */
const FOOTER_GROUP = "[data-app-composer-role=primary] [data-follow-up-composer-footer] > div:last-child";
const DONUT = ':scope > button[aria-label^="Context window"], :scope > button[aria-label^="Estimated context"]';

function useThreadCost(threadId: string | null): ThreadCost | null | undefined {
  return experimental_useRpcKeyedQuery({
    contract: rpcContract,
    method: "threadCosts",
    keys: threadId ? [threadId] : [],
    enabled: threadId !== null,
  }).data?.[threadId ?? ""];
}

/** A host node placed right before the donut, re-placed whenever bb re-renders the footer. */
function useFooterSlot(enabled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) {
      setSlot(null);
      return;
    }
    const node = document.createElement("div");
    node.dataset.threadCostSlot = "";
    node.className = "flex items-center";
    const place = () => {
      const group = document.querySelector(FOOTER_GROUP);
      if (group === null) {
        node.remove();
        setSlot(null);
        return;
      }
      const donut = group.querySelector(DONUT);
      if (donut) {
        if (node.nextElementSibling !== donut) group.insertBefore(node, donut);
      } else if (node.parentElement !== group) {
        group.append(node);
      }
      setSlot(node);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      node.remove();
      setSlot(null);
    };
  }, [enabled]);
  return slot;
}

function Breakdown({ cost }: { cost: ThreadCost }) {
  const own = cost.own!;
  return (
    <div className="text-xs text-muted-foreground">
      <div className="mb-1 font-medium text-foreground">Estimated cost at list prices</div>
      <table className="tabular-nums">
        <thead>
          <tr className="text-left">
            {["Model", "Requests", "Input", "Cache read", "Cache write", "Output", "Cost"].map((h) => (
              <th key={h} className="pr-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {own.models.map((m) => (
            <tr key={m.model}>
              <td className="pr-3">{m.model}</td>
              <td className="pr-3">{m.requests}</td>
              <td className="pr-3">{formatTokens(m.input)}</td>
              <td className="pr-3">{formatTokens(m.cacheRead)}</td>
              <td className="pr-3">{formatTokens(m.cacheWrite)}</td>
              <td className="pr-3">{formatTokens(m.output)}</td>
              <td>{m.usd === null ? "no price" : formatUsd(m.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cost.childCount > 0 ? (
        <div className="mt-1">
          {cost.childCount} child threads add {formatUsd(cost.totalUsd - own.usd)}, {formatUsd(cost.totalUsd)} in total.
        </div>
      ) : null}
      {own.unpricedModels.length > 0 ? <div className="mt-1">No price for {own.unpricedModels.join(", ")}.</div> : null}
      <div className="mt-1 opacity-70">From the session transcript, priced with Pi's model table. Updates when the thread goes idle.</div>
    </div>
  );
}

function FooterCost() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const cost = useThreadCost(threadId);
  const visible = !!cost?.own && cost.own.files > 0;
  const slot = useFooterSlot(visible);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);

  useEffect(() => setAnchor(null), [threadId]);
  useEffect(() => {
    if (!anchor) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setAnchor(null);
        return;
      }
      const target = event.target as Node;
      if (!slot?.contains(target) && !panel?.contains(target)) setAnchor(null);
    };
    const dismiss = () => setAnchor(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor, slot, panel]);

  if (!slot || !visible || !cost?.own) return null;
  const label = `${formatUsd(cost.own.usd)}${cost.own.unpricedModels.length > 0 ? "+" : ""}`;
  return (
    <>
      {createPortal(
        <button
          type="button"
          aria-label={`Estimated cost ${label}`}
          aria-expanded={anchor !== null}
          onClick={(event) => setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect())}
          className="inline-flex h-6 cursor-pointer select-none items-center rounded-md px-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-state-active max-md:pointer-coarse:h-11 max-md:pointer-coarse:px-2.5"
        >
          {label}
        </button>,
        slot,
      )}
      {/* The footer clips overflow, so the panel renders on the body. */}
      {anchor
        ? createPortal(
            <div
              ref={setPanel}
              role="dialog"
              aria-label="Estimated cost"
              style={{ position: "fixed", bottom: window.innerHeight - anchor.top + 8, right: window.innerWidth - anchor.right }}
              className="z-50 w-max max-w-[90vw] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
            >
              <Breakdown cost={cost} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "footer-cost", component: FooterCost });
});
