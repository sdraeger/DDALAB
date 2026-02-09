use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub license: Option<String>,
    pub permissions: Vec<PluginPermission>,
    pub category: PluginCategory,
    pub entry_point: String,
    pub min_ddalab_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PluginPermission {
    ReadChannelData,
    WriteResults,
    ReadMetadata,
}

impl fmt::Display for PluginPermission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadChannelData => write!(f, "ReadChannelData"),
            Self::WriteResults => write!(f, "WriteResults"),
            Self::ReadMetadata => write!(f, "ReadMetadata"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginCategory {
    Analysis,
    Preprocessing,
    Visualization,
    Export,
}

impl fmt::Display for PluginCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Analysis => write!(f, "analysis"),
            Self::Preprocessing => write!(f, "preprocessing"),
            Self::Visualization => write!(f, "visualization"),
            Self::Export => write!(f, "export"),
        }
    }
}
