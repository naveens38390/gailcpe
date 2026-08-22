import { SetMetadata } from "@nestjs/common";
import type { Role } from "../../database/schemas/activity.schema";

export const ROLES_KEY = "roles";

/**
 * Restrict a route to certain roles. Proposing a price correction and approving
 * one are separate capabilities on purpose — a correction is a commercial
 * decision, and the person asking for it should not be the person granting it.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
