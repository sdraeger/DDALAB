use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryItem {
    pub id: String,
    pub analysis_id: String,
    pub title: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub tags: Vec<String>,
    pub output_directory: String,
    pub published_at: String,
    pub updated_at: String,
}

pub struct GalleryDB<'a> {
    conn: &'a Connection,
}

impl<'a> GalleryDB<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn add_item(
        &self,
        id: &str,
        analysis_id: &str,
        title: &str,
        description: Option<&str>,
        author: Option<&str>,
        tags: &[String],
        output_directory: &str,
    ) -> Result<GalleryItem> {
        let now = chrono::Utc::now().to_rfc3339();
        let tags_str = serde_json::to_string(tags).context("Failed to serialize tags")?;

        self.conn
            .execute(
                "INSERT INTO gallery_items
                 (id, analysis_id, title, description, author, tags, output_directory, published_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![id, analysis_id, title, description, author, tags_str, output_directory, now, now],
            )
            .context("Failed to add gallery item")?;

        Ok(GalleryItem {
            id: id.to_string(),
            analysis_id: analysis_id.to_string(),
            title: title.to_string(),
            description: description.map(|s| s.to_string()),
            author: author.map(|s| s.to_string()),
            tags: tags.to_vec(),
            output_directory: output_directory.to_string(),
            published_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn remove_item(&self, id: &str) -> Result<bool> {
        let rows = self
            .conn
            .execute("DELETE FROM gallery_items WHERE id = ?1", params![id])
            .context("Failed to remove gallery item")?;

        Ok(rows > 0)
    }

    pub fn list_items(&self) -> Result<Vec<GalleryItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, analysis_id, title, description, author, tags,
                    output_directory, published_at, updated_at
             FROM gallery_items
             ORDER BY published_at DESC",
        )?;

        let items = stmt
            .query_map([], |row| row_to_gallery_item(row))?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to list gallery items")?;

        Ok(items)
    }

    pub fn get_item(&self, id: &str) -> Result<Option<GalleryItem>> {
        self.conn
            .query_row(
                "SELECT id, analysis_id, title, description, author, tags,
                        output_directory, published_at, updated_at
                 FROM gallery_items WHERE id = ?1",
                params![id],
                |row| row_to_gallery_item(row),
            )
            .optional()
            .context("Failed to get gallery item")
    }

    pub fn get_item_by_analysis_id(&self, analysis_id: &str) -> Result<Option<GalleryItem>> {
        self.conn
            .query_row(
                "SELECT id, analysis_id, title, description, author, tags,
                        output_directory, published_at, updated_at
                 FROM gallery_items WHERE analysis_id = ?1",
                params![analysis_id],
                |row| row_to_gallery_item(row),
            )
            .optional()
            .context("Failed to get gallery item by analysis_id")
    }

    pub fn update_item(
        &self,
        id: &str,
        title: &str,
        description: Option<&str>,
        author: Option<&str>,
        tags: &[String],
    ) -> Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        let tags_str = serde_json::to_string(tags).context("Failed to serialize tags")?;

        let rows = self
            .conn
            .execute(
                "UPDATE gallery_items SET title = ?1, description = ?2, author = ?3, tags = ?4, updated_at = ?5
                 WHERE id = ?6",
                params![title, description, author, tags_str, now, id],
            )
            .context("Failed to update gallery item")?;

        Ok(rows > 0)
    }
}

fn row_to_gallery_item(row: &rusqlite::Row) -> rusqlite::Result<GalleryItem> {
    let tags_str: String = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();

    Ok(GalleryItem {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        author: row.get(4)?,
        tags,
        output_directory: row.get(6)?,
        published_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
