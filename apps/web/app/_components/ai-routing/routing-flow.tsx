'use client';

import { Background, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@pactlab/ui';
import { useEffect, useMemo, type ChangeEvent } from 'react';
import { buildRoutingGraph, FLOW_COLORS, ROLE_TITLES, type Flow, type GraphNode, type ModelChoice, type RoutingLane, type RoutingView } from './routing-graph';

type SaveAction = (key: string, formData: FormData) => void | Promise<void>;
type Picker = { choices: readonly ModelChoice[]; editable: boolean; save: SaveAction; defaultLabel: string; current: string };
type FlowData = { node: GraphNode; picker: Picker | null };

const submitOnChange = (event: ChangeEvent<HTMLSelectElement>) => event.currentTarget.form?.requestSubmit();

/** The model picker inside a box: changing it saves at once (the server re-checks the choice). */
function ModelPicker({ id, picker, clearable }: { id: string; picker: Picker; clearable: boolean }) {
  if (!picker.editable) return null;
  return (
    // nodrag/nopan: using the control never drags the box or pans the diagram.
    <form action={picker.save.bind(null, id)} className="nodrag nopan mt-1.5">
      <label className="flex flex-col gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-text">
        Model
        <select name="modelId" defaultValue={picker.current} onChange={submitOnChange} className="rounded-md border bg-background px-1.5 py-1 text-xs font-normal normal-case tracking-normal text-foreground">
          {clearable ? <option value="">{picker.defaultLabel}</option> : null}
          {picker.choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

function Lanes({ lanes }: { lanes: readonly RoutingLane[] }) {
  return (
    <ol className="flex flex-col gap-0.5 text-[11px]" aria-label="Models, best first">
      {lanes.map((lane, index) => (
        <li key={`${lane.provider}-${lane.modelId}`} className={lane.available ? '' : 'text-muted-foreground line-through decoration-1'} title={lane.reason ?? undefined}>
          {index === 0 ? '▶ ' : '↳ '}
          {lane.label}
          {lane.available ? null : <span> · {lane.reason}</span>}
        </li>
      ))}
    </ol>
  );
}

function FlowNode({ data }: NodeProps<Node<FlowData>>) {
  const { node, picker } = data;
  const color = FLOW_COLORS[node.flow].color;
  return (
    <div className={`w-[240px] rounded-xl border-2 bg-background p-2.5 text-left shadow-sm ${node.kind === 'input' && node.muted ? 'border-dashed opacity-75' : ''}`} style={{ borderColor: color }}>
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
        <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {node.title}
      </p>
      {node.kind === 'job' ? (
        <>
          <p className="mb-1 text-[11px] text-muted-foreground">{node.help}</p>
          <Lanes lanes={node.lanes} />
          <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-text">{node.source}</p>
          {picker ? <ModelPicker id={node.id} picker={picker} clearable /> : null}
        </>
      ) : node.note ? (
        <p className="text-[11px] text-muted-foreground">{node.note}</p>
      ) : null}
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
}

const nodeTypes = { step: FlowNode };

/** The catalog id of a lane's model, when it is one of the choices (what the picker shows as chosen). */
const choiceFor = (choices: readonly ModelChoice[], lane: RoutingLane | null | undefined) => (lane ? (choices.find((c) => c.provider === lane.provider && c.providerModelId === lane.modelId)?.id ?? '') : '');

/**
 * The routing diagram: material flows left to right through the AI jobs, colored by kind. Boxes can be
 * dragged to follow the lines; each job box (and each Claude role below) has its model picker.
 */
export function RoutingFlow({ view, choices, editable, save, rolesClearable }: { view: RoutingView; choices: readonly ModelChoice[]; editable: boolean; save: SaveAction; rolesClearable: boolean }) {
  const graph = useMemo(() => buildRoutingGraph(view), [view]);
  const defaultLabel = view.scope === 'ORGANIZATION' ? 'Pactlab default' : 'Registry chain (default)';
  const initial = useMemo<Node<FlowData>[]>(
    () =>
      graph.nodes.map((node) => {
        const job = node.kind === 'job' ? view.jobs.find((entry) => entry.jobType === node.id) : undefined;
        // Only a console choice shows as selected; a registry chain or env choice shows the default.
        const current = job && (job.source === 'ORGANIZATION' || (job.source === 'PLATFORM' && view.scope === 'PLATFORM')) ? choiceFor(choices, job.lanes[0]) : '';
        return { id: node.id, type: 'step', position: node.position, data: { node, picker: node.kind === 'job' ? { choices, editable, save, defaultLabel, current } : null } };
      }),
    [graph, view, choices, editable, save, defaultLabel],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initial);
  // After a save the page data refreshes: take the new models, keep where the boxes were dragged.
  useEffect(() => {
    setNodes((previous) => initial.map((node) => ({ ...node, position: previous.find((p) => p.id === node.id)?.position ?? node.position })));
  }, [initial, setNodes]);
  const edges: Edge[] = graph.edges.map((edge) => {
    const color = FLOW_COLORS[edge.flow].color;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: !edge.planned,
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: 2, ...(edge.planned ? { strokeDasharray: '6 4', opacity: 0.6 } : {}) },
      labelStyle: { fontSize: 11, fill: color, fontWeight: 600 },
    };
  });
  const usedFlows = Object.keys(FLOW_COLORS) as Flow[];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs" aria-label="Legend">
        {usedFlows.map((flow) => (
          <span key={flow} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-5 rounded-full" style={{ background: FLOW_COLORS[flow].color }} />
            {FLOW_COLORS[flow].label}
          </span>
        ))}
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setNodes(initial)}>
          Reset layout
        </Button>
      </div>

      <div className="h-[680px] w-full overflow-hidden rounded-xl border" aria-label="AI routing diagram">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes} fitView nodesConnectable={false} proOptions={{ hideAttribution: true }}>
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="flex flex-col gap-2" aria-label="Claude behind every chain">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-text">Claude behind every chain</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {view.roles.map((entry) => (
            <div key={entry.alias} className="rounded-xl border p-2.5 text-sm">
              <p className="font-semibold">{ROLE_TITLES[entry.alias]}</p>
              <p className="text-xs text-muted-foreground">{entry.lane?.label ?? 'not on the allow-list'}</p>
              <ModelPicker
                id={entry.alias}
                picker={{ choices, editable, save, defaultLabel: view.scope === 'ORGANIZATION' ? 'Pactlab default' : 'Configured default', current: entry.source === 'ORGANIZATION' || (view.scope === 'PLATFORM' && entry.source === 'PLATFORM') ? choiceFor(choices, entry.lane) : '' }}
                clearable={rolesClearable}
              />
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Drag boxes to follow the lines. Struck-through models cannot serve now; hover for why.{editable ? ' Changing a model saves it at once; it applies within a minute.' : ' Only your organization’s owners and administrators can change models.'}
      </p>
    </div>
  );
}
