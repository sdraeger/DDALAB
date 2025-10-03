# Testing DDALAB Sync Broker

This guide covers how to run and test the broker locally and in Docker.

## Quick Start

### 1. Local Development (Fastest)

```bash
# Terminal 1: Start PostgreSQL
docker run -d \
  --name ddalab-broker-postgres \
  -e POSTGRES_DB=ddalab_broker \
  -e POSTGRES_USER=ddalab \
  -e POSTGRES_PASSWORD=test_password \
  -p 5432:5432 \
  postgres:16-alpine

# Terminal 2: Run broker
cd packages/ddalab-broker
export DATABASE_URL="postgres://ddalab:test_password@localhost:5432/ddalab_broker"
export RUST_LOG=ddalab_broker=debug
cargo run
```

The broker will be available at:
- **WebSocket**: `ws://localhost:8080/ws`
- **HTTP API**: `http://localhost:8080`
- **Health**: `http://localhost:8080/health`

### 2. Docker Compose (Full Stack)

```bash
cd packages/ddalab-broker

# Start everything
docker-compose up --build

# Or run in background
docker-compose up -d --build

# View logs
docker-compose logs -f broker

# Stop
docker-compose down
```

## Manual Testing

### Test 1: Health Check

```bash
curl http://localhost:8080/health
# Expected: OK
```

### Test 2: WebSocket Connection (using websocat)

Install websocat:
```bash
# macOS
brew install websocat

# Linux
cargo install websocat

# Or use wscat (Node.js)
npm install -g wscat
```

**Connect and register a user:**
```bash
websocat ws://localhost:8080/ws
```

Then send messages (paste one at a time):

```json
{"type":"register_user","user_id":"alice@test.edu","endpoint":"http://192.168.1.50:3001"}
```

Expected response:
```json
{"type":"ack","message_id":null}
```

### Test 3: Publish a Share

Still in the websocat connection:
```json
{"type":"publish_share","token":"test-share-123","metadata":{"owner_user_id":"alice@test.edu","result_id":"result-abc","title":"Test Analysis","description":"My first shared result","created_at":"2025-10-03T12:00:00Z","access_policy":{"type":"public"}}}
```

Expected response:
```json
{"type":"ack","message_id":null}
```

### Test 4: Request Share (Different User)

Open a second websocat connection:
```bash
websocat ws://localhost:8080/ws
```

Register second user:
```json
{"type":"register_user","user_id":"bob@test.edu","endpoint":"http://192.168.1.51:3001"}
```

Request the share:
```json
{"type":"request_share","token":"test-share-123","requester_id":"bob@test.edu"}
```

Expected response:
```json
{
  "type":"share_info",
  "info":{
    "metadata":{
      "owner_user_id":"alice@test.edu",
      "result_id":"result-abc",
      "title":"Test Analysis",
      "description":"My first shared result",
      "created_at":"2025-10-03T12:00:00Z",
      "access_policy":{"type":"public"}
    },
    "download_url":"http://192.168.1.50:3001/api/results/result-abc",
    "owner_online":true
  }
}
```

### Test 5: HTTP Share Lookup

```bash
curl http://localhost:8080/api/shares/test-share-123 | jq
```

Expected: Same share info as above.

### Test 6: Heartbeat

In websocat connection:
```json
{"type":"heartbeat","user_id":"alice@test.edu"}
```

Expected:
```json
{"type":"ack","message_id":null}
```

### Test 7: Disconnect

```json
{"type":"disconnect","user_id":"alice@test.edu"}
```

Now if you request the share again, `owner_online` should be `false`.

## Automated Testing

### Integration Tests (TODO)

```bash
# Run integration tests
cargo test --test integration_tests
```

### Load Testing (using wscat and bash)

```bash
# Terminal 1: Run broker
cargo run

# Terminal 2: Run test script
./test-load.sh
```

## Database Inspection

Connect to PostgreSQL to inspect data:

```bash
# Local PostgreSQL
psql -h localhost -U ddalab -d ddalab_broker
# Password: test_password

# Or via Docker
docker exec -it ddalab-broker-postgres psql -U ddalab -d ddalab_broker
```

**Useful queries:**
```sql
-- View all shares
SELECT * FROM shared_results;

-- View non-revoked shares
SELECT * FROM shared_results WHERE revoked_at IS NULL;

-- View backups
SELECT user_id, state_hash, size_bytes, created_at FROM user_backups;
```

## Common Issues

### Port Already in Use

```bash
# Find process using port 8080
lsof -i :8080

# Kill it
kill -9 <PID>
```

### Database Connection Failed

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check logs
docker logs ddalab-broker-postgres

# Restart PostgreSQL
docker restart ddalab-broker-postgres
```

### WebSocket Connection Refused

```bash
# Check if broker is running
curl http://localhost:8080/health

# Check broker logs
docker-compose logs broker
```

## Performance Monitoring

### Check Active Connections

In broker logs, you'll see:
```
[INFO] Cleaned up N stale connections (before -> after)
```

### Database Metrics

```sql
-- Count shares
SELECT COUNT(*) FROM shared_results WHERE revoked_at IS NULL;

-- Count backups
SELECT COUNT(*), SUM(size_bytes) FROM user_backups;
```

## Next Steps

After manual testing, you can:
1. Integrate with local DDALAB client (add sync client to ddalab-tauri)
2. Add authentication layer (JWT tokens)
3. Implement team management
4. Add rate limiting
5. Deploy to institutional server with TLS/WSS

## Quick Test Script

Save this as `test-broker.sh`:

```bash
#!/bin/bash
set -e

echo "🧪 Testing DDALAB Sync Broker"
echo ""

# Health check
echo "1. Health check..."
HEALTH=$(curl -s http://localhost:8080/health)
if [ "$HEALTH" = "OK" ]; then
  echo "   ✅ Health check passed"
else
  echo "   ❌ Health check failed: $HEALTH"
  exit 1
fi

# TODO: Add WebSocket tests using a script-friendly WebSocket client

echo ""
echo "✅ All tests passed!"
```

Make it executable:
```bash
chmod +x test-broker.sh
./test-broker.sh
```
