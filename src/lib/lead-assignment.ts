/**
 * Assign or transfer a lead to an employee.
 * Only ownership + date change — disposition, intake, callback, advisor fields stay as-is.
 */
export function employeeAssignUpdate(assignedToId: string) {
  return {
    assignedToId,
    assignedDate: new Date(),
  }
}

/** Remove employee ownership — lead returns to the unassigned pool. */
export function employeeUnassignUpdate() {
  return {
    assignedToId: null,
    assignedDate: null,
  }
}

/** Totally unassigned (no employee) — used by AUTO SELECT for first-time assignment. */
export function isTotallyUnassignedLead(lead: {
  assignedToId?: string | null
}): boolean {
  return !lead.assignedToId || lead.assignedToId === ''
}
