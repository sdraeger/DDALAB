use crate::db::{Notification, NotificationType};
use crate::state_manager::AppStateManager;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;

/// Emit notification state change event to frontend
fn emit_notification_change(app: &AppHandle) {
    if let Err(e) = app.emit("notifications-changed", ()) {
        log::warn!("Failed to emit notifications-changed event: {}", e);
    }
}

/// Create and show a notification
#[tauri::command]
pub async fn create_notification(
    title: String,
    message: String,
    notification_type: String,
    action_type: Option<String>,
    action_data: Option<serde_json::Value>,
    state: State<'_, AppStateManager>,
    app: AppHandle,
) -> Result<Notification, String> {
    let notif_type = notification_type
        .parse::<NotificationType>()
        .unwrap_or(NotificationType::Info);

    let notification = Notification::new(
        title.clone(),
        message.clone(),
        notif_type,
        action_type,
        action_data,
    );

    // Save to database
    state
        .get_notifications_db()
        .insert_notification(&notification)
        .map_err(|e| format!("Failed to save notification: {}", e))?;

    // Show native notification
    if let Err(e) = app
        .notification()
        .builder()
        .title(&title)
        .body(&message)
        .show()
    {
        log::warn!("Failed to show native notification: {}", e);
    }

    // Emit event for frontend
    emit_notification_change(&app);

    log::info!("Created notification: {} - {}", title, message);

    Ok(notification)
}

/// Get all notifications
#[tauri::command]
pub async fn list_notifications(
    limit: Option<usize>,
    state: State<'_, AppStateManager>,
) -> Result<Vec<Notification>, String> {
    state
        .get_notifications_db()
        .list_notifications(limit.unwrap_or(100))
        .map_err(|e| format!("Failed to list notifications: {}", e))
}

/// Get unread notification count
#[tauri::command]
pub async fn get_unread_count(state: State<'_, AppStateManager>) -> Result<usize, String> {
    state
        .get_notifications_db()
        .get_unread_count()
        .map_err(|e| format!("Failed to get unread count: {}", e))
}

/// Mark a notification as read
#[tauri::command]
pub async fn mark_notification_read(
    id: String,
    state: State<'_, AppStateManager>,
    app: AppHandle,
) -> Result<(), String> {
    state
        .get_notifications_db()
        .mark_as_read(&id)
        .map_err(|e| format!("Failed to mark notification as read: {}", e))?;

    emit_notification_change(&app);
    Ok(())
}

/// Mark all notifications as read
#[tauri::command]
pub async fn mark_all_notifications_read(
    state: State<'_, AppStateManager>,
    app: AppHandle,
) -> Result<(), String> {
    state
        .get_notifications_db()
        .mark_all_as_read()
        .map_err(|e| format!("Failed to mark all notifications as read: {}", e))?;

    emit_notification_change(&app);
    Ok(())
}

/// Delete a notification
#[tauri::command]
pub async fn delete_notification(
    id: String,
    state: State<'_, AppStateManager>,
    app: AppHandle,
) -> Result<(), String> {
    state
        .get_notifications_db()
        .delete_notification(&id)
        .map_err(|e| format!("Failed to delete notification: {}", e))?;

    emit_notification_change(&app);
    Ok(())
}

/// Delete old notifications (older than specified days)
#[tauri::command]
pub async fn delete_old_notifications(
    days: i64,
    state: State<'_, AppStateManager>,
) -> Result<usize, String> {
    state
        .get_notifications_db()
        .delete_old_notifications(days)
        .map_err(|e| format!("Failed to delete old notifications: {}", e))
}
