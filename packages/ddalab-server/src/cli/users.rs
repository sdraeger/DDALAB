use clap::Subcommand;
use rand::Rng;
use sqlx::PgPool;

use crate::auth::hash_password;
use crate::storage::{CreateUser, PostgresUserStore, UserStore};

/// User management subcommands
#[derive(Subcommand)]
pub enum UserCommands {
    /// Create a new user
    Create {
        /// User's email address
        #[arg(short, long)]
        email: String,

        /// User's display name
        #[arg(short, long)]
        name: String,

        /// Password (if not provided, a random one will be generated)
        #[arg(short, long)]
        password: Option<String>,

        /// Make this user an admin
        #[arg(long)]
        admin: bool,
    },

    /// List all users
    List,

    /// Show user details
    Show {
        /// User's email address
        email: String,
    },

    /// Reset a user's password
    ResetPassword {
        /// User's email address
        #[arg(short, long)]
        email: String,

        /// New password (if not provided, a random one will be generated)
        #[arg(short, long)]
        password: Option<String>,
    },

    /// Suspend a user (prevent login)
    Suspend {
        /// User's email address
        #[arg(short, long)]
        email: String,
    },

    /// Activate a suspended user
    Activate {
        /// User's email address
        #[arg(short, long)]
        email: String,
    },

    /// Grant admin privileges to a user
    GrantAdmin {
        /// User's email address
        #[arg(short, long)]
        email: String,
    },

    /// Revoke admin privileges from a user
    RevokeAdmin {
        /// User's email address
        #[arg(short, long)]
        email: String,
    },

    /// Delete a user
    Delete {
        /// User's email address
        #[arg(short, long)]
        email: String,

        /// Skip confirmation prompt
        #[arg(short, long)]
        force: bool,
    },
}

impl UserCommands {
    /// Execute the user command
    pub async fn execute(self, pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
        let user_store = PostgresUserStore::new(pool);

        match self {
            UserCommands::Create {
                email,
                name,
                password,
                admin,
            } => {
                let password = password.unwrap_or_else(generate_secure_password);
                let password_hash =
                    hash_password(&password).map_err(|e| format!("Failed to hash password: {}", e))?;

                let user = user_store
                    .create_user(CreateUser {
                        email: email.clone(),
                        display_name: name.clone(),
                        password_hash,
                        is_admin: admin,
                        institution_id: None,
                    })
                    .await?;

                println!("✅ User created successfully!");
                println!();
                println!("   Email:    {}", user.email);
                println!("   Name:     {}", user.display_name);
                println!("   Password: {}", password);
                println!("   Admin:    {}", if user.is_admin { "Yes" } else { "No" });
                println!();
                println!("⚠️  Please securely share these credentials with the user.");
            }

            UserCommands::List => {
                let users = user_store.list_users().await?;

                if users.is_empty() {
                    println!("No users found.");
                    return Ok(());
                }

                println!(
                    "{:<36} {:<30} {:<20} {:<8} {:<8}",
                    "ID", "Email", "Name", "Admin", "Active"
                );
                println!("{}", "-".repeat(104));

                for user in users {
                    println!(
                        "{:<36} {:<30} {:<20} {:<8} {:<8}",
                        user.id,
                        truncate(&user.email, 28),
                        truncate(&user.display_name, 18),
                        if user.is_admin { "Yes" } else { "No" },
                        if user.is_active { "Yes" } else { "No" }
                    );
                }
            }

            UserCommands::Show { email } => {
                let user = user_store.get_user_by_email(&email).await?;

                println!("User Details:");
                println!("  ID:         {}", user.id);
                println!("  Email:      {}", user.email);
                println!("  Name:       {}", user.display_name);
                println!("  Admin:      {}", if user.is_admin { "Yes" } else { "No" });
                println!("  Active:     {}", if user.is_active { "Yes" } else { "No" });
                println!("  Created:    {}", user.created_at);
                println!(
                    "  Last Login: {}",
                    user.last_login
                        .map(|t| t.to_string())
                        .unwrap_or_else(|| "Never".to_string())
                );
            }

            UserCommands::ResetPassword { email, password } => {
                let user = user_store.get_user_by_email(&email).await?;
                let password = password.unwrap_or_else(generate_secure_password);
                let password_hash =
                    hash_password(&password).map_err(|e| format!("Failed to hash password: {}", e))?;

                user_store.update_password(user.id, &password_hash).await?;

                println!("✅ Password reset successfully!");
                println!();
                println!("   Email:        {}", user.email);
                println!("   New Password: {}", password);
                println!();
                println!("⚠️  Please securely share the new password with the user.");
            }

            UserCommands::Suspend { email } => {
                let user = user_store.get_user_by_email(&email).await?;
                user_store.set_user_active(user.id, false).await?;

                println!("✅ User {} has been suspended.", email);
            }

            UserCommands::Activate { email } => {
                let user = user_store.get_user_by_email(&email).await?;
                user_store.set_user_active(user.id, true).await?;

                println!("✅ User {} has been activated.", email);
            }

            UserCommands::GrantAdmin { email } => {
                let user = user_store.get_user_by_email(&email).await?;
                user_store.set_user_admin(user.id, true).await?;

                println!("✅ Admin privileges granted to {}.", email);
            }

            UserCommands::RevokeAdmin { email } => {
                let user = user_store.get_user_by_email(&email).await?;
                user_store.set_user_admin(user.id, false).await?;

                println!("✅ Admin privileges revoked from {}.", email);
            }

            UserCommands::Delete { email, force } => {
                let user = user_store.get_user_by_email(&email).await?;

                if !force {
                    println!("Are you sure you want to delete user {}? (y/N)", email);
                    let mut input = String::new();
                    std::io::stdin().read_line(&mut input)?;
                    if !input.trim().eq_ignore_ascii_case("y") {
                        println!("Cancelled.");
                        return Ok(());
                    }
                }

                user_store.delete_user(user.id).await?;
                println!("✅ User {} has been deleted.", email);
            }
        }

        Ok(())
    }
}

/// Generate a secure random password
fn generate_secure_password() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
    let mut rng = rand::thread_rng();

    (0..16)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// Truncate string to max length with ellipsis
fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len - 3])
    }
}
