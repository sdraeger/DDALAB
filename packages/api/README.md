# Server API Overview

## Authentication API (`/auth`)

### POST `/auth/token`

Get an access token for authentication.

**Parameters:**

- `username`: String - User's username
- `password`: String - User's password

**Returns:**

- `access_token`: String - JWT token for authentication
- `token_type`: String - Token type (always "bearer")

### POST `/auth/users`

Create a new user (requires superuser privileges, except for first user).

**Parameters:**

- `username`: String - New user's username
- `password`: String - New user's password
- `is_superuser`: Boolean - Whether user has admin privileges (default: false)

**Returns:**

- `access_token`: String - JWT token for the new user
- `token_type`: String - Token type (always "bearer")

## DDA API (`/dda`)

### POST `/dda/`

Submit a DDA (Dynamic Decomposition Analysis) task.

**Parameters:**

- `file_path`: String - Path to the file to analyze
- `preprocessing_options` (optional):
  - `resample`: Integer - New sampling rate in Hz (default: None)
  - `lowpassFilter`: Integer - Low-pass filter frequency in Hz (default: None)
  - `highpassFilter`: Integer - High-pass filter frequency in Hz (default: None)
  - `notchFilter`: Integer - Notch filter frequency in Hz (default: None)
  - `detrend`: Boolean - Enable detrending (default: false)
  - `removeOutliers`: Boolean - Enable outlier removal (default: false)
  - `smoothing`: Boolean - Enable smoothing (default: false)
  - `smoothingWindow`: Integer - Smoothing window size (default: 3)
  - `normalization`: String - Normalization method (default: "none")

**Returns:**

- `task_id`: String - Unique ID to track the task progress

### GET `/dda/{task_id}`

Get the result of a DDA task.

**Parameters:**

- `task_id`: String (path) - Task ID from submit_dda response

**Returns:**

- `file_path`: String - Path to the analyzed file
- `results`: Object - Dictionary with channel names and result arrays
- `metadata`: Object (optional) - Additional metadata about the results

### GET `/dda/{task_id}/status`

Get the status of a DDA task.

**Parameters:**

- `task_id`: String (path) - Task ID from submit_dda response

**Returns:**

- `status`: String - Either "completed" or "processing"

## Files API (`/files`)

### GET `/files/`

List all available files.

**Returns:**

- `files`: Array[String] - List of available file paths

### GET `/files/{file_path}/exists`

Check if a file exists.

**Parameters:**

- `file_path`: String (path) - Path to file to check

**Returns:**

- Boolean - True if file exists, False otherwise

### GET `/files/list/{path}`

List files and directories in a specific path.

**Parameters:**

- `path`: String (path) - Path relative to data directory (default: "")

**Returns:**

- Array of Objects - Each containing file/directory information

### GET `/files/hash/{file_path}`

Get hash of a file without downloading it.

**Parameters:**

- `file_path`: String (path) - Path to file relative to data directory

**Returns:**

- `hash`: String - Hash of the file

### GET `/files/download/{file_path}`

Download a file with optional hash verification.

**Parameters:**

- `file_path`: String (path) - Path to file relative to data directory
- `client_hash`: String (query, optional) - Hash from client's cached version

**Returns:**

- File download or 304 status if hash matches with header `X-File-Hash`
