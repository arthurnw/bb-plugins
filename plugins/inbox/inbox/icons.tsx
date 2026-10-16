// The inbox draws its own lucide icons; bb's built-in icon set does not
// include all of these names.
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleStop,
  GitBranch,
  Inbox,
  Keyboard,
  RotateCcw,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

const ICONS = {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleStop,
  GitBranch,
  Keyboard,
  RotateCcw,
  Wrench,
  X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph className={className} aria-hidden />;
}

export const InboxNavIcon = ({ className }: { className?: string }) => <Inbox className={className} aria-hidden />;
