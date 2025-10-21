use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NotificationType {
    Info,
    Success,
    Warning,
    Error,
}

impl std::fmt::Display for NotificationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NotificationType::Info => write!(f, "info"),
            NotificationType::Success => write!(f, "success"),
            NotificationType::Warning => write!(f, "warning"),
            NotificationType::Error => write!(f, "error"),
        }
    }
}

impl std::str::FromStr for NotificationType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "info" => Ok(NotificationType::Info),
            "success" => Ok(NotificationType::Success),
            "warning" => Ok(NotificationType::Warning),
            "error" => Ok(NotificationType::Error),
            _ => Err(format!("Unknown notification type: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub title: String,
    pub message: String,
    pub notification_type: NotificationType,
    pub created_at: DateTime<Utc>,
    pub read: bool,
    pub action_type: Option<String>,
    pub action_data: Option<serde_json::Value>,
}

impl Notification {
    pub fn new(
        title: String,
        message: String,
        notification_type: NotificationType,
        action_type: Option<String>,
        action_data: Option<serde_json::Value>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            message,
            notification_type,
            created_at: Utc::now(),
            read: false,
            action_type,
            action_data,
        }
    }

    pub fn mark_read(&mut self) {
        self.read = true;
    }
}

pub struct NotificationsDatabase {
    conn: Arc<Mutex<Connection>>,
}

impl NotificationsDatabase {
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path)
            .context("Failed to open notifications database")?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.init_schema()?;

        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                notification_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 0,
                action_type TEXT,
                action_data TEXT
            )",
            [],
        ).context("Failed to create notifications table")?;

        // Create index for faster queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notifications_created_at
             ON notifications(created_at DESC)",
            [],
        ).context("Failed to create notifications index")?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notifications_read
             ON notifications(read, created_at DESC)",
            [],
        ).context("Failed to create notifications read index")?;

        Ok(())
    }

    pub fn insert_notification(&self, notification: &Notification) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "INSERT INTO notifications
             (id, title, message, notification_type, created_at, read, action_type, action_data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            [
                &notification.id,
                &notification.title,
                &notification.message,
                &notification.notification_type.to_string(),
                &notification.created_at.to_rfc3339(),
                &(notification.read as i32).to_string(),
                &notification.action_type.as_ref().unwrap_or(&String::new()),
                &notification.action_data.as_ref()
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .unwrap_or_default(),
            ],
        ).context("Failed to insert notification")?;

        Ok(())
    }

    pub fn get_notification(&self, id: &str) -> Result<Option<Notification>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, title, message, notification_type, created_at, read, action_type, action_data
             FROM notifications WHERE id = ?1"
        )?;

        let result = stmt.query_row([id], |row| {
            let notification_type_str: String = row.get(3)?;
            let action_type: String = row.get(6)?;
            let action_data_str: String = row.get(7)?;

            Ok(Notification {
                id: row.get(0)?,
                title: row.get(1)?,
                message: row.get(2)?,
                notification_type: notification_type_str.parse()
                    .unwrap_or(NotificationType::Info),
                created_at: row.get::<_, String>(4)?
                    .parse()
                    .unwrap_or_else(|_| Utc::now()),
                read: row.get::<_, i32>(5)? != 0,
                action_type: if action_type.is_empty() { None } else { Some(action_type) },
                action_data: if action_data_str.is_empty() {
                    None
                } else {
                    serde_json::from_str(&action_data_str).ok()
                },
            })
        });

        match result {
            Ok(notification) => Ok(Some(notification)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn list_notifications(&self, limit: usize) -> Result<Vec<Notification>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, title, message, notification_type, created_at, read, action_type, action_data
             FROM notifications
             ORDER BY created_at DESC
             LIMIT ?1"
        )?;

        let notifications = stmt.query_map([limit], |row| {
            let notification_type_str: String = row.get(3)?;
            let action_type: String = row.get(6)?;
            let action_data_str: String = row.get(7)?;

            Ok(Notification {
                id: row.get(0)?,
                title: row.get(1)?,
                message: row.get(2)?,
                notification_type: notification_type_str.parse()
                    .unwrap_or(NotificationType::Info),
                created_at: row.get::<_, String>(4)?
                    .parse()
                    .unwrap_or_else(|_| Utc::now()),
                read: row.get::<_, i32>(5)? != 0,
                action_type: if action_type.is_empty() { None } else { Some(action_type) },
                action_data: if action_data_str.is_empty() {
                    None
                } else {
                    serde_json::from_str(&action_data_str).ok()
                },
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

        Ok(notifications)
    }

    pub fn get_unread_count(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notifications WHERE read = 0",
            [],
            |row| row.get(0),
        )?;

        Ok(count as usize)
    }

    pub fn mark_as_read(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "UPDATE notifications SET read = 1 WHERE id = ?1",
            [id],
        ).context("Failed to mark notification as read")?;

        Ok(())
    }

    pub fn mark_all_as_read(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "UPDATE notifications SET read = 1",
            [],
        ).context("Failed to mark all notifications as read")?;

        Ok(())
    }

    pub fn delete_notification(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "DELETE FROM notifications WHERE id = ?1",
            [id],
        ).context("Failed to delete notification")?;

        Ok(())
    }

    pub fn delete_old_notifications(&self, days: i64) -> Result<usize> {
        let conn = self.conn.lock().unwrap();

        let cutoff_date = Utc::now() - chrono::Duration::days(days);

        let deleted = conn.execute(
            "DELETE FROM notifications WHERE created_at < ?1",
            [cutoff_date.to_rfc3339()],
        ).context("Failed to delete old notifications")?;

        Ok(deleted)
    }
}
