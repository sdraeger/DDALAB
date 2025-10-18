// History handlers are aliases to DDA handlers since they manage the same analysis results
// Re-export from dda module for convenience

pub use super::dda::{
    list_analysis_history,
    save_analysis_to_history,
    delete_analysis_result,
    rename_analysis_result,
};
