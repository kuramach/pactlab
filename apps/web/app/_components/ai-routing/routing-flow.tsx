'use client';

import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Badge, Button } from '@pactlab/ui';
import { useMemo, useState } from 'react';
import { buildRoutingGraph, JOB_TITLES, ROLE_TITLES, sourceText, type GraphNode, type JobType, type ModelChoice, type RoleAlias, type RoutingLane, type RoutingView } from './routing-graph';

type FlowData = { node: GraphNode };
type SaveAction = (key: string, formData: FormData) => void | Promise<void>;

function Lanes({ lanes }: { lanes: readonly RoutingLane[] }) {
  return (
    <ol className="flex flex-col gap-0.5 text-[11px]" aria-label="Models, best first">
      {lanes.map((lane, index) => (
        <li key={`${lane.provider}-${lane.modelId}`} className={lane.available ? '' : 'text-muted-foreground line-through decoration-1'} title={lane.reason ?? undefined}>
          {index === 0 ? '▶ ' : '↳ '}
          {lane.label}
          {lane.available ? null : <span className="no-underline"> · {lane.reason}</span>}
        </li>
      ))}
    </ol>
  );
}

function FlowNode({ data }: NodeProps<Node<FlowData>>) {
  const node = data.node;
  const job = node.kind === 'job';
  return (
    <div className={`w-[230px] rounded-xl border bg-background p-2.5 text-left shadow-sm ${job ? 'cursor-pointer border-indigo-ink/40 hover:border-indigo-ink' : node.muted ? 'border-dashed opacity-70' : 'bg-mist'}`}>
      <Handle type="target" position={Position.Left} className="!bg-indigo-ink" />
      <p className="text-sm font-semibold leading-tight">{node.title}</p>
      {node.kind === 'job' ? (
        <>
          <p className="mb-1 text-[11px] text-muted-foreground">{node.help}</p>
          <Lanes lanes={node.lanes} />
          <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-text">{node.source}</p>
        </>
      ) : node.note ? (
        <p className="text-[11px] text-muted-foreground">{node.note}</p>
      ) : null}
      <Handle type="source" position={Position.Right} className="!bg-indigo-ink" />
    </div>
  );
}

const nodeTypes = { step: FlowNode };

/**
 * The routing diagram: material flows left to right through the AI jobs; click a job (or a Claude
 * role below) to choose its model. Only models this scope may use are offered; the server re-checks.
 */
export function RoutingFlow({ view, choices, editable, save, rolesClearable }: { view: RoutingView; choices: readonly ModelChoice[]; editable: boolean; save: SaveAction; rolesClearable: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const graph = useMemo(() => buildRoutingGraph(view), [view]);
  const nodes: Node<FlowData>[] = graph.nodes.map((node) => ({ id: node.id, type: 'step', position: node.position, data: { node }, draggable: false, connectable: false }));
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: !edge.planned,
    style: edge.planned ? { strokeDasharray: '6 4', opacity: 0.6 } : undefined,
    labelStyle: { fontSize: 11 },
  }));
  const job = view.jobs.find((entry) => entry.jobType === selected);
  const role = view.roles.find((entry) => `role-${entry.alias}` === selected);

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[620px] w-full overflow-hidden rounded-xl border" aria-label="AI routing diagram">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => setSelected(node.data.node.kind === 'job' ? node.id : null)} proOptions={{ hideAttribution: true }}>
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="flex flex-wrap items-stretch gap-2" aria-label="Claude behind the lanes">
        <span className="self-center text-xs font-semibold uppercase tracking-wide text-slate-text">Claude behind every chain</span>
        {view.roles.map((entry) => (
          <Button key={entry.alias} type="button" variant="outline" size="sm" onClick={() => setSelected(`role-${entry.alias}`)}>
            <span className="font-semibold">{ROLE_TITLES[entry.alias]}</span> <span className="text-muted-foreground">{entry.lane?.label ?? 'not on the allow-list'}</span>
          </Button>
        ))}
      </div>

      {job || role ? (
        <aside className="rounded-xl border p-3" aria-label="Choose a model">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{job ? JOB_TITLES[job.jobType as JobType].title : ROLE_TITLES[(role?.alias ?? 'balanced') as RoleAlias]}</p>
              <p className="text-xs text-muted-foreground">
                Now: {job ? sourceText(job.source, view.scope) : role ? sourceText(role.source, view.scope) : ''}. {job ? 'The first model that can serve answers; the rest are fallbacks.' : 'The Claude model the chains fall back to.'}
              </p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          {job ? <div className="my-2"><Lanes lanes={job.lanes} /></div> : null}
          {editable ? (
            <form action={save.bind(null, job ? job.jobType : (role?.alias ?? ''))} className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm font-medium">
                Model
                <select name="modelId" defaultValue="" className="rounded-md border bg-background px-2 py-1.5 text-sm">
                  {job || rolesClearable ? <option value="">{view.scope === 'ORGANIZATION' ? 'Pactlab default' : 'Registry chain (default)'}</option> : null}
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" size="sm">
                Save
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Only your organization’s owners and administrators can change this.</p>
          )}
          {choices.length === 0 && editable ? <p className="mt-1 text-xs text-muted-foreground">No other model is approved yet; ask Pactlab to evaluate one.</p> : null}
        </aside>
      ) : (
        <p className="text-xs text-muted-foreground">
          Click a job, or a Claude role, to see its models{editable ? ' and choose one' : ''}. <Badge variant="neutral">greyed</Badge> models cannot serve now; the reason is beside them.
        </p>
      )}
    </div>
  );
}
