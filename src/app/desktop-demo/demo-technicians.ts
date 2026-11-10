/** Fictional roster for the development preview, not actual shop employees. */
export const demoTechnicians = [
  { id: "demo-tech-001", name: "Alex Morgan", role: "Technician" },
  { id: "demo-tech-002", name: "Jordan Lee", role: "Technician" },
  { id: "demo-tech-003", name: "Taylor Brooks", role: "Technician" },
] as const;
export type DemoTechnicianId = (typeof demoTechnicians)[number]["id"];
export function demoTechnicianById(id: string) {
  return demoTechnicians.find(t => t.id === id);
}
