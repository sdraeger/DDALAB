use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub category: String,
    pub permissions: Vec<String>,
    pub wasm_hash: String,
    pub source: String,
    pub source_url: Option<String>,
    pub installed_at: String,
    pub enabled: bool,
}

pub struct PluginsDB<'a> {
    conn: &'a Connection,
}

impl<'a> PluginsDB<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn install_plugin(
        &self,
        id: &str,
        name: &str,
        version: &str,
        description: Option<&str>,
        author: Option<&str>,
        license: Option<&str>,
        category: &str,
        permissions: &[String],
        wasm_hash: &str,
        source: &str,
        source_url: Option<&str>,
    ) -> Result<InstalledPlugin> {
        let now = chrono::Utc::now().to_rfc3339();
        let perms_str =
            serde_json::to_string(permissions).context("Failed to serialize permissions")?;

        self.conn
            .execute(
                "INSERT OR REPLACE INTO installed_plugins
                 (id, name, version, description, author, license, category, permissions, wasm_hash, source, source_url, installed_at, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1)",
                params![
                    id,
                    name,
                    version,
                    description,
                    author,
                    license,
                    category,
                    perms_str,
                    wasm_hash,
                    source,
                    source_url,
                    now,
                ],
            )
            .context("Failed to install plugin")?;

        Ok(InstalledPlugin {
            id: id.to_string(),
            name: name.to_string(),
            version: version.to_string(),
            description: description.map(|s| s.to_string()),
            author: author.map(|s| s.to_string()),
            license: license.map(|s| s.to_string()),
            category: category.to_string(),
            permissions: permissions.to_vec(),
            wasm_hash: wasm_hash.to_string(),
            source: source.to_string(),
            source_url: source_url.map(|s| s.to_string()),
            installed_at: now,
            enabled: true,
        })
    }

    pub fn get_plugin(&self, id: &str) -> Result<Option<InstalledPlugin>> {
        self.conn
            .query_row(
                "SELECT id, name, version, description, author, license, category, permissions,
                        wasm_hash, source, source_url, installed_at, enabled
                 FROM installed_plugins WHERE id = ?1",
                params![id],
                |row| row_to_plugin(row),
            )
            .optional()
            .context("Failed to get plugin")
    }

    pub fn list_plugins(&self) -> Result<Vec<InstalledPlugin>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, version, description, author, license, category, permissions,
                    wasm_hash, source, source_url, installed_at, enabled
             FROM installed_plugins
             ORDER BY installed_at DESC",
        )?;

        let plugins = stmt
            .query_map([], |row| row_to_plugin(row))?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to list plugins")?;

        Ok(plugins)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<bool> {
        let rows = self
            .conn
            .execute(
                "UPDATE installed_plugins SET enabled = ?1 WHERE id = ?2",
                params![enabled, id],
            )
            .context("Failed to update plugin enabled state")?;

        Ok(rows > 0)
    }

    pub fn uninstall_plugin(&self, id: &str) -> Result<bool> {
        let rows = self
            .conn
            .execute("DELETE FROM installed_plugins WHERE id = ?1", params![id])
            .context("Failed to uninstall plugin")?;

        Ok(rows > 0)
    }

    pub fn get_plugin_by_hash(&self, hash: &str) -> Result<Option<InstalledPlugin>> {
        self.conn
            .query_row(
                "SELECT id, name, version, description, author, license, category, permissions,
                        wasm_hash, source, source_url, installed_at, enabled
                 FROM installed_plugins WHERE wasm_hash = ?1",
                params![hash],
                |row| row_to_plugin(row),
            )
            .optional()
            .context("Failed to get plugin by hash")
    }
}

fn row_to_plugin(row: &rusqlite::Row) -> rusqlite::Result<InstalledPlugin> {
    let perms_str: String = row.get(7)?;
    let permissions: Vec<String> = serde_json::from_str(&perms_str).unwrap_or_default();

    Ok(InstalledPlugin {
        id: row.get(0)?,
        name: row.get(1)?,
        version: row.get(2)?,
        description: row.get(3)?,
        author: row.get(4)?,
        license: row.get(5)?,
        category: row.get(6)?,
        permissions,
        wasm_hash: row.get(8)?,
        source: row.get(9)?,
        source_url: row.get(10)?,
        installed_at: row.get(11)?,
        enabled: row.get::<_, bool>(12)?,
    })
}
