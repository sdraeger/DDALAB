# Quick Start Guide

## 🚀 Running the Broker

### Option 1: Docker Compose (Recommended)

Easiest way to get started with everything preconfigured:

```bash
cd packages/ddalab-broker

# Start broker + PostgreSQL
./dev.sh start

# View logs
./dev.sh logs

# Stop when done
./dev.sh stop
```

The broker is now running at:
- **WebSocket**: `ws://localhost:8080/ws`
- **HTTP API**: `http://localhost:8080/api/shares/:token`
- **Health**: `http://localhost:8080/health`

### Option 2: Local Development

For development with auto-reload:

```bash
cd packages/ddalab-broker

# Start PostgreSQL + broker in watch mode
./dev.sh dev

# This will:
# 1. Start PostgreSQL in Docker
# 2. Run broker with cargo watch (auto-reloads on code changes)
```

### Option 3: Manual Setup

```bash
# Terminal 1: PostgreSQL
docker run -d \
  --name ddalab-broker-postgres \
  -e POSTGRES_DB=ddalab_broker \
  -e POSTGRES_USER=ddalab \
  -e POSTGRES_PASSWORD=test_password \
  -p 5432:5432 \
  postgres:16-alpine

# Terminal 2: Broker
cd packages/ddalab-broker
export DATABASE_URL="postgres://ddalab:test_password@localhost:5432/ddalab_broker"
cargo run
```

## 🧪 Testing the Broker

### Quick Test

```bash
./test-broker.sh
```

Expected output:
```
🧪 Testing DDALAB Sync Broker

1. Health check...
   ✅ Health check passed
2. Database connectivity...
   ✅ Database responding (404 for missing share is correct)

✅ Basic tests passed!
```

### Manual WebSocket Test

1. Install `websocat`:
   ```bash
   brew install websocat  # macOS
   # or
   cargo install websocat # any platform
   ```

2. Connect to broker:
   ```bash
   websocat ws://localhost:8080/ws
   ```

3. Send a test message (paste and press Enter):
   ```json
   {"type":"register_user","user_id":"test@example.com","endpoint":"http://localhost:3001"}
   ```

4. You should receive:
   ```json
   {"type":"ack","message_id":null}
   ```

5. Create a share:
   ```json
   {"type":"publish_share","token":"my-first-share","metadata":{"owner_user_id":"test@example.com","result_id":"result-123","title":"Test Result","description":"My first shared result","created_at":"2025-10-03T12:00:00Z","access_policy":{"type":"public"}}}
   ```

6. Get share via HTTP:
   ```bash
   curl http://localhost:8080/api/shares/my-first-share | jq
   ```

## 📊 Monitoring

### View Logs
```bash
# Docker Compose
./dev.sh logs

# Or manually
docker-compose logs -f broker
```

### Check Database
```bash
# Connect to PostgreSQL
./dev.sh db

# Then run SQL:
SELECT * FROM shared_results;
```

### Active Connections

The broker logs connection cleanup every minute:
```
[INFO] Cleaned up 2 stale connections (5 -> 3)
```

## 🛑 Stopping

```bash
# Docker Compose
./dev.sh stop

# Or completely clean up
./dev.sh clean
```

## 🔧 Troubleshooting

**Port 8080 already in use?**
```bash
lsof -i :8080
kill -9 <PID>
```

**Database connection failed?**
```bash
docker ps | grep postgres
docker restart ddalab-broker-postgres
```

**Can't connect via WebSocket?**
```bash
curl http://localhost:8080/health
# Should return: OK
```

## 📚 Next Steps

- See [TESTING.md](TESTING.md) for comprehensive testing guide
- See [README.md](README.md) for API documentation
- See [dev.sh](dev.sh) for all development commands

## 🎯 Complete End-to-End Example

Here's a complete workflow:

```bash
# 1. Start broker
cd packages/ddalab-broker
./dev.sh start

# 2. Verify it's running
curl http://localhost:8080/health
# Output: OK

# 3. Connect as User A (Terminal 2)
websocat ws://localhost:8080/ws
{"type":"register_user","user_id":"alice","endpoint":"http://192.168.1.10:3001"}
{"type":"publish_share","token":"share-xyz","metadata":{"owner_user_id":"alice","result_id":"result-abc","title":"Alice's Analysis","description":null,"created_at":"2025-10-03T12:00:00Z","access_policy":{"type":"public"}}}

# 4. Connect as User B (Terminal 3)
websocat ws://localhost:8080/ws
{"type":"register_user","user_id":"bob","endpoint":"http://192.168.1.11:3001"}
{"type":"request_share","token":"share-xyz","requester_id":"bob"}

# Bob receives Alice's download URL!

# 5. Stop when done
./dev.sh stop
```

That's it! The broker is coordinating peer-to-peer connections between Alice and Bob.
