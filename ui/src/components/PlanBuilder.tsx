import { useState } from "react";
import { Plus, Trash2, Bot, Hand, ChevronDown, ChevronRight, ListTree } from "lucide-react";
import { toast } from "sonner";
import { useFactory } from "@/lib/data";
import { createJob, createChildren, type PlanNode } from "@/lib/mutations";
import type { JobAssignee } from "@/lib/types";

// A node of the plan being authored. `assignee` is "agent" (Claude runs it) or
// "human" (you tick it off). Children nest arbitrarily deep.
interface Node {
  id: string;
  title: string;
  prompt: string;
  assignee: Exclude<JobAssignee, "">;
  children: Node[];
}

const uid = () => crypto.randomUUID();
const newNode = (assignee: Node["assignee"] = "agent"): Node => ({ id: uid(), title: "", prompt: "", assignee, children: [] });

// Immutably map over the tree, applying `fn` to the node with `id`.
function mapNode(nodes: Node[], id: string, fn: (n: Node) => Node): Node[] {
  return nodes.map((n) => (n.id === id ? fn(n) : { ...n, children: mapNode(n.children, id, fn) }));
}
function removeNode(nodes: Node[], id: string): Node[] {
  return nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

// Flatten the tree to a pre-ordered list (each parent before its children) so the
// engine can wire parentLocalId as it inserts.
function flatten(nodes: Node[], parentLocalId?: string): PlanNode[] {
  const out: PlanNode[] = [];
  for (const n of nodes) {
    if (!n.title.trim()) continue;
    out.push({ localId: n.id, parentLocalId, title: n.title.trim(), prompt: n.prompt.trim() || undefined, assignee: n.assignee });
    out.push(...flatten(n.children, n.id));
  }
  return out;
}
function countTitled(nodes: Node[]): number {
  return nodes.reduce((sum, n) => sum + (n.title.trim() ? 1 : 0) + countTitled(n.children), 0);
}

interface Props {
  projectId: string;
  onCreated?: (epicId: string) => void;
}

export function PlanBuilder({ projectId, onCreated }: Props) {
  const [planName, setPlanName] = useState("");
  const [nodes, setNodes] = useState<Node[]>([newNode()]);
  const [saving, setSaving] = useState(false);
  const { addJob } = useFactory();

  const taskCount = countTitled(nodes);

  function addTopLevel() {
    setNodes((ns) => [...ns, newNode()]);
  }
  function addChild(parentId: string) {
    setNodes((ns) => mapNode(ns, parentId, (n) => ({ ...n, children: [...n.children, newNode()] })));
  }
  function patch(id: string, fields: Partial<Node>) {
    setNodes((ns) => mapNode(ns, id, (n) => ({ ...n, ...fields })));
  }
  function remove(id: string) {
    setNodes((ns) => removeNode(ns, id));
  }

  async function create() {
    const name = planName.trim();
    if (!name) return toast.error("Name your plan first");
    const planNodes = flatten(nodes);
    if (!planNodes.length) return toast.error("Add at least one task");
    setSaving(true);
    try {
      const epic = await createJob({ projectId, title: name, prompt: name, kind: "epic", manual: true });
      addJob(epic);
      await createChildren(epic.id, planNodes);
      toast.success(`Plan created — ${planNodes.length} task${planNodes.length === 1 ? "" : "s"}`);
      onCreated?.(epic.id);
      setPlanName("");
      setNodes([newNode()]);
    } catch (err) {
      toast.error("Failed to create plan");
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-paper border-4 border-ink brutal-shadow grid-bg">
      <div className="flex justify-between items-center px-5 py-4 border-b-4 border-ink bg-paper">
        <b className="font-display uppercase text-[15px] flex items-center gap-2"><ListTree className="w-4 h-4" /> Plan it yourself</b>
        <span className="font-data text-[10px] uppercase text-muted">{taskCount} task{taskCount === 1 ? "" : "s"}</span>
      </div>

      <div className="px-5 py-3 border-b-4 border-ink bg-paper">
        <input
          value={planName}
          onChange={(e) => setPlanName(e.target.value)}
          placeholder="Plan name — e.g. “Ship the billing page”"
          className="w-full border-[3px] border-ink bg-concrete px-3 py-2 font-mono text-[14px] text-ink placeholder:text-muted focus:outline-none focus:shadow-[inset_0_0_0_3px_var(--ink)]"
        />
      </div>

      <div className="p-3 bg-paper max-h-[50vh] overflow-y-auto">
        {nodes.map((n) => (
          <NodeRow key={n.id} node={n} depth={0} onPatch={patch} onAddChild={addChild} onRemove={remove} />
        ))}
        <button onClick={addTopLevel} className="mt-1 font-data text-[11px] uppercase flex items-center gap-1.5 text-muted hover:text-ink transition-colors px-1.5 py-1">
          <Plus className="w-3.5 h-3.5" /> Add task
        </button>
      </div>

      <div className="flex justify-between items-center px-5 py-4 border-t-4 border-ink bg-paper">
        <p className="font-data text-[10px] uppercase text-muted">
          <Bot className="w-3 h-3 inline mb-0.5" /> agent runs it · <Hand className="w-3 h-3 inline mb-0.5" /> you tick it off
        </p>
        <button onClick={create} disabled={saving || !taskCount} className="font-display uppercase text-[14px] bg-ink text-paper px-7 py-3 inline-flex items-center gap-2 brutal-press disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-none">
          {saving ? "Creating…" : "Create plan"}
        </button>
      </div>
    </div>
  );
}

function NodeRow({ node, depth, onPatch, onAddChild, onRemove }: {
  node: Node; depth: number;
  onPatch: (id: string, f: Partial<Node>) => void;
  onAddChild: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isAgent = node.assignee === "agent";

  return (
    <div>
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 22 }}>
        <button
          onClick={() => onPatch(node.id, { assignee: isAgent ? "human" : "agent" })}
          title={isAgent ? "Agent runs this — click to do it yourself" : "You do this — click to assign the agent"}
          className={`flex-shrink-0 w-6 h-6 border-2 border-ink flex items-center justify-center transition-colors ${isAgent ? "bg-ink text-paper" : "bg-paper text-ink"}`}
        >
          {isAgent ? <Bot className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}
        </button>
        <input
          value={node.title}
          onChange={(e) => onPatch(node.id, { title: e.target.value })}
          placeholder={depth === 0 ? "Task name…" : "Subtask name…"}
          className="flex-1 min-w-0 border-2 border-ink bg-concrete px-2 py-1.5 font-mono text-[13px] text-ink placeholder:text-muted focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)]"
        />
        <button onClick={() => setOpen((o) => !o)} title="Details" className="flex-shrink-0 text-muted hover:text-ink transition-colors">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <button onClick={() => onAddChild(node.id)} title="Add subtask" className="flex-shrink-0 text-muted hover:text-ink transition-colors"><Plus className="w-4 h-4" /></button>
        <button onClick={() => onRemove(node.id)} title="Delete" className="flex-shrink-0 text-muted hover:text-[#d6210f] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>

      {open && (
        <div className="py-1" style={{ paddingLeft: depth * 22 + 32 }}>
          <textarea
            value={node.prompt}
            onChange={(e) => onPatch(node.id, { prompt: e.target.value })}
            placeholder={isAgent ? "Instructions for the agent (optional — defaults to the task name)…" : "Notes (optional)…"}
            className="w-full min-h-[60px] resize-y border-2 border-ink bg-concrete px-2 py-1.5 font-mono text-[12px] text-ink placeholder:text-muted focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)]"
          />
        </div>
      )}

      {node.children.map((c) => (
        <NodeRow key={c.id} node={c} depth={depth + 1} onPatch={onPatch} onAddChild={onAddChild} onRemove={onRemove} />
      ))}
    </div>
  );
}
