<h1 align="center">Growtopia Login Backend (Multi-Server)</h1>

<p align="center">
  A Growtopia Login System Dashboard with Multi-Server Support.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/GTVersion-v5.42-green" alt="GTVersion: v5.42">
  <img src="https://img.shields.io/badge/Multi--Server-Supported-blue" alt="Multi-Server Supported">
</p>

## Server Configuration

### Middleware Setup

- **Trust Proxy**: Set to trust 1 proxy in front of the app (`app.set('trust proxy', 1)`)
- **Body Parsing**: Supports both JSON and URL-encoded bodies (`express.json()`, `express.urlencoded({ extended: true })`)
- **CORS**: Enabled for all origins (`cors()`)
- **Rate Limiting**: 50 requests per minute per IP (`windowMs: 60_000, max: 50`)
- **Static Files**: Serves files from `/public` folder (`express.static`)
- **Request Logging**: Logs all requests with client IP, method, path, and status code

### Multi-Server Configuration (`servers.json`)

You can easily configure server names, hosts, and different ports in `servers.json`:

```json
{
  "default": "server1",
  "servers": [
    {
      "id": "server1",
      "name": "Server 1",
      "host": "127.0.0.1",
      "port": 17091,
      "description": "Main Server"
    },
    {
      "id": "server2",
      "name": "Server 2",
      "host": "127.0.0.1",
      "port": 17092,
      "description": "Sub / Event Server"
    }
  ]
}
```

- When players open the login dashboard, the list of servers is automatically populated.
- You can pass `?server=2` or `?server=server2` in the URL to pre-select a specific server.

---

## API Endpoints

- `GET /` - Returns a greeting message
- `GET /api/servers` - Returns list of configured servers in JSON
- `ALL /growtopia/server_data.php` (and `/server_data.php`) - Returns Growtopia client connection info (supports `?server=1` or `?server=2`)
- `ALL /player/login/dashboard` - Serves the login dashboard HTML page with client data and server list
- `POST /player/growid/login/validate` - Validates GrowID credentials and attaches the selected server and port
- `POST /player/growid/checktoken` - Redirects (307) to `/player/growid/validate/checktoken`
- `POST /player/growid/validate/checktoken` - Validates token and preserves selected server and port

---

## How It Works

### 1. Dashboard Request

When a user accesses `/player/login/dashboard`, the server:
- Receives client data in the request body (optional) as object keys
- Extracts the first key which contains pipe-delimited data
- Converts the raw data to base64 format without JSON wrapping
- Loads server options from `servers.json`
- Injects the servers and base64 data into `dashboard.html`

### 2. Client Data Format

When the Growtopia client connects to `/player/login/dashboard`, it sends data in the request body as an object where the keys contain the actual data:

```javascript
{
  "tankIDName|\ntankIDPass|\nrequestedName|\nf|1\nprotocol|225...": ""
}
```

The server extracts the first key, which contains pipe-delimited (`|`) key-value pairs separated by newlines (`\n`). This raw data is then base64 encoded and injected into the HTML template as the `_token` field.

### 3. Login Validation with Server Selection

After the user submits the form from `/player/login/dashboard`, a POST request is sent to `/player/growid/login/validate` containing:

**For Login:**
```txt
_token=<base64_encoded_client_data>
growId=<username>
password=<user_password>
server=server1
serverName=Server 1
serverPort=17091
```

**For Registration:**
```txt
_token=<base64_encoded_client_data>
growId=<username>
email=<user_email>
password=<user_password>
password_confirmation=<confirmed_password>
server=server2
serverName=Server 2
serverPort=17092
```

Then responds with:

```json
{
  "status": "success",
  "message": "Account Validated.",
  "token": "<base64_encoded_credentials>",
  "url": "",
  "accountType": "growtopia",
  "server": "Server 1",
  "port": 17091
}
```

#### Token Structure
The base64-decoded token contains:
```txt
_token=<base64_encoded_client_data>&growId=<username>&password=<user_password>&server=server1&serverName=Server%201&port=17091&reg=0
```
- `_token` - Base64-encoded client data
- `growId` - Username
- `password` - User password
- `server` - Server ID (e.g., `server1`, `server2`)
- `serverName` - Selected Server Name
- `port` - Selected Server Port (e.g., `17091`, `17092`)
- `reg` - Registration status (`0` for login, `1` for registration)

### 4. Token Refresh (`checktoken`)

Endpoint `/player/growid/validate/checktoken` validates the refresh token, updates clientData, and **preserves the selected server and port**:

```json
{
  "status": "success",
  "message": "Account Validated.",
  "token": "<base64_encoded_credentials>",
  "url": "",
  "accountType": "growtopia",
  "accountAge": 2,
  "server": "Server 2",
  "port": 17092
}
```

### 5. Server Data Endpoint (`server_data.php`)

Clients querying `/growtopia/server_data.php` receive standard Growtopia server data:

Default (Server 1):
```txt
server|127.0.0.1
port|17091
type2|1
RTENDMARKERBS1001
```

Server 2 (`/growtopia/server_data.php?server=2`):
```txt
server|127.0.0.1
port|17092
type2|1
RTENDMARKERBS1001
```

---

## Installation & Running

### Using Node.js / NPM:

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run test suite
npm test

# Run production server
npm start
```

### Using Bun:

```bash
# Install dependencies
bun install

# Run development server
bun run dev:bun
```

---

## Deployment (Vercel)

1. Fork or push this repository to GitHub.
2. Go to [Vercel](https://vercel.com) and import the repository.
3. Deploy! The serverless functions will handle all login requests.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
