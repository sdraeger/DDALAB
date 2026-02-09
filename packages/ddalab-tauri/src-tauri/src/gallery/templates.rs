/// Embedded gallery template assets.
/// These are compiled into the binary at build time.

pub const INDEX_HTML: &str = include_str!("../../gallery_templates/index.html");
pub const RESULT_HTML: &str = include_str!("../../gallery_templates/result.html");
pub const GALLERY_CSS: &str = include_str!("../../gallery_templates/gallery.css");
pub const GALLERY_JS: &str = include_str!("../../gallery_templates/gallery.js");

/// Generate the HTML for a single gallery card in the index page.
pub fn render_card_html(
    slug: &str,
    title: &str,
    variant: &str,
    channels: &str,
    date: &str,
    tags: &str,
    thumbnail_json: &str,
    color_range_json: &str,
) -> String {
    format!(
        r#"<a href="{slug}.html" class="gallery-card" data-title="{title}" data-variant="{variant}" data-channels="{channels}" data-date="{date}" data-tags="{tags}">
      <div class="gallery-card-thumbnail">
        <canvas data-thumbnail='{thumbnail_json}' data-colorrange='{color_range_json}'></canvas>
      </div>
      <div class="gallery-card-body">
        <div class="gallery-card-title">{title}</div>
        <div class="gallery-card-meta">
          <span class="gallery-badge">{variant}</span>
        </div>
        <div class="gallery-card-channels">{channels}</div>
        <div class="gallery-card-date">{date}</div>
      </div>
    </a>"#,
        slug = slug,
        title = html_escape(title),
        variant = html_escape(variant),
        channels = html_escape(channels),
        date = html_escape(date),
        tags = html_escape(tags),
        thumbnail_json = thumbnail_json,
        color_range_json = color_range_json,
    )
}

/// Generate tag badge HTML.
pub fn render_tags_html(tags: &[String]) -> String {
    tags.iter()
        .map(|tag| format!(r#"<span class="gallery-badge">{}</span>"#, html_escape(tag)))
        .collect::<Vec<_>>()
        .join("\n      ")
}

/// Basic HTML escaping.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
