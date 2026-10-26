'use client';

import { useState } from 'react';
import { OwnershipNetworkChart } from '../../../_lib/charts';
import { ownershipGraph, type EngineeringView, type PointView } from './view';

/**
 * Who works where (T-055). Small teams: everyone. Large teams: areas and the
 * people who own them, everyone else counted on the area; clicking an area
 * shows or hides its people.
 */
export function PeopleNetwork({ points, areas, dealId }: { points: readonly PointView[]; areas: EngineeringView['areas']; dealId: string }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const graph = ownershipGraph(points, areas, dealId, expanded);
  const toggle = (area: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  return (
    <div className="flex flex-col gap-2">
      {graph.mode === 'AREAS' ? (
        <p className="text-xs text-muted-foreground">
          {points.length} people: showing the code areas and the people who own them; “+n” counts everyone else in an area. Click an area to show its people
          {expanded.size > 0 ? ` (showing ${[...expanded].join(', ')})` : ''}.
        </p>
      ) : null}
      <OwnershipNetworkChart label="Contributors linked to the code areas they work in" graph={graph} onAreaClick={graph.mode === 'AREAS' ? toggle : undefined} />
    </div>
  );
}
