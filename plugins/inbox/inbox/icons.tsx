// The inbox draws its own lucide icons; bb's built-in icon set does not
// include all of these names.
import {
  ArrowUpRight,
  CheckCheck,
  CircleAlert,
  CircleStop,
  Columns3,
  Keyboard,
  List,
  RotateCcw,
  Search,
  Sparkle,
  TriangleAlert,
  Wrench,
  Inbox,
  type LucideIcon,
} from "lucide-react";

const ICONS = {
  ArrowUpRight,
  CheckCheck,
  CircleAlert,
  CircleStop,
  Columns3,
  Keyboard,
  List,
  RotateCcw,
  Search,
  Sparkle,
  TriangleAlert,
  Wrench,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph className={className} aria-hidden />;
}

export const InboxNavIcon = ({ className }: { className?: string }) => <Inbox className={className} aria-hidden />;
