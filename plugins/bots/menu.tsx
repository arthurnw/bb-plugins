// Small styled wrappers over Radix dropdown menus, which bb provides to
// plugins at runtime.
import * as Menu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";

// Highlight states need selectors, so the menu carries its own small stylesheet.
const CSS = `
.bots-menu{min-width:200px;max-height:min(var(--radix-dropdown-menu-content-available-height),480px);overflow:auto;padding:4px;border-radius:8px;
  background:var(--popover,var(--background));color:var(--popover-foreground,var(--foreground));border:1px solid var(--border);
  box-shadow:0 8px 24px rgb(0 0 0 / .18);font-size:13px;z-index:60}
.bots-menu-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;cursor:pointer;outline:none;user-select:none}
.bots-menu-item[data-highlighted],.bots-menu-item[data-state=open]{background:var(--accent);color:var(--accent-foreground,var(--foreground))}
.bots-menu-item[data-disabled]{opacity:.5;cursor:default}
.bots-menu-label{padding:6px 8px 2px;font-size:11px;font-weight:600;color:var(--muted-foreground)}
.bots-menu-separator{height:1px;margin:4px 2px;background:var(--border)}
.bots-menu-mark{margin-left:auto;display:inline-flex;width:16px;justify-content:center}
`;

export const MenuRoot = Menu.Root;

export function MenuTrigger({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu.Trigger asChild>
      <button type="button" aria-label={label} title={label} onPointerDown={(e) => e.stopPropagation()}
        style={{ border: "none", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", padding: "0 6px", borderRadius: 4, fontSize: 15, lineHeight: "18px", display: "inline-flex", alignItems: "center" }}>
        {children}
      </button>
    </Menu.Trigger>
  );
}

export function MenuContent({ children, label, align = "end" }: { children: ReactNode; label: string; align?: "start" | "end" }) {
  return (
    <Menu.Portal>
      <Menu.Content className="bots-menu" aria-label={label} align={align} sideOffset={4} collisionPadding={8}>
        <style>{CSS}</style>
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function MenuItem({ children, onSelect, disabled, icon }: { children: ReactNode; onSelect: () => void; disabled?: boolean; icon?: string }) {
  return (
    <Menu.Item className="bots-menu-item" disabled={disabled} onSelect={onSelect}>
      {icon && <Icon name={icon} className="size-4" aria-hidden />}
      {children}
    </Menu.Item>
  );
}

/** A checkable item that keeps the menu open, like bb's Organize menu. */
export function MenuCheck({ children, checked, onToggle, disabled, role = "menuitemcheckbox", mark = "Check" }: {
  children: ReactNode; checked: boolean; onToggle: () => void; disabled?: boolean; role?: "menuitemcheckbox" | "menuitemradio"; mark?: string;
}) {
  return (
    <Menu.Item className="bots-menu-item" role={role} aria-checked={checked} disabled={disabled}
      onSelect={(event) => { event.preventDefault(); onToggle(); }}>
      {children}
      <span className="bots-menu-mark">{checked && <Icon name={mark} className="size-4" aria-hidden />}</span>
    </Menu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <Menu.Label className="bots-menu-label">{children}</Menu.Label>;
}

export function MenuSeparator() {
  return <Menu.Separator className="bots-menu-separator" />;
}

export function SubMenu({ label, icon, children }: { label: string; icon?: string; children: ReactNode }) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger className="bots-menu-item">
        {icon && <Icon name={icon} className="size-4" aria-hidden />}
        {label}
        <span className="bots-menu-mark"><Icon name="ChevronRight" className="size-4" aria-hidden /></span>
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent className="bots-menu" sideOffset={4} collisionPadding={8}>
          <style>{CSS}</style>
          {children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}
