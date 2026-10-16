// The inbox draws its own lucide icons; bb's built-in icon set does not
// include all of these names.
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleStop,
  Columns3,
  GitBranch,
  Keyboard,
  List,
  RotateCcw,
  Search,
  Sparkle,
  TriangleAlert,
  Wrench,
  X,
  Inbox,
  type LucideIcon,
} from "lucide-react";

const ICONS = {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleStop,
  Columns3,
  GitBranch,
  Keyboard,
  List,
  RotateCcw,
  Search,
  Sparkle,
  TriangleAlert,
  Wrench,
  X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph className={className} aria-hidden />;
}

export const InboxNavIcon = ({ className }: { className?: string }) => <Inbox className={className} aria-hidden />;
