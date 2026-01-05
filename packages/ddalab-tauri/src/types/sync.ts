/**
 * Sync types for institutional broker integration
 */

// Data classification for HIPAA compliance
export type DataClassification =
  | "phi"
  | "de_identified"
  | "synthetic"
  | "unclassified";

// Shareable content types
export type ShareableContentType =
  | "dda_result"
  | "annotation"
  | "workflow"
  | "parameter_set"
  | "data_segment";

export const SHAREABLE_CONTENT_LABELS: Record<ShareableContentType, string> = {
  dda_result: "DDA Result",
  annotation: "Annotation",
  workflow: "Workflow",
  parameter_set: "Parameter Set",
  data_segment: "Data Segment",
};

// Granular permissions
export type Permission = "view" | "download" | "reshare";

// Enhanced access policy type
export type AccessPolicyType = "public" | "team" | "users" | "institution";

// Full access policy with permissions and expiration
export interface AccessPolicy {
  type: AccessPolicyType;
  team_id?: string;
  user_ids?: string[];
  institution_id: string;
  federated_institution_ids?: string[];
  permissions: Permission[];
  expires_at: string; // ISO 8601
  max_downloads?: number;
}

// Updated share metadata
export interface ShareMetadata {
  owner_user_id: string;
  content_type: ShareableContentType;
  content_id: string;
  title: string;
  description?: string;
  created_at: string;
  access_policy: AccessPolicy;
  classification: DataClassification;
  download_count: number;
  last_accessed_at?: string;
}

// Shared annotation content
export interface SharedAnnotation {
  source_file: string;
  channel: string | null;
  position: number;
  label: string;
  description: string | null;
  color: string;
  created_at: string;
}

// Shared workflow content
export interface SharedWorkflow {
  name: string;
  description: string | null;
  version: string;
  nodes: WorkflowNodeData[];
  edges: WorkflowEdgeData[];
  created_at: string;
  modified_at: string;
}

export interface WorkflowNodeData {
  id: string;
  action_type: string;
  action_data: unknown;
  timestamp: string;
  description: string | null;
  tags: string[];
}

export interface WorkflowEdgeData {
  source: string;
  target: string;
  dependency_type: string;
}

// Shared parameter set content
export interface SharedParameterSet {
  name: string;
  description: string | null;
  variants: string[];
  window_length: number;
  window_step: number;
  delay_config: DelayConfig;
  ct_parameters: CTParameters | null;
  additional_parameters: Record<string, unknown> | null;
  created_at: string;
}

export type DelayConfig =
  | { mode: "range"; min: number; max: number; num: number }
  | { mode: "list"; delays: number[] };

export interface CTParameters {
  ct_delay_min: number;
  ct_delay_max: number;
  ct_delay_step: number;
  ct_window_min: number;
  ct_window_max: number;
  ct_window_step: number;
}

// Shared data segment content
export interface SharedDataSegment {
  source_file: string;
  source_file_hash: string;
  start_time: number;
  end_time: number;
  sample_rate: number;
  channels: string[];
  sample_count: number;
  data_reference: DataReference;
  created_at: string;
}

export type DataReference =
  | { type: "inline"; base64_data: string }
  | { type: "blob_reference"; blob_id: string; size_bytes: number };

// Union type for any shareable content
export type ShareableContent =
  | { content_type: "dda_result"; result_id: string }
  | { content_type: "annotation"; data: SharedAnnotation }
  | { content_type: "workflow"; data: SharedWorkflow }
  | { content_type: "parameter_set"; data: SharedParameterSet }
  | { content_type: "data_segment"; data: SharedDataSegment };

export interface SharedResultInfo {
  metadata: ShareMetadata;
  download_url: string;
  owner_online: boolean;
}

export interface SyncConnectionConfig {
  broker_url: string;
  user_id: string;
  local_endpoint: string;
  password?: string; // For authenticated brokers
}

export interface DiscoveredBroker {
  name: string;
  url: string;
  institution: string;
  version: string;
  auth_required: boolean;
  auth_hash: string;
  uses_tls: boolean;
}

// Institution configuration
export interface InstitutionConfig {
  id: string;
  name: string;
  hipaa_mode: boolean;
  default_share_expiry_days: number;
  allow_federation: boolean;
  federated_institutions?: string[];
}

// Audit log entry
export interface AuditLogEntry {
  id?: number;
  timestamp: string;
  institution_id: string;
  user_id: string;
  action: "view" | "download" | "share" | "revoke" | "access_denied";
  share_id?: string;
  content_type?: string;
  content_id?: string;
  source_ip?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
}

// Default expiry days by classification
export const DEFAULT_EXPIRY_DAYS: Record<DataClassification, number> = {
  phi: 7,
  de_identified: 30,
  synthetic: 90,
  unclassified: 30,
};

// Team types
export interface Team {
  id: string;
  institution_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type TeamRole = "admin" | "member";

export interface TeamMember {
  team_id: string;
  user_id: string;
  role: TeamRole;
  added_at: string;
  added_by: string | null;
}

export interface TeamSummary {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  share_count: number;
}

export interface TeamWithMembers {
  team: Team;
  members: TeamMember[];
}

// Federation types
export type TrustLevel = "full" | "read_only" | "revoked";

export const TRUST_LEVEL_LABELS: Record<TrustLevel, string> = {
  full: "Full Access",
  read_only: "Read Only",
  revoked: "Revoked",
};

export interface FederationInvite {
  id: string;
  from_institution_id: string;
  to_institution_id: string | null;
  to_institution_name: string | null;
  invite_token: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface FederationTrust {
  id: string;
  institution_a: string;
  institution_b: string;
  trust_level: TrustLevel;
  established_at: string;
  established_by: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

export interface FederatedInstitutionSummary {
  institution_id: string;
  institution_name: string;
  trust_level: TrustLevel;
  established_at: string;
  share_count: number;
}

export interface CreateInviteRequest {
  institution_id: string;
  to_institution_name?: string;
  expiry_days?: number;
}

export interface InviteResponse {
  invite: FederationInvite;
  share_url: string;
}

export interface AcceptInviteRequest {
  invite_token: string;
  institution_id: string;
}

// Helper to check if an invite is valid
export function isInviteValid(invite: FederationInvite): boolean {
  return (
    invite.accepted_at === null &&
    invite.revoked_at === null &&
    new Date(invite.expires_at) > new Date()
  );
}

// Helper to check if a trust is active
export function isTrustActive(trust: FederationTrust): boolean {
  return trust.revoked_at === null && trust.trust_level !== "revoked";
}

// Helper to check if a policy has expired
export function isPolicyExpired(policy: AccessPolicy): boolean {
  return new Date(policy.expires_at) < new Date();
}

// Helper to check if a permission is granted
export function hasPermission(
  policy: AccessPolicy,
  permission: Permission,
): boolean {
  return policy.permissions.includes(permission);
}
