use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Unique identifier for users
pub type UserId = String;

/// Share token for accessing shared results
pub type ShareToken = String;

/// Data classification for HIPAA compliance
/// When institution.hipaa_mode is false, classification is ignored
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataClassification {
    /// Protected Health Information - institution-only, short expiry
    Phi,
    /// De-identified data - can be shared externally
    DeIdentified,
    /// Generated/test data - unrestricted
    Synthetic,
    /// Default when HIPAA mode disabled
    Unclassified,
}

impl Default for DataClassification {
    fn default() -> Self {
        Self::Unclassified
    }
}

/// Types of content that can be shared through the collaboration system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ShareableContentType {
    /// DDA analysis results (existing functionality)
    #[default]
    DdaResult,
    /// User annotations on time series or results
    Annotation,
    /// Recorded analysis workflows (DAG of actions)
    Workflow,
    /// Saved DDA parameter configurations
    ParameterSet,
    /// Time-windowed raw data excerpts
    DataSegment,
}

impl ShareableContentType {
    /// Returns true if this content type may contain PHI
    pub fn may_contain_phi(&self) -> bool {
        match self {
            ShareableContentType::DdaResult => true,
            ShareableContentType::Annotation => true,
            ShareableContentType::Workflow => false,
            ShareableContentType::ParameterSet => false,
            ShareableContentType::DataSegment => true,
        }
    }

    /// Returns a display label for UI
    pub fn label(&self) -> &'static str {
        match self {
            ShareableContentType::DdaResult => "DDA Result",
            ShareableContentType::Annotation => "Annotation",
            ShareableContentType::Workflow => "Workflow",
            ShareableContentType::ParameterSet => "Parameter Set",
            ShareableContentType::DataSegment => "Data Segment",
        }
    }
}

/// Granular permissions for shared content
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    /// Can see content metadata and preview
    View,
    /// Can export content locally (implies View)
    Download,
    /// Can create new shares for others (implies Download)
    Reshare,
}

/// Access policy type - who can access
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AccessPolicyType {
    /// Anyone in the institution
    Public,
    /// Specific team members
    Team { team_id: String },
    /// Named individuals
    Users { user_ids: Vec<UserId> },
    /// All institution members (explicit)
    Institution,
}

/// Full access policy with permissions and expiration
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessPolicy {
    /// Who can access
    #[serde(flatten)]
    pub policy_type: AccessPolicyType,
    /// Institution this share belongs to
    pub institution_id: String,
    /// What they can do
    pub permissions: Vec<Permission>,
    /// When access expires (ISO 8601)
    pub expires_at: DateTime<Utc>,
    /// Optional download limit
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_downloads: Option<u32>,
}

impl AccessPolicy {
    /// Check if a permission is granted
    pub fn has_permission(&self, permission: Permission) -> bool {
        self.permissions.contains(&permission)
    }

    /// Check if the policy has expired
    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }

    /// Create a default public policy expiring in 30 days
    pub fn public_default(institution_id: String) -> Self {
        Self {
            policy_type: AccessPolicyType::Public,
            institution_id,
            permissions: vec![Permission::View, Permission::Download],
            expires_at: Utc::now() + chrono::Duration::days(30),
            max_downloads: None,
        }
    }
}

/// Institution configuration for HIPAA mode and federation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstitutionConfig {
    pub id: String,
    pub name: String,
    /// When false, DataClassification checks are skipped
    pub hipaa_mode: bool,
    /// Default expiry for new shares (days)
    pub default_share_expiry_days: u32,
    /// Whether this institution can federate with others
    pub allow_federation: bool,
    /// List of trusted institution IDs (if federation enabled)
    #[serde(default)]
    pub federated_institutions: Vec<String>,
}

impl Default for InstitutionConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            hipaa_mode: true,
            default_share_expiry_days: 30,
            allow_federation: false,
            federated_institutions: Vec::new(),
        }
    }
}

impl InstitutionConfig {
    /// Get default expiry duration based on classification
    pub fn default_expiry_for(&self, classification: DataClassification) -> chrono::Duration {
        if !self.hipaa_mode {
            return chrono::Duration::days(self.default_share_expiry_days as i64);
        }
        match classification {
            DataClassification::Phi => chrono::Duration::days(7),
            DataClassification::DeIdentified => chrono::Duration::days(30),
            DataClassification::Synthetic => chrono::Duration::days(90),
            DataClassification::Unclassified => {
                chrono::Duration::days(self.default_share_expiry_days as i64)
            }
        }
    }
}

/// Actions that can be audited
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    View,
    Download,
    Share,
    Revoke,
    AccessDenied,
}

/// Audit log entry for compliance tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: Option<i64>,
    pub timestamp: DateTime<Utc>,
    pub institution_id: String,
    pub user_id: UserId,
    pub action: AuditAction,
    pub share_id: Option<String>,
    pub content_type: Option<String>,
    pub content_id: Option<String>,
    pub source_ip: Option<String>,
    pub user_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

impl AuditLogEntry {
    pub fn new(institution_id: String, user_id: UserId, action: AuditAction) -> Self {
        Self {
            id: None,
            timestamp: Utc::now(),
            institution_id,
            user_id,
            action,
            share_id: None,
            content_type: None,
            content_id: None,
            source_ip: None,
            user_agent: None,
            metadata: None,
        }
    }

    pub fn with_share(
        mut self,
        share_id: String,
        content_type: String,
        content_id: String,
    ) -> Self {
        self.share_id = Some(share_id);
        self.content_type = Some(content_type);
        self.content_id = Some(content_id);
        self
    }

    pub fn with_request_info(
        mut self,
        source_ip: Option<String>,
        user_agent: Option<String>,
    ) -> Self {
        self.source_ip = source_ip;
        self.user_agent = user_agent;
        self
    }
}

/// Metadata about a shared result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareMetadata {
    pub owner_user_id: UserId,
    /// Type of content being shared
    #[serde(default)]
    pub content_type: ShareableContentType,
    /// ID of the content (result_id, annotation_id, workflow_id, etc.)
    pub content_id: String,
    pub title: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub access_policy: AccessPolicy,
    /// Data classification for HIPAA compliance
    #[serde(default)]
    pub classification: DataClassification,
    /// Number of times this share has been downloaded
    #[serde(default)]
    pub download_count: u32,
    /// Last time this share was accessed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<DateTime<Utc>>,
}

/// Information about a shared result including owner availability
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedResultInfo {
    pub metadata: ShareMetadata,
    pub download_url: String,
    pub owner_online: bool,
}

/// User session information stored in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSession {
    pub session_id: Uuid,
    pub user_id: UserId,
    pub endpoint: String,
    pub encryption_key_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_heartbeat: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

impl UserSession {
    /// Check if the session has expired
    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }

    /// Check if the session needs heartbeat refresh
    pub fn needs_heartbeat_refresh(&self, timeout_seconds: i64) -> bool {
        let now = Utc::now();
        (now - self.last_heartbeat).num_seconds() > timeout_seconds
    }
}

/// Information about a connected user (in-memory)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub user_id: UserId,
    pub session_id: Uuid,
    pub endpoint: String,
    pub connected_at: DateTime<Utc>,
    pub last_heartbeat: DateTime<Utc>,
}

/// Backup metadata stored by broker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub user_id: UserId,
    pub state_hash: String,
    pub size_bytes: u64,
    pub created_at: DateTime<Utc>,
}

/// Team within an institution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub id: Uuid,
    pub institution_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Team member role
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamRole {
    Admin,
    Member,
}

impl Default for TeamRole {
    fn default() -> Self {
        Self::Member
    }
}

/// Team membership
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub team_id: Uuid,
    pub user_id: Uuid,
    pub role: TeamRole,
    pub added_at: DateTime<Utc>,
    pub added_by: Option<Uuid>,
}

/// Team with member count for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamSummary {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub member_count: i64,
    pub share_count: i64,
}

/// Trust level between federated institutions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    /// Full bidirectional access to non-PHI content
    Full,
    /// Read-only access (can view but not download)
    ReadOnly,
    /// Trust has been revoked
    Revoked,
}

impl Default for TrustLevel {
    fn default() -> Self {
        Self::Full
    }
}

/// Federation invite for establishing trust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationInvite {
    pub id: Uuid,
    pub from_institution_id: Uuid,
    pub to_institution_id: Option<Uuid>,
    pub to_institution_name: Option<String>,
    pub invite_token: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}

impl FederationInvite {
    pub fn is_valid(&self) -> bool {
        self.accepted_at.is_none() && self.revoked_at.is_none() && self.expires_at > Utc::now()
    }
}

/// Trust relationship between two institutions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationTrust {
    pub id: Uuid,
    pub institution_a: Uuid,
    pub institution_b: Uuid,
    pub trust_level: TrustLevel,
    pub established_at: DateTime<Utc>,
    pub established_by: Uuid,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revoked_by: Option<Uuid>,
}

impl FederationTrust {
    pub fn is_active(&self) -> bool {
        self.revoked_at.is_none() && self.trust_level != TrustLevel::Revoked
    }

    /// Check if an institution is part of this trust
    pub fn includes_institution(&self, institution_id: Uuid) -> bool {
        self.institution_a == institution_id || self.institution_b == institution_id
    }

    /// Get the other institution in the trust relationship
    pub fn other_institution(&self, my_institution: Uuid) -> Option<Uuid> {
        if self.institution_a == my_institution {
            Some(self.institution_b)
        } else if self.institution_b == my_institution {
            Some(self.institution_a)
        } else {
            None
        }
    }
}

/// Summary of a federated institution for UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedInstitutionSummary {
    pub institution_id: Uuid,
    pub institution_name: String,
    pub trust_level: TrustLevel,
    pub established_at: DateTime<Utc>,
    pub share_count: i64,
}
