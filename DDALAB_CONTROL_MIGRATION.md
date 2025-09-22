# DDALAB Control Service Migration

## Summary

The DDALAB Docker Extension backend has been successfully extracted into a separate git submodule called `ddalab-control`. This service is now independently maintained and provides the control APIs for managing DDALAB installations.

## Architecture Changes

### Before
- Docker extension contained both UI and backend code
- Backend was built as part of the extension build process

### After
- Backend extracted to `ddalab-control` submodule
- Backend published as independent Docker image: `sdraeger/ddalab-control:latest`
- Docker extension now uses pre-built backend image

## Repositories

1. **Main Repository**: `git@github.com:sdraeger/DDALAB.git`
   - Contains docker-extension as submodule
   - Contains ddalab-control as submodule

2. **Docker Extension**: `git@github.com:sdraeger/DDALAB-docker-ext.git`
   - UI components only
   - References ddalab-control Docker image

3. **DDALAB Control**: `git@github.com:sdraeger/DDALAB-control.git`
   - Go backend service
   - GitHub Actions for binary releases and Docker publishing

## GitHub Actions

### Binary Releases (on tag)
- Triggered on version tags (v*)
- Builds binaries for multiple platforms:
  - linux/amd64, linux/arm64
  - darwin/amd64, darwin/arm64
  - windows/amd64
- Creates GitHub release with binaries

### Docker Image Publishing (on push)
- Triggered on push to main/develop branches and tags
- Builds multi-platform Docker image (amd64, arm64)
- Publishes to Docker Hub: `sdraeger/ddalab-control`
- Tags:
  - `latest` for main branch
  - Version tags for releases
  - Branch-specific tags

## Usage

### For Docker Extension
The extension Dockerfile now references:
```dockerfile
FROM sdraeger/ddalab-control:latest AS backend
```

### For Launcher
The launcher can either:
1. Use the Docker image: `docker run sdraeger/ddalab-control:latest`
2. Download platform-specific binary from GitHub releases

## Required Secrets

For the GitHub Actions to work, these secrets need to be set in the ddalab-control repository:
- `DOCKER_USERNAME`: Docker Hub username
- `DOCKER_ACCESS_TOKEN`: Docker Hub personal access token (not password)

## Next Steps

1. Push ddalab-control to its remote repository
2. Set up Docker Hub credentials as GitHub secrets
3. Create initial release tag to trigger builds
4. Update docker-extension in its repository to remove backend folder
5. Test the complete workflow
