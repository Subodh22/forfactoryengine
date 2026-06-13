"use client";
import { JobDetail } from "@/components/JobDetail";

// The center pane of a selected workspace: the agent thread (output + chat) and
// composer. The diff/terminal live in the RightDock, so the Changes tab is
// hidden here. Phase 2 adds multiple chat tabs + a live preview tab on top.

interface Props {
  jobId: string;
  onRedo?: (newJobId: string) => void;
}

export function WorkspaceView({ jobId, onRedo }: Props) {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-concrete">
      <JobDetail jobId={jobId} onRedo={onRedo} hideChanges />
    </div>
  );
}
