#[cfg(test)]
mod tests {
    use crate::embedded_api::{ApiState, create_router};
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use tempfile::TempDir;
    use tower::ServiceExt;

    // Helper function to create a test router with a temporary data directory
    fn create_test_router() -> (axum::Router, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp directory");
        let state = Arc::new(ApiState::new(temp_dir.path().to_path_buf()));
        let router = create_router(state);
        (router, temp_dir)
    }

    // Helper function to send a request and get the response
    async fn send_request(
        router: axum::Router,
        request: Request<Body>,
    ) -> (StatusCode, serde_json::Value) {
        let response = router
            .oneshot(request)
            .await
            .expect("Failed to send request");

        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value =
            serde_json::from_slice(&body).unwrap_or(serde_json::json!({}));

        (status, json)
    }

    // Helper function to create a simple mock EDF file
    fn create_mock_edf_file(dir: &std::path::Path, name: &str) -> PathBuf {
        let file_path = dir.join(name);

        // Create a minimal valid EDF header (256 bytes for general header)
        let mut header = vec![0u8; 256];

        // Version (8 bytes) - "0       "
        header[0..8].copy_from_slice(b"0       ");

        // Patient ID (80 bytes)
        let patient_id = b"Test Patient";
        header[8..8 + patient_id.len()].copy_from_slice(patient_id);

        // Recording ID (80 bytes)
        let recording_id = b"Test Recording";
        header[88..88 + recording_id.len()].copy_from_slice(recording_id);

        // Start date (8 bytes) - "01.01.24"
        header[168..176].copy_from_slice(b"01.01.24");

        // Start time (8 bytes) - "00.00.00"
        header[176..184].copy_from_slice(b"00.00.00");

        // Number of bytes in header (8 bytes) - should be 256 + (256 * num_signals)
        // For 2 signals: 256 + 512 = 768
        header[184..192].copy_from_slice(b"768     ");

        // Reserved (44 bytes)
        header[192..236].copy_from_slice(b"                                            ");

        // Number of data records (8 bytes) - "10      " (10 records)
        header[236..244].copy_from_slice(b"10      ");

        // Duration of a data record in seconds (8 bytes) - "1       " (1 second)
        header[244..252].copy_from_slice(b"1       ");

        // Number of signals (4 bytes) - "2   " (2 channels)
        header[252..256].copy_from_slice(b"2   ");

        // Now add signal headers (256 bytes per signal * 2 signals = 512 bytes)
        let mut signal_headers = vec![0u8; 512];

        // Signal 1 label (16 bytes)
        signal_headers[0..16].copy_from_slice(b"EEG1            ");
        // Signal 2 label (16 bytes)
        signal_headers[256..272].copy_from_slice(b"EEG2            ");

        // Transducer type (80 bytes per signal) - skip for simplicity
        // Physical dimension (8 bytes per signal)
        signal_headers[192..200].copy_from_slice(b"uV      ");
        signal_headers[192 + 256..200 + 256].copy_from_slice(b"uV      ");

        // Physical minimum (8 bytes per signal) - "-500    "
        signal_headers[208..216].copy_from_slice(b"-500    ");
        signal_headers[208 + 256..216 + 256].copy_from_slice(b"-500    ");

        // Physical maximum (8 bytes per signal) - "500     "
        signal_headers[224..232].copy_from_slice(b"500     ");
        signal_headers[224 + 256..232 + 256].copy_from_slice(b"500     ");

        // Digital minimum (8 bytes per signal) - "-32768  "
        signal_headers[240..248].copy_from_slice(b"-32768  ");
        signal_headers[240 + 256..248 + 256].copy_from_slice(b"-32768  ");

        // Digital maximum (8 bytes per signal) - "32767   "
        signal_headers[256 - 8..256].copy_from_slice(b"32767   ");
        signal_headers[512 - 8..512].copy_from_slice(b"32767   ");

        // Prefiltering (80 bytes per signal) - skip

        // Number of samples per data record (8 bytes per signal) - "256     " (256 Hz)
        signal_headers[216..224].copy_from_slice(b"256     ");
        signal_headers[216 + 256..224 + 256].copy_from_slice(b"256     ");

        // Reserved (32 bytes per signal) - skip

        // Combine headers
        let mut full_header = header;
        full_header.extend_from_slice(&signal_headers);

        // Create some mock data (10 records * 2 signals * 256 samples * 2 bytes = 10240 bytes)
        let mut data = Vec::new();
        for _record in 0..10 {
            for _signal in 0..2 {
                for sample in 0..256 {
                    // Create a simple sine wave pattern
                    let value = ((sample as f64 / 256.0) * 2.0 * std::f64::consts::PI).sin() * 100.0;
                    let sample_i16 = value as i16;
                    data.extend_from_slice(&sample_i16.to_le_bytes());
                }
            }
        }

        // Write the file
        let mut file_content = full_header;
        file_content.extend_from_slice(&data);
        fs::write(&file_path, file_content).expect("Failed to write mock EDF file");

        file_path
    }

    #[tokio::test]
    async fn test_health_endpoint() {
        let (router, _temp_dir) = create_test_router();

        let request = Request::builder()
            .uri("/api/health")
            .body(Body::empty())
            .unwrap();

        let (status, body) = send_request(router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "healthy");
        assert!(body["services"].is_object());
        assert_eq!(body["services"]["api"], "healthy");
        assert_eq!(body["services"]["embedded"], "running");
        assert!(body["timestamp"].is_string());
    }

    #[tokio::test]
    async fn test_list_files_empty_directory() {
        let (router, _temp_dir) = create_test_router();

        let request = Request::builder()
            .uri("/api/files/list")
            .body(Body::empty())
            .unwrap();

        let (status, body) = send_request(router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body["files"].is_array());
        assert_eq!(body["files"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_list_files_with_edf_files() {
        let (router, temp_dir) = create_test_router();

        // Create test EDF files
        create_mock_edf_file(temp_dir.path(), "test1.edf");
        create_mock_edf_file(temp_dir.path(), "test2.edf");

        let request = Request::builder()
            .uri("/api/files/list")
            .body(Body::empty())
            .unwrap();

        let (status, body) = send_request(router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body["files"].is_array());
        let files = body["files"].as_array().unwrap();
        assert_eq!(files.len(), 2);

        // Check that files have expected fields
        assert!(files[0]["path"].is_string());
        assert!(files[0]["name"].is_string());
        assert!(files[0]["size"].is_number());
        assert!(files[0]["last_modified"].is_string());
    }

    #[tokio::test]
    async fn test_get_file_info_success() {
        let (router, temp_dir) = create_test_router();

        let file_path = create_mock_edf_file(temp_dir.path(), "test.edf");
        let encoded_path = urlencoding::encode(file_path.to_str().unwrap());

        let request = Request::builder()
            .uri(format!("/api/files/{}", encoded_path))
            .body(Body::empty())
            .unwrap();

        let (status, body) = send_request(router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body["file_path"].is_string());
        assert!(body["file_name"].is_string());
        assert_eq!(body["file_name"], "test.edf");
        assert!(body["file_size"].is_number());
        assert!(body["duration"].is_number());
        assert!(body["sample_rate"].is_number());
        assert!(body["channels"].is_array());
        assert_eq!(body["channels"].as_array().unwrap().len(), 2);
        assert_eq!(body["channels"][0], "EEG1");
        assert_eq!(body["channels"][1], "EEG2");
    }

    #[tokio::test]
    async fn test_404_handler() {
        let (router, _temp_dir) = create_test_router();

        let request = Request::builder()
            .uri("/api/nonexistent/endpoint")
            .body(Body::empty())
            .unwrap();

        let (status, body) = send_request(router, request).await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(body["error"].is_string());
        assert!(body["message"].is_string());
    }

    #[tokio::test]
    async fn test_dda_history_empty() {
        let (router, _temp_dir) = create_test_router();

        let request = Request::builder()
            .uri("/api/dda/history")
            .body(Body::empty())
            .unwrap();

        let (status, body) = send_request(router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body.is_array());
        assert_eq!(body.as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_edf_data_endpoint() {
        let (router, temp_dir) = create_test_router();

        let file_path = create_mock_edf_file(temp_dir.path(), "test.edf");

        let request = Request::builder()
            .uri(format!(
                "/api/edf/data?file_path={}&start_time=0.0&duration=1.0",
                urlencoding::encode(file_path.to_str().unwrap())
            ))
            .body(Body::empty())
            .unwrap();

        let (status, body) = send_request(router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body["data"].is_array());
        assert!(body["channel_labels"].is_array());
        assert!(body["sampling_frequency"].is_number());

        // Check that we have 2 channels
        let data = body["data"].as_array().unwrap();
        assert_eq!(data.len(), 2);

        // Check that each channel has data
        assert!(data[0].as_array().unwrap().len() > 0);
        assert!(data[1].as_array().unwrap().len() > 0);
    }

    #[tokio::test]
    async fn test_cors_headers() {
        let (router, _temp_dir) = create_test_router();

        let request = Request::builder()
            .uri("/api/health")
            .header("Origin", "http://localhost:3000")
            .body(Body::empty())
            .unwrap();

        let response = router.oneshot(request).await.expect("Failed to send request");

        // CORS headers should be present
        assert!(response.headers().contains_key("access-control-allow-origin"));
    }
}
