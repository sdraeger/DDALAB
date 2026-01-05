//! Access control enforcement for shares

use crate::storage::{
    AccessPolicy, AccessPolicyType, DataClassification, InstitutionConfig, Permission,
};

/// Result of an access check
#[derive(Debug, Clone)]
pub enum AccessCheckResult {
    /// Access granted with these permissions
    Granted { permissions: Vec<Permission> },
    /// Access denied with reason
    Denied { reason: AccessDeniedReason },
}

/// Reasons for access denial
#[derive(Debug, Clone)]
pub enum AccessDeniedReason {
    Expired,
    WrongInstitution,
    NotInTeam,
    NotInUserList,
    PhiCrossInstitution,
    PhiPublicShare,
    DownloadLimitReached,
}

impl std::fmt::Display for AccessDeniedReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Expired => write!(f, "Share has expired"),
            Self::WrongInstitution => write!(f, "User is not in the share's institution"),
            Self::NotInTeam => write!(f, "User is not a member of the required team"),
            Self::NotInUserList => write!(f, "User is not in the allowed users list"),
            Self::PhiCrossInstitution => {
                write!(f, "PHI content cannot be shared across institutions")
            }
            Self::PhiPublicShare => write!(f, "PHI content cannot be shared publicly"),
            Self::DownloadLimitReached => write!(f, "Download limit has been reached"),
        }
    }
}

/// Check if a user can access a share
pub fn check_access(
    user_id: &str,
    user_institution_id: &str,
    user_team_ids: &[String],
    share_policy: &AccessPolicy,
    classification: DataClassification,
    institution_config: &InstitutionConfig,
    download_count: u32,
) -> AccessCheckResult {
    // 1. Check expiration
    if share_policy.is_expired() {
        return AccessCheckResult::Denied {
            reason: AccessDeniedReason::Expired,
        };
    }

    // 2. Check download limit
    if let Some(max) = share_policy.max_downloads {
        if download_count >= max {
            return AccessCheckResult::Denied {
                reason: AccessDeniedReason::DownloadLimitReached,
            };
        }
    }

    // 3. Institution boundary check
    let same_institution = user_institution_id == share_policy.institution_id;
    if !same_institution {
        // Cross-institution access requires federation (not implemented in Phase 1)
        return AccessCheckResult::Denied {
            reason: AccessDeniedReason::WrongInstitution,
        };
    }

    // 4. HIPAA mode enforcement
    if institution_config.hipaa_mode && classification == DataClassification::Phi {
        // PHI cannot be public
        if matches!(share_policy.policy_type, AccessPolicyType::Public) {
            return AccessCheckResult::Denied {
                reason: AccessDeniedReason::PhiPublicShare,
            };
        }
    }

    // 5. Policy-specific checks
    let access_allowed = match &share_policy.policy_type {
        AccessPolicyType::Public => true,
        AccessPolicyType::Institution => true, // Already checked same institution
        AccessPolicyType::Team { team_id } => user_team_ids.contains(team_id),
        AccessPolicyType::Users { user_ids } => user_ids.contains(&user_id.to_string()),
    };

    if !access_allowed {
        let reason = match &share_policy.policy_type {
            AccessPolicyType::Team { .. } => AccessDeniedReason::NotInTeam,
            AccessPolicyType::Users { .. } => AccessDeniedReason::NotInUserList,
            _ => AccessDeniedReason::WrongInstitution,
        };
        return AccessCheckResult::Denied { reason };
    }

    AccessCheckResult::Granted {
        permissions: share_policy.permissions.clone(),
    }
}

/// Check if a specific permission is granted
pub fn has_permission(result: &AccessCheckResult, permission: Permission) -> bool {
    match result {
        AccessCheckResult::Granted { permissions } => permissions.contains(&permission),
        AccessCheckResult::Denied { .. } => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};

    fn default_institution() -> InstitutionConfig {
        InstitutionConfig {
            id: "inst-1".to_string(),
            name: "Test Institution".to_string(),
            hipaa_mode: true,
            default_share_expiry_days: 30,
            allow_federation: false,
            federated_institutions: Vec::new(),
        }
    }

    fn public_policy(institution_id: &str) -> AccessPolicy {
        AccessPolicy {
            policy_type: AccessPolicyType::Public,
            institution_id: institution_id.to_string(),
            permissions: vec![Permission::View, Permission::Download],
            expires_at: Utc::now() + Duration::days(30),
            max_downloads: None,
        }
    }

    #[test]
    fn test_same_institution_public_access() {
        let policy = public_policy("inst-1");
        let inst = default_institution();

        let result = check_access(
            "user-1",
            "inst-1",
            &[],
            &policy,
            DataClassification::Unclassified,
            &inst,
            0,
        );

        assert!(matches!(result, AccessCheckResult::Granted { .. }));
    }

    #[test]
    fn test_wrong_institution_denied() {
        let policy = public_policy("inst-1");
        let inst = default_institution();

        let result = check_access(
            "user-1",
            "inst-2", // Different institution
            &[],
            &policy,
            DataClassification::Unclassified,
            &inst,
            0,
        );

        assert!(matches!(
            result,
            AccessCheckResult::Denied {
                reason: AccessDeniedReason::WrongInstitution
            }
        ));
    }

    #[test]
    fn test_expired_share_denied() {
        let mut policy = public_policy("inst-1");
        policy.expires_at = Utc::now() - Duration::days(1); // Expired
        let inst = default_institution();

        let result = check_access(
            "user-1",
            "inst-1",
            &[],
            &policy,
            DataClassification::Unclassified,
            &inst,
            0,
        );

        assert!(matches!(
            result,
            AccessCheckResult::Denied {
                reason: AccessDeniedReason::Expired
            }
        ));
    }

    #[test]
    fn test_phi_cannot_be_public() {
        let policy = public_policy("inst-1");
        let inst = default_institution(); // hipaa_mode: true

        let result = check_access(
            "user-1",
            "inst-1",
            &[],
            &policy,
            DataClassification::Phi,
            &inst,
            0,
        );

        assert!(matches!(
            result,
            AccessCheckResult::Denied {
                reason: AccessDeniedReason::PhiPublicShare
            }
        ));
    }

    #[test]
    fn test_phi_allowed_when_hipaa_disabled() {
        let policy = public_policy("inst-1");
        let mut inst = default_institution();
        inst.hipaa_mode = false;

        let result = check_access(
            "user-1",
            "inst-1",
            &[],
            &policy,
            DataClassification::Phi,
            &inst,
            0,
        );

        assert!(matches!(result, AccessCheckResult::Granted { .. }));
    }
}
