use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::Path;

use super::data_transform::GalleryResultData;
use super::templates;

/// Configuration for gallery generation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryConfig {
    pub site_title: String,
    pub site_description: String,
    pub author: String,
    pub base_url: String,
    pub theme: String,
}

/// Result of gallery generation.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryExportResult {
    pub success: bool,
    pub output_path: String,
    pub pages_generated: usize,
    pub warnings: Vec<String>,
}

pub struct GalleryGenerator {
    config: GalleryConfig,
}

impl GalleryGenerator {
    pub fn new(config: GalleryConfig) -> Self {
        Self { config }
    }

    /// Generate the complete gallery site.
    pub fn generate(
        &self,
        items: &[GalleryResultData],
        output_dir: &Path,
    ) -> Result<GalleryExportResult> {
        let mut warnings = Vec::new();

        // Create output directory
        std::fs::create_dir_all(output_dir).context("Failed to create gallery output directory")?;

        let css = templates::GALLERY_CSS;
        let js = templates::GALLERY_JS;

        // Generate individual result pages and collect card HTML
        let mut cards_html = String::new();
        let mut pages_generated = 0;

        for item in items {
            let slug = make_slug(&item.id);

            // Render result page
            match self.render_result_page(item, css, js) {
                Ok(html) => {
                    let page_path = output_dir.join(format!("{}.html", slug));
                    std::fs::write(&page_path, html)
                        .with_context(|| format!("Failed to write {}", page_path.display()))?;
                    pages_generated += 1;
                }
                Err(e) => {
                    warnings.push(format!("Failed to generate page for {}: {}", item.title, e));
                    continue;
                }
            }

            // Generate card HTML for index
            let channels_str = if item.channels.len() <= 4 {
                item.channels.join(", ")
            } else {
                format!(
                    "{}, ... ({} total)",
                    item.channels[..3].join(", "),
                    item.channels.len()
                )
            };

            let thumbnail_json =
                serde_json::to_string(&item.thumbnail).unwrap_or_else(|_| "[]".to_string());
            let color_range_json =
                serde_json::to_string(&item.color_range).unwrap_or_else(|_| "[0,1]".to_string());

            cards_html.push_str(&templates::render_card_html(
                &slug,
                &item.title,
                &item.variant_display_name,
                &channels_str,
                &item.created_at,
                &item.tags.join(", "),
                &thumbnail_json,
                &color_range_json,
            ));
            cards_html.push('\n');
        }

        // Render index page
        let index_html = templates::INDEX_HTML
            .replace("{{SITE_TITLE}}", &self.config.site_title)
            .replace("{{SITE_DESCRIPTION}}", &self.config.site_description)
            .replace("{{THEME}}", &self.config.theme)
            .replace("{{INLINE_CSS}}", css)
            .replace("{{INLINE_JS}}", js)
            .replace("{{CARDS}}", &cards_html);

        let index_path = output_dir.join("index.html");
        std::fs::write(&index_path, index_html).context("Failed to write index.html")?;

        log::info!(
            "Gallery generated: {} pages at {}",
            pages_generated,
            output_dir.display()
        );

        Ok(GalleryExportResult {
            success: true,
            output_path: output_dir.to_string_lossy().to_string(),
            pages_generated,
            warnings,
        })
    }

    fn render_result_page(&self, item: &GalleryResultData, css: &str, js: &str) -> Result<String> {
        let data_json = serde_json::to_string(item).context("Failed to serialize gallery data")?;

        let channels_count = item.channels.len();
        let tags_html = templates::render_tags_html(&item.tags);

        let html = templates::RESULT_HTML
            .replace("{{SITE_TITLE}}", &self.config.site_title)
            .replace("{{TITLE}}", &item.title)
            .replace("{{DESCRIPTION}}", &item.description)
            .replace("{{AUTHOR}}", &item.author)
            .replace("{{FILE_NAME}}", &item.file_name)
            .replace("{{VARIANT_DISPLAY_NAME}}", &item.variant_display_name)
            .replace("{{CHANNELS_COUNT}}", &channels_count.to_string())
            .replace("{{CREATED_AT}}", &item.created_at)
            .replace("{{THEME}}", &self.config.theme)
            .replace("{{TAGS_HTML}}", &tags_html)
            .replace("{{INLINE_CSS}}", css)
            .replace("{{INLINE_JS}}", js)
            .replace("{{DATA_JSON}}", &data_json);

        Ok(html)
    }
}

/// Generate a URL-safe slug from an ID.
fn make_slug(id: &str) -> String {
    let slug: String = id
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();

    // Collapse consecutive hyphens
    let mut result = String::with_capacity(slug.len());
    let mut prev_hyphen = false;
    for c in slug.chars() {
        if c == '-' {
            if !prev_hyphen {
                result.push(c);
            }
            prev_hyphen = true;
        } else {
            result.push(c);
            prev_hyphen = false;
        }
    }

    // Trim leading/trailing hyphens and truncate
    let trimmed = result.trim_matches('-');
    if trimmed.len() > 64 {
        trimmed[..64].trim_end_matches('-').to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_make_slug() {
        assert_eq!(make_slug("abc-123"), "abc-123");
        assert_eq!(make_slug("Hello World!"), "hello-world");
        assert_eq!(make_slug("test__double--hyphens"), "test-double-hyphens");
    }

    #[test]
    fn test_make_slug_truncate() {
        let long_id = "a".repeat(100);
        let slug = make_slug(&long_id);
        assert!(slug.len() <= 64);
    }
}
