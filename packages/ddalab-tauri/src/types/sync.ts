/**
 * Sync types for institutional broker integration
 */

export type AccessPolicyType = 'public' | 'team' | 'users';

export interface AccessPolicy {
  type: AccessPolicyType;
  team_id?: string;
  user_ids?: string[];
}

export interface ShareMetadata {
  owner_user_id: string;
  result_id: string;
  title: string;
  description?: string;
  created_at: string;
  access_policy: AccessPolicy;
}

export interface SharedResultInfo {
  metadata: ShareMetadata;
  download_url: string;
  owner_online: boolean;
}

export interface SyncConnectionConfig {
  broker_url: string;
  user_id: string;
  local_endpoint: string;
}
