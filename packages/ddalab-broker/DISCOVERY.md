# Local Network Broker Discovery

## Overview

DDALAB brokers run on institutional local networks and need to be discoverable by clients without manual configuration. We use **mDNS (Multicast DNS)** for automatic service discovery.

## Architecture

### Broker Side (Server)
```rust
// Announce service on local network
Service Name: "_ddalab-broker._tcp.local"
Instance Name: "DDALAB Broker @ <hostname>"
Port: 8080 (WebSocket)
TXT Records:
  - version=1.0
  - institution=<institution_name>
  - description=<optional_description>
```

### Client Side (Tauri App)
```rust
// Discover available brokers
1. Listen for mDNS announcements
2. Parse discovered services
3. Present list to user in Settings
4. Auto-connect to selected broker
```

## Implementation Plan

### Phase 1: Broker Announcement

**File:** `packages/ddalab-broker/src/discovery.rs`

```rust
use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::time::Duration;

pub struct BrokerDiscovery {
    mdns: ServiceDaemon,
    service_info: ServiceInfo,
}

impl BrokerDiscovery {
    pub fn new(port: u16, institution: &str) -> anyhow::Result<Self> {
        let mdns = ServiceDaemon::new()?;

        let hostname = hostname::get()?.to_string_lossy().to_string();
        let service_type = "_ddalab-broker._tcp.local.";
        let instance_name = format!("DDALAB Broker @ {}", hostname);

        let mut properties = std::collections::HashMap::new();
        properties.insert("version".to_string(), "1.0".to_string());
        properties.insert("institution".to_string(), institution.to_string());

        let service_info = ServiceInfo::new(
            &service_type,
            &instance_name,
            &hostname,
            (), // Use default network interface
            port,
            Some(properties),
        )?;

        Ok(Self { mdns, service_info })
    }

    pub fn start(&self) -> anyhow::Result<()> {
        self.mdns.register(self.service_info.clone())?;
        tracing::info!("mDNS service announced: {}", self.service_info.get_fullname());
        Ok(())
    }

    pub fn stop(&self) -> anyhow::Result<()> {
        self.mdns.unregister(self.service_info.get_fullname())?;
        tracing::info!("mDNS service unregistered");
        Ok(())
    }
}
```

**Update:** `packages/ddalab-broker/src/main.rs`

```rust
mod discovery;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ... existing setup ...

    // Start mDNS announcement
    let discovery = discovery::BrokerDiscovery::new(
        8080,
        "Institution Name"
    )?;
    discovery.start()?;

    // ... run server ...

    discovery.stop()?;
    Ok(())
}
```

### Phase 2: Client Discovery

**File:** `packages/ddalab-tauri/src-tauri/src/sync/discovery.rs`

```rust
use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::time::Duration;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiscoveredBroker {
    pub name: String,
    pub url: String,
    pub institution: String,
    pub version: String,
}

pub async fn discover_brokers(timeout_secs: u64) -> anyhow::Result<Vec<DiscoveredBroker>> {
    let mdns = ServiceDaemon::new()?;
    let service_type = "_ddalab-broker._tcp.local.";

    let receiver = mdns.browse(service_type)?;
    let mut brokers = Vec::new();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        if tokio::time::Instant::now() > deadline {
            break;
        }

        match tokio::time::timeout(Duration::from_secs(1), receiver.recv_async()).await {
            Ok(Ok(event)) => {
                if let ServiceEvent::ServiceResolved(info) = event {
                    let properties = info.get_properties();

                    let broker = DiscoveredBroker {
                        name: info.get_fullname().to_string(),
                        url: format!("ws://{}:{}", info.get_hostname(), info.get_port()),
                        institution: properties.get("institution")
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "Unknown".to_string()),
                        version: properties.get("version")
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "1.0".to_string()),
                    };

                    brokers.push(broker);
                }
            }
            _ => continue,
        }
    }

    Ok(brokers)
}
```

**Tauri Command:** `packages/ddalab-tauri/src-tauri/src/sync/commands.rs`

```rust
#[tauri::command]
pub async fn sync_discover_brokers(timeout_secs: u64) -> Result<Vec<DiscoveredBroker>, String> {
    discovery::discover_brokers(timeout_secs)
        .await
        .map_err(|e| format!("Discovery failed: {}", e))
}
```

### Phase 3: UI Integration

**Update:** `packages/ddalab-tauri/src/components/SettingsPanel.tsx`

```tsx
const [discoveredBrokers, setDiscoveredBrokers] = useState<DiscoveredBroker[]>([])
const [isDiscovering, setIsDiscovering] = useState(false)

const discoverBrokers = async () => {
  setIsDiscovering(true)
  try {
    const brokers = await invoke<DiscoveredBroker[]>('sync_discover_brokers', {
      timeoutSecs: 5
    })
    setDiscoveredBrokers(brokers)
  } catch (error) {
    console.error('Discovery failed:', error)
  } finally {
    setIsDiscovering(false)
  }
}

// UI:
<Button onClick={discoverBrokers} disabled={isDiscovering}>
  <Search className="mr-2 h-4 w-4" />
  {isDiscovering ? 'Searching...' : 'Discover Brokers'}
</Button>

{discoveredBrokers.length > 0 && (
  <div className="space-y-2">
    {discoveredBrokers.map(broker => (
      <div key={broker.url} className="p-3 border rounded-lg">
        <div className="font-medium">{broker.institution}</div>
        <div className="text-xs text-muted-foreground">{broker.url}</div>
        <Button
          size="sm"
          onClick={() => setSyncConfig({ ...syncConfig, brokerUrl: broker.url })}
        >
          Use This Broker
        </Button>
      </div>
    ))}
  </div>
)}
```

## Dependencies

### Broker (`Cargo.toml`)
```toml
[dependencies]
mdns-sd = "0.11"
hostname = "0.4"
```

### Client (`Cargo.toml`)
```toml
[dependencies]
mdns-sd = "0.11"
```

## Platform Compatibility

| Platform | mDNS Support | Notes |
|----------|--------------|-------|
| macOS    | ✅ Built-in   | Uses Bonjour |
| iOS      | ✅ Built-in   | Uses Bonjour |
| Windows  | ✅ Needs install | Bonjour for Windows or built-in (Win10+) |
| Linux    | ✅ Built-in   | Uses Avahi |
| Android  | ✅ Built-in   | Uses NSD (Network Service Discovery) |

## Firewall Requirements

**Ports to allow:**
- UDP 5353 (mDNS)
- TCP 8080 (WebSocket, or configured port)

**Multicast address:**
- IPv4: 224.0.0.251
- IPv6: ff02::fb

## Security Considerations

1. **Local Network Only**: mDNS only works on local subnet (no internet exposure)
2. **No Authentication**: Discovery is unauthenticated (anyone on network can see broker)
3. **Institution Verification**: Client should verify institution name matches expected
4. **TLS**: Consider using WSS (WebSocket Secure) for encrypted connections

## Alternative: Simple UDP Beacon

If mDNS is too complex, use simple UDP multicast:

```rust
// Broker: Send beacon every 5 seconds
let socket = UdpSocket::bind("0.0.0.0:0")?;
socket.set_multicast_loop_v4(true)?;
let multicast_addr = "239.255.42.99:7946";

loop {
    let beacon = json!({
        "service": "ddalab-broker",
        "url": format!("ws://{}:8080", local_ip()),
        "institution": "My Institution"
    });
    socket.send_to(beacon.to_string().as_bytes(), multicast_addr)?;
    tokio::time::sleep(Duration::from_secs(5)).await;
}

// Client: Listen for beacons
let socket = UdpSocket::bind("0.0.0.0:7946")?;
socket.join_multicast_v4(&"239.255.42.99".parse()?, &"0.0.0.0".parse()?)?;

let mut buf = [0u8; 1024];
loop {
    let (len, _) = socket.recv_from(&mut buf)?;
    let beacon: BrokerBeacon = serde_json::from_slice(&buf[..len])?;
    // Add to discovered list
}
```

## Testing

```bash
# Terminal 1: Start broker
cd packages/ddalab-broker
./dev.sh dev

# Terminal 2: Test discovery
dns-sd -B _ddalab-broker._tcp local.

# Or use avahi-browse on Linux
avahi-browse -r _ddalab-broker._tcp
```

## Future Enhancements

- [ ] Broker health monitoring (periodic pings)
- [ ] Automatic reconnection on network change
- [ ] Multiple broker support (failover)
- [ ] Broker capability negotiation
- [ ] IPv6 support
