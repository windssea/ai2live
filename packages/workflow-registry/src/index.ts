export interface WorkflowDoc {
  id: string;
  title: string;
  path: string;
  milestones: string[];
}

export const WORKFLOWS: WorkflowDoc[] = [
  { id: "hair-separation", title: "Hair separation", path: "workflows/hair-separation.md", milestones: ["M1", "M2"] },
  { id: "face-reveal", title: "Face reveal", path: "workflows/face-reveal.md", milestones: ["M2"] },
  { id: "mouth-construction", title: "Mouth construction", path: "workflows/mouth-construction.md", milestones: ["M3"] },
];

export function listWorkflows(): WorkflowDoc[] {
  return WORKFLOWS;
}

export function getWorkflow(id: string): WorkflowDoc | undefined {
  return WORKFLOWS.find((w) => w.id === id);
}
