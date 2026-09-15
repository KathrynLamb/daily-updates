export const staffRoles = [
    "practitioner",
    "approver",
    "admin",
  ] as const;

  export type StaffRole = (typeof staffRoles)[number];

  export const staffCapabilities = [
    "observation:create",
    "observation:read",
    "draft:create",
    "content-review:create",
    "evaluation:create",
    "approval:create",
    "publication:create",
    "published-update:read",
  ] as const;

  export type StaffCapability =
    (typeof staffCapabilities)[number];

  const practitionerCapabilities: readonly StaffCapability[] = [
    "observation:create",
    "observation:read",
    "draft:create",
    "content-review:create",
    "evaluation:create",
    "published-update:read",
  ];

  const approverCapabilities: readonly StaffCapability[] = [
    ...practitionerCapabilities,
    "approval:create",
    "publication:create",
  ];

  const capabilitiesByRole: Record<
    StaffRole,
    ReadonlySet<StaffCapability>
  > = {
    practitioner: new Set(practitionerCapabilities),
    approver: new Set(approverCapabilities),
    admin: new Set(staffCapabilities),
  };

  export function isStaffRole(
    value: unknown
  ): value is StaffRole {
    return (
      typeof value === "string" &&
      staffRoles.some((role) => role === value)
    );
  }

  export function staffCan(
    role: StaffRole,
    capability: StaffCapability
  ): boolean {
    return capabilitiesByRole[role].has(capability);
  }

  export function parentCanReadChild(
    hasExplicitChildAccess: boolean
  ): boolean {
    return hasExplicitChildAccess;
  }