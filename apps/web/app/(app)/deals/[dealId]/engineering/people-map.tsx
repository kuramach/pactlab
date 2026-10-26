'use client';

import { useMemo, useState } from 'react';
import { PeopleMapChart } from '../../../_lib/charts';
import { TAG_LABELS, type ContributorTag, type PeopleMapPoint } from './view';

const inputClass = 'rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * The code-vs-delivery map with a search box that picks out one person and
 * tag and area filters (T-055). For large teams the chart drops labels and
 * zooms and pans; filtering never changes what the points mean.
 */
export function PeopleMap({
  points,
  medians,
  large,
  areas,
}: {
  points: readonly PeopleMapPoint[];
  medians: { code: number; coordination: number };
  large: boolean;
  areas: readonly string[];
}) {
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<ContributorTag | ''>('');
  const [area, setArea] = useState('');
  const shown = useMemo(() => points.filter((point) => (!tag || point.tags.includes(tag)) && (!area || point.areas.includes(area))), [points, tag, area]);
  const term = search.trim().toLowerCase();
  const highlight = term ? (shown.find((point) => point.name.toLowerCase().includes(term))?.key ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person" aria-label="Find a person on the map" className={`${inputClass} w-56`} />
        <select value={tag} onChange={(event) => setTag(event.target.value as ContributorTag | '')} aria-label="Filter the map by tag" className={inputClass}>
          <option value="">Every tag</option>
          {(Object.keys(TAG_LABELS) as ContributorTag[]).map((key) => (
            <option key={key} value={key}>
              {TAG_LABELS[key].label}
            </option>
          ))}
        </select>
        <select value={area} onChange={(event) => setArea(event.target.value)} aria-label="Filter the map by area" className={inputClass}>
          <option value="">Every area</option>
          {areas.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground" aria-live="polite">
          {shown.length === points.length ? `${points.length} people` : `${shown.length} of ${points.length} people`}
          {term && !highlight ? ' · no match' : ''}
        </span>
      </div>
      <PeopleMapChart label="Contributors by code commits and delivery coordination" points={shown} medians={medians} large={large} highlight={highlight} />
      {large ? <p className="text-xs text-muted-foreground">Scroll to zoom and drag to pan. Labels are off at this team size; hover a point or search for a person.</p> : null}
    </div>
  );
}
