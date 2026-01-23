# DDALAB Collaboration System Design

**Date**: 2025-01-03
**Status**: Approved
**Scope**: Intra-institution sharing, cross-institution federation, team collaboration, HIPAA compliance

---

## 1. Architecture Overview

The collaboration system is built on three layers:

```
┌─────────────────────────────────────────────────────────┐
│                  Shareable Content Layer                │
│  (DDA results, annotations, workflows, parameters,     │
│   data segments)                                        │
├─────────────────────────────────────────────────────────┤
│                    Security Layer                       │
│  (Data classification, access policies, audit trails,  │
│   encryption, HIPAA mode)                               │
├─────────────────────────────────────────────────────────┤
│                   Federation Layer                      │
│  (Institution discovery, trust relationships,          │
│   cross-institution sync)                               │
└─────────────────────────────────────────────────────────┘
```

**Existing Infrastructure** (leveraged):
- mDNS discovery for local ddalab-server
- AES-256-GCM encryption for all network traffic
- WebSocket sync broker for real-time updates
- petgraph for workflow DAG representation

**New Capabilities**:
- Unified sharing for any content type
- Optional HIPAA mode with data classification
- Team-based access control
- Cross-institution federation with trust model

---

## 2. Data Model & Types

### TypeScript Interfaces

```typescript
// Shareable content types
type ShareableContentType =
  | "dda_result"      // Existing - analysis outputs
  | "annotation"      // New - user annotations on data
  | "workflow"        // New - recorded analysis workflows
  | "parameter_set"   // New - saved DDA configurations
  | "data_segment";   // New - time-windowed raw data excerpts

// Data classification (enforced only when hipaa_mode enabled)
type DataClassification =
  | "phi"             // Protected Health Information - institution-only
  | "de_identified"   // Can be shared externally
  | "synthetic"       // Generated/test data - unrestricted
  | "unclassified";   // Default when HIPAA mode disabled

type Permission = "view" | "download" | "reshare";

interface AccessPolicy {
  type: "public" | "team" | "users" | "institution";
  team_id?: string;
  user_ids?: string[];
  institution_id: string;
  permissions: Permission[];
  expires_at: string;          // ISO 8601 - required
  max_downloads?: number;      // Optional download limit
}

interface ShareMetadata {
  id: string;
  content_type: ShareableContentType;
  content_id: string;
  owner_id: string;
  classification: DataClassification;
  access_policy: AccessPolicy;
  created_at: string;
  last_accessed_at?: string;
  download_count: number;
}

interface InstitutionConfig {
  id: string;
  name: string;
  hipaa_mode: boolean;              // When false, classification ignored
  default_share_expiry_days: number;
  allow_federation: boolean;
  federated_institutions?: string[];
}
```

### Key Design Decisions

- **HIPAA mode is optional**: Institutions not handling patient data can disable it entirely
- **All shares expire**: No permanent shares - prevents orphaned access
- **Content-agnostic sharing**: Same mechanism for all content types
- **Institution-scoped by default**: Every share has an `institution_id`

---

## 3. Access Control & Permissions

### Permission Model

```
Permission Hierarchy:
  view     → Can see content metadata and preview
  download → Can export content locally (includes view)
  reshare  → Can create new shares for others (includes download)
```

### Access Policy Types

| Type | Scope | Use Case |
|------|-------|----------|
| `public` | Anyone in institution | Lab-wide resources |
| `team` | Specific team members | Project collaboration |
| `users` | Named individuals | Peer-to-peer sharing |
| `institution` | All institution members | Official datasets |

### Enforcement Rules

```rust
// Server-side enforcement (pseudocode)
fn can_access(user: &User, share: &ShareMetadata) -> bool {
    // Check expiration first
    if share.access_policy.expires_at < now() {
        return false;
    }

    // Institution boundary check
    if user.institution_id != share.access_policy.institution_id {
        // Cross-institution requires federation trust
        if !is_federated(user.institution_id, share.access_policy.institution_id) {
            return false;
        }
        // PHI cannot cross institution boundaries
        if share.classification == DataClassification::Phi {
            return false;
        }
    }

    // HIPAA mode enforcement
    if institution_config.hipaa_mode {
        if share.classification == DataClassification::Phi
           && share.access_policy.type == "public" {
            return false;  // PHI cannot be public
        }
    }

    // Policy-specific checks
    match share.access_policy.type {
        "public" => true,
        "team" => user.team_ids.contains(share.access_policy.team_id),
        "users" => share.access_policy.user_ids.contains(user.id),
        "institution" => true,  // Already checked institution match
    }
}
```

### Audit Trail

All access attempts are logged:

```typescript
interface AuditLogEntry {
  timestamp: string;
  user_id: string;
  action: "view" | "download" | "share" | "revoke" | "access_denied";
  share_id: string;
  content_type: ShareableContentType;
  source_ip?: string;
  user_agent?: string;
}
```

### Default Expiration

| Classification | Default Expiry |
|----------------|----------------|
| PHI | 7 days |
| De-identified | 30 days |
| Synthetic | 90 days |
| Unclassified | 30 days |

---

## 4. Team Collaboration UX

### Component Structure

```
src/components/collaboration/
├── UnifiedShareDialog.tsx    # Share any content type
├── TeamManagement.tsx        # Create/manage teams
├── SharedWithMe.tsx          # Incoming shares
├── MyShares.tsx              # Outgoing shares
└── ShareNotifications.tsx    # Real-time updates
```

### UnifiedShareDialog

```
┌─────────────────────────────────────────────────────┐
│ Share "EEG Analysis Results"                    [×] │
├─────────────────────────────────────────────────────┤
│ Content Type: [DDA Result ▼]                        │
│                                                     │
│ ┌─ Data Classification ──────────────────────────┐  │
│ │ ○ PHI (Institution only)                       │  │
│ │ ● De-identified                                │  │
│ │ ○ Synthetic                                    │  │
│ └────────────────────────────────────────────────┘  │
│                                                     │
│ ┌─ Share With ───────────────────────────────────┐  │
│ │ ○ Everyone in institution                      │  │
│ │ ● Specific team   [Neurology Lab ▼]           │  │
│ │ ○ Specific users  [Add users...]              │  │
│ └────────────────────────────────────────────────┘  │
│                                                     │
│ ┌─ Permissions ──────────────────────────────────┐  │
│ │ ☑ View   ☑ Download   ☐ Reshare               │  │
│ └────────────────────────────────────────────────┘  │
│                                                     │
│ Expires: [2025-02-03 ▼]  (in 30 days)              │
│                                                     │
│              [Cancel]  [Create Share Link]          │
└─────────────────────────────────────────────────────┘
```

When HIPAA mode is disabled, the "Data Classification" section is hidden.

### TeamManagement

```
┌─────────────────────────────────────────────────────┐
│ Teams                              [+ Create Team]  │
├─────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────┐   │
│ │ 🏥 Neurology Lab                    [Manage]  │   │
│ │    8 members · 24 shared items                │   │
│ ├───────────────────────────────────────────────┤   │
│ │ 🧬 EEG Research Group               [Manage]  │   │
│ │    5 members · 12 shared items                │   │
│ └───────────────────────────────────────────────┘   │
│                                                     │
│ ┌─ Create New Team ─────────────────────────────┐   │
│ │ Name: [________________]                      │   │
│ │ Members: [Search users...]                    │   │
│ │ Default permissions: [View, Download ▼]       │   │
│ │                              [Create]         │   │
│ └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### SharedWithMe / MyShares

```
┌─────────────────────────────────────────────────────┐
│ Shared With Me                    [Filter ▼] [🔍]  │
├─────────────────────────────────────────────────────┤
│ Today                                               │
│ ├─ 📊 EEG Spectral Analysis       from @alice      │
│ │   DDA Result · Expires in 29 days                │
│ │   [View] [Download]                              │
│ │                                                  │
│ ├─ 🔧 Default DDA Parameters      from @bob        │
│ │   Parameter Set · Expires in 89 days             │
│ │   [View] [Download] [Use in Analysis]            │
│ │                                                  │
│ This Week                                          │
│ ├─ 📝 Patient A Annotations       from @carol      │
│ │   Annotation · ⚠️ Expires in 3 days              │
│ │   [View]  (PHI - download restricted)            │
└─────────────────────────────────────────────────────┘
```

---

## 5. Federation Architecture

### Trust Model

Federation uses bilateral trust with explicit opt-in:

```
Institution A                    Institution B
     │                                │
     │  1. Admin sends invite token   │
     ├───────────────────────────────►│
     │                                │
     │  2. Admin accepts, sends ACK   │
     │◄───────────────────────────────┤
     │                                │
     │  3. Trust established          │
     │◄──────────────────────────────►│
     │     (bidirectional)            │
```

### Federated Identity

Users have a federated identity format: `user@institution.edu`

```typescript
interface FederatedUser {
  local_id: string;           // UUID within institution
  federated_id: string;       // "jsmith@hospital.edu"
  home_institution: string;   // Institution ID
  display_name: string;
  verified: boolean;          // Email/SSO verified
}
```

### Cross-Institution Content Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Content Flow Rules                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Source Institution          Target Institution            │
│   ┌─────────────────┐         ┌─────────────────┐          │
│   │   PHI Content   │────X────│   BLOCKED       │          │
│   └─────────────────┘         └─────────────────┘          │
│                                                             │
│   ┌─────────────────┐         ┌─────────────────┐          │
│   │ De-identified   │────────►│   Allowed       │          │
│   └─────────────────┘         └─────────────────┘          │
│                                                             │
│   ┌─────────────────┐         ┌─────────────────┐          │
│   │   Synthetic     │────────►│   Allowed       │          │
│   └─────────────────┘         └─────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Federation Protocol

```rust
// Federation handshake
pub struct FederationInvite {
    from_institution: InstitutionId,
    to_institution: InstitutionId,
    invite_token: String,         // One-time use
    expires_at: DateTime<Utc>,
    requested_by: UserId,         // Admin who initiated
}

pub struct FederationTrust {
    institution_a: InstitutionId,
    institution_b: InstitutionId,
    established_at: DateTime<Utc>,
    trust_level: TrustLevel,      // Full, ReadOnly, Revoked
}
```

### Data Never Leaves Origin

For federated shares, content metadata is synced but data stays at origin:

```
User at Institution B requests federated content:
1. Request goes to Institution B's ddalab-server
2. Server proxies request to Institution A's server
3. Institution A validates permissions, streams data
4. Data flows: A → B → User (never stored at B)
```

---

## 6. Implementation Phases

### Phase 1: Security Hardening (Foundation)

**Goal**: Enforce institution boundaries and add audit trails

**Backend Changes**:
- `src-tauri/src/sync/types.rs` - Add `AccessPolicy`, `DataClassification`, `AuditLogEntry`
- `packages/ddalab-server/src/db/schema.sql` - Add `institutions`, `audit_log` tables
- `packages/ddalab-server/src/handlers/shares.rs` - Institution boundary enforcement
- `packages/ddalab-server/src/config.rs` - `InstitutionConfig` with `hipaa_mode`

**Frontend Changes**:
- `src/types/sync.ts` - Mirror Rust types
- `src/hooks/useInstitutionConfig.ts` - Fetch/cache institution settings

### Phase 2: Content Type Expansion

**Goal**: Enable sharing of annotations, workflows, parameters, data segments

**Backend Changes**:
- `src-tauri/src/sync/content_types.rs` - New shareable content handlers
- `src-tauri/src/commands/sharing.rs` - Generic share command for any content

**Frontend Changes**:
- `src/components/collaboration/UnifiedShareDialog.tsx` - Content-agnostic share UI
- Update existing content views to add "Share" action

### Phase 3: Team Collaboration

**Goal**: Team management and improved UX

**Backend Changes**:
- `packages/ddalab-server/src/db/schema.sql` - Add `teams`, `team_members` tables
- `packages/ddalab-server/src/handlers/teams.rs` - Team CRUD operations

**Frontend Changes**:
- `src/components/collaboration/TeamManagement.tsx`
- `src/components/collaboration/SharedWithMe.tsx`
- `src/components/collaboration/MyShares.tsx`
- `src/components/collaboration/ShareNotifications.tsx`

### Phase 4: Federation

**Goal**: Cross-institution sharing for non-PHI content

**Backend Changes**:
- `packages/ddalab-server/src/federation/mod.rs` - Federation module
- `packages/ddalab-server/src/federation/trust.rs` - Trust establishment
- `packages/ddalab-server/src/federation/proxy.rs` - Content proxy

**Frontend Changes**:
- `src/components/settings/FederationSettings.tsx` - Admin UI for federation
- Update share dialog to show federated options

---

## Appendix: Database Schema Additions

```sql
-- Institution configuration
CREATE TABLE institutions (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    hipaa_mode BOOLEAN NOT NULL DEFAULT true,
    default_share_expiry_days INTEGER NOT NULL DEFAULT 30,
    allow_federation BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Teams within an institution
CREATE TABLE teams (
    id UUID PRIMARY KEY,
    institution_id UUID NOT NULL REFERENCES institutions(id),
    name TEXT NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(institution_id, name)
);

CREATE TABLE team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', -- 'admin', 'member'
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, user_id)
);

-- Audit log for compliance
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    institution_id UUID NOT NULL REFERENCES institutions(id),
    user_id UUID NOT NULL,
    action TEXT NOT NULL, -- 'view', 'download', 'share', 'revoke', 'access_denied'
    share_id UUID,
    content_type TEXT,
    content_id UUID,
    source_ip INET,
    user_agent TEXT,
    metadata JSONB
);

CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, timestamp DESC);
CREATE INDEX idx_audit_log_share ON audit_log(share_id, timestamp DESC);

-- Federation trust relationships
CREATE TABLE federation_trusts (
    id UUID PRIMARY KEY,
    institution_a UUID NOT NULL REFERENCES institutions(id),
    institution_b UUID NOT NULL REFERENCES institutions(id),
    trust_level TEXT NOT NULL DEFAULT 'full', -- 'full', 'read_only', 'revoked'
    established_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    established_by UUID NOT NULL,
    UNIQUE(institution_a, institution_b)
);
```

---

## Appendix: Migration Path

Existing shares will be migrated with:
- `content_type`: `"dda_result"`
- `classification`: `"unclassified"`
- `expires_at`: 30 days from migration date
- `permissions`: `["view", "download"]`

Institutions will default to:
- `hipaa_mode`: `true` (can be disabled by admin)
- `allow_federation`: `false`
