// History handlers are aliases to DDA handlers since they manage the same analysis results
// Re-export from dda module for convenience

pub use super::dda::{
    delete_analysis_result, list_analysis_history, list_analysis_summaries, rename_analysis_result,
    save_analysis_to_history,
};
