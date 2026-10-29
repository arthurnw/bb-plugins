import { BaseEdge, Position, getBezierPath, useInternalNode, type EdgeProps, type InternalNode } from "@xyflow/react";
import { facingSides, type Rect, type Side } from "./layout.ts";

const POSITION: Record<Side, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

function rectOf(node: InternalNode): Rect {
  return {
    ...node.internals.positionAbsolute,
    width: node.measured.width ?? node.width ?? 0,
    height: node.measured.height ?? node.height ?? 0,
  };
}

/** The dashed line from a card to its pinned chat, drawn between the sides that face each other. */
export function TetherEdge({ id, source, target, style }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (sourceNode === undefined || targetNode === undefined) return null;
  const { from, to } = facingSides(rectOf(sourceNode), rectOf(targetNode));
  const [path] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: POSITION[from.side],
    targetX: to.x,
    targetY: to.y,
    targetPosition: POSITION[to.side],
  });
  return <BaseEdge id={id} path={path} style={style} />;
}

export const edgeTypes = { tether: TetherEdge };
