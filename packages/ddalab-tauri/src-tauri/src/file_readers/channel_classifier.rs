use super::ChannelMetadata;

/// Standard 10-20 system electrode labels (case-insensitive matching).
const EEG_10_20_LABELS: &[&str] = &[
    // 10-20 standard
    "fp1", "fp2", "f3", "f4", "c3", "c4", "p3", "p4", "o1", "o2", "f7", "f8", "t3", "t4", "t5",
    "t6", "t7", "t8", "p7", "p8", "fz", "cz", "pz", "oz", // 10-10 extensions
    "af3", "af4", "af7", "af8", "afz", "f1", "f2", "f5", "f6", "f9", "f10", "fc1", "fc2", "fc3",
    "fc4", "fc5", "fc6", "fcz", "ft7", "ft8", "ft9", "ft10", "c1", "c2", "c5", "c6", "cp1", "cp2",
    "cp3", "cp4", "cp5", "cp6", "cpz", "tp7", "tp8", "tp9", "tp10", "p1", "p2", "p5", "p6", "p9",
    "p10", "po3", "po4", "po7", "po8", "poz", "o9", "o10", // 10-5 common additions
    "fpz", "nz", "iz", // Common reference labels
    "a1", "a2", "m1", "m2",
];

/// Classify a single channel label into a channel type and unit.
///
/// Priority order:
/// 1. Type prefix strip (e.g., "EEG Fp1" → EEG)
/// 2. Known pattern match (EOG, ECG, EMG, STIM, MEG, RESP, MISC)
/// 3. 10-20 system electrode match → EEG
/// 4. Fallback → Unknown
pub fn classify_channel_label(label: &str) -> ChannelMetadata {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return ChannelMetadata::default();
    }

    let lower = trimmed.to_lowercase();

    // 1. Check for type prefix (e.g., "EEG Fp1", "EOG Left", "EMG1")
    if let Some(meta) = classify_by_prefix(&lower) {
        return meta;
    }

    // 2. Check known patterns (EOG, ECG, EMG, STIM, MEG, RESP, MISC)
    if let Some(meta) = classify_by_pattern(&lower) {
        return meta;
    }

    // 3. Check 10-20 system labels
    if EEG_10_20_LABELS.contains(&lower.as_str()) {
        return ChannelMetadata {
            channel_type: "EEG".to_string(),
            unit: "uV".to_string(),
        };
    }

    // 4. Fallback
    ChannelMetadata::default()
}

/// Classify a batch of channel labels.
pub fn classify_channel_labels(labels: &[String]) -> Vec<ChannelMetadata> {
    labels.iter().map(|l| classify_channel_label(l)).collect()
}

fn classify_by_prefix(lower: &str) -> Option<ChannelMetadata> {
    let prefixes: &[(&str, &str, &str)] = &[
        ("eeg ", "EEG", "uV"),
        ("eog ", "EOG", "uV"),
        ("ecg ", "ECG", "mV"),
        ("ekg ", "ECG", "mV"),
        ("emg ", "EMG", "uV"),
        ("meg ", "MEG", "fT"),
        ("stim ", "STIM", ""),
        ("misc ", "MISC", ""),
        ("resp ", "RESP", ""),
        ("ref ", "EEG", "uV"),
    ];

    for &(prefix, ch_type, unit) in prefixes {
        if lower.starts_with(prefix) {
            return Some(ChannelMetadata {
                channel_type: ch_type.to_string(),
                unit: unit.to_string(),
            });
        }
    }

    None
}

fn classify_by_pattern(lower: &str) -> Option<ChannelMetadata> {
    // EOG patterns
    if lower == "eog"
        || lower == "veog"
        || lower == "heog"
        || lower.starts_with("eog")
        || lower.ends_with("eog")
    {
        return Some(ChannelMetadata {
            channel_type: "EOG".to_string(),
            unit: "uV".to_string(),
        });
    }

    // ECG/EKG patterns
    if lower == "ecg" || lower == "ekg" || lower.starts_with("ecg") || lower.starts_with("ekg") {
        return Some(ChannelMetadata {
            channel_type: "ECG".to_string(),
            unit: "mV".to_string(),
        });
    }

    // EMG patterns
    if lower == "emg" || lower.starts_with("emg") {
        return Some(ChannelMetadata {
            channel_type: "EMG".to_string(),
            unit: "uV".to_string(),
        });
    }

    // STIM / Status / Trigger patterns
    if lower == "stim"
        || lower == "status"
        || lower == "trigger"
        || lower.starts_with("sti ")
        || lower.starts_with("sti0")
        || lower.starts_with("stim")
        || lower.starts_with("trigger")
        || lower.starts_with("dc")
    {
        return Some(ChannelMetadata {
            channel_type: "STIM".to_string(),
            unit: "".to_string(),
        });
    }

    // MEG patterns (MEG0111, MEG 0111)
    if lower.starts_with("meg") {
        return Some(ChannelMetadata {
            channel_type: "MEG".to_string(),
            unit: "fT".to_string(),
        });
    }

    // Respiration
    if lower == "resp" || lower == "respiration" || lower.starts_with("resp") {
        return Some(ChannelMetadata {
            channel_type: "RESP".to_string(),
            unit: "".to_string(),
        });
    }

    // MISC
    if lower == "misc" || lower.starts_with("misc") {
        return Some(ChannelMetadata {
            channel_type: "MISC".to_string(),
            unit: "".to_string(),
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_10_20_labels() {
        assert_eq!(classify_channel_label("Fp1").channel_type, "EEG");
        assert_eq!(classify_channel_label("fp2").channel_type, "EEG");
        assert_eq!(classify_channel_label("Cz").channel_type, "EEG");
        assert_eq!(classify_channel_label("O2").channel_type, "EEG");
        assert_eq!(classify_channel_label("PO7").channel_type, "EEG");
        assert_eq!(classify_channel_label("FT10").channel_type, "EEG");
        assert_eq!(classify_channel_label("TP9").channel_type, "EEG");
    }

    #[test]
    fn test_edf_prefixes() {
        let m = classify_channel_label("EEG Fp1");
        assert_eq!(m.channel_type, "EEG");
        assert_eq!(m.unit, "uV");

        let m = classify_channel_label("EOG Left");
        assert_eq!(m.channel_type, "EOG");

        let m = classify_channel_label("ECG I");
        assert_eq!(m.channel_type, "ECG");
        assert_eq!(m.unit, "mV");

        let m = classify_channel_label("EMG chin");
        assert_eq!(m.channel_type, "EMG");
    }

    #[test]
    fn test_eog_patterns() {
        assert_eq!(classify_channel_label("VEOG").channel_type, "EOG");
        assert_eq!(classify_channel_label("HEOG").channel_type, "EOG");
        assert_eq!(classify_channel_label("EOG1").channel_type, "EOG");
        assert_eq!(classify_channel_label("leftEOG").channel_type, "EOG");
    }

    #[test]
    fn test_ecg_patterns() {
        assert_eq!(classify_channel_label("ECG").channel_type, "ECG");
        assert_eq!(classify_channel_label("EKG").channel_type, "ECG");
        assert_eq!(classify_channel_label("ECG1").channel_type, "ECG");
    }

    #[test]
    fn test_emg_patterns() {
        assert_eq!(classify_channel_label("EMG").channel_type, "EMG");
        assert_eq!(classify_channel_label("EMG1").channel_type, "EMG");
    }

    #[test]
    fn test_stim_patterns() {
        assert_eq!(classify_channel_label("STI 014").channel_type, "STIM");
        assert_eq!(classify_channel_label("STI014").channel_type, "STIM");
        assert_eq!(classify_channel_label("Status").channel_type, "STIM");
        assert_eq!(classify_channel_label("Trigger").channel_type, "STIM");
        assert_eq!(classify_channel_label("STIM").channel_type, "STIM");
    }

    #[test]
    fn test_meg_patterns() {
        let m = classify_channel_label("MEG 0111");
        assert_eq!(m.channel_type, "MEG");
        assert_eq!(m.unit, "fT");

        let m = classify_channel_label("MEG0111");
        assert_eq!(m.channel_type, "MEG");
        assert_eq!(m.unit, "fT");
    }

    #[test]
    fn test_resp_patterns() {
        assert_eq!(classify_channel_label("RESP").channel_type, "RESP");
        assert_eq!(classify_channel_label("Respiration").channel_type, "RESP");
    }

    #[test]
    fn test_misc_patterns() {
        assert_eq!(classify_channel_label("MISC 001").channel_type, "MISC");
        assert_eq!(classify_channel_label("MISC").channel_type, "MISC");
    }

    #[test]
    fn test_unknown_fallback() {
        let m = classify_channel_label("Ch1");
        assert_eq!(m.channel_type, "Unknown");
        assert_eq!(m.unit, "uV");

        let m = classify_channel_label("X1");
        assert_eq!(m.channel_type, "Unknown");

        let m = classify_channel_label("");
        assert_eq!(m.channel_type, "Unknown");
    }

    #[test]
    fn test_reference_labels() {
        assert_eq!(classify_channel_label("A1").channel_type, "EEG");
        assert_eq!(classify_channel_label("A2").channel_type, "EEG");
        assert_eq!(classify_channel_label("M1").channel_type, "EEG");
        assert_eq!(classify_channel_label("M2").channel_type, "EEG");
    }

    #[test]
    fn test_classify_batch() {
        let labels = vec![
            "Fp1".to_string(),
            "EOG Left".to_string(),
            "ECG".to_string(),
            "Status".to_string(),
            "Ch99".to_string(),
        ];
        let results = classify_channel_labels(&labels);
        assert_eq!(results.len(), 5);
        assert_eq!(results[0].channel_type, "EEG");
        assert_eq!(results[1].channel_type, "EOG");
        assert_eq!(results[2].channel_type, "ECG");
        assert_eq!(results[3].channel_type, "STIM");
        assert_eq!(results[4].channel_type, "Unknown");
    }
}
