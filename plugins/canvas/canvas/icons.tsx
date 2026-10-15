// The canvas draws its own lucide icons; bb's built-in icon set does not
// include all of these names.
import {
  CornerDownLeft,
  FolderInput,
  Keyboard,
  Monitor,
  Pencil,
  Rows3,
  Trash2,
  Archive,
  ArrowUpRight,
  Columns2,
  Folder,
  FolderGit2,
  GitBranch,
  GitFork,
  GitPullRequest,
  LayoutGrid,
  Maximize,
  Palette,
  Plus,
  Redo2,
  Search,
  StickyNote,
  Undo2,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

const ICONS = {
  CornerDownLeft,
  FolderInput,
  Keyboard,
  Monitor,
  Pencil,
  Rows3,
  Trash2,
  Archive,
  ArrowUpRight,
  Columns2,
  Folder,
  FolderGit2,
  GitBranch,
  GitFork,
  GitPullRequest,
  LayoutGrid,
  Maximize,
  Palette,
  Plus,
  Redo2,
  Search,
  StickyNote,
  Undo2,
  Workflow,
  X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph className={className} aria-hidden />;
}

export const CanvasNavIcon = ({ className }: { className?: string }) => (
  <Workflow className={className} aria-hidden />
);
