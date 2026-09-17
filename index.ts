import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = 3000;

// @note server configuration interfaces and default values
export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  description?: string;
}

export interface ServersData {
  default: string;
  servers: ServerConfig[];
}

const DEFAULT_SERVERS: ServersData = {
  default: 'server1',
  servers: [
    {
      id: 'server1',
      name: 'Server 1',
      host: '127.0.0.1',
      port: 17091,
      description: 'Main Server',
    },
    {
      id: 'server2',
      name: 'Server 2',
      host: '127.0.0.1',
      port: 17092,
      description: 'Sub / Event Server',
    },
  ],
};

/**
 * @note load server list from servers.json with fallback
 */
export function getServersConfig(): ServersData {
  try {
    const configPath = path.join(process.cwd(), 'servers.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (error) {
    console.error('[CONFIG] Failed to load servers.json, using defaults:', error);
  }
  return DEFAULT_SERVERS;
}

/**
 * @note find server by id, name, or port with fallback to default
 */
export function findServer(idOrNameOrPort?: string): ServerConfig {
  const config = getServersConfig();
  if (!idOrNameOrPort) {
    return (
      config.servers.find((s) => s.id === config.default) || config.servers[0]
    );
  }

  const clean = idOrNameOrPort.trim().toLowerCase();

  // match by id
  let match = config.servers.find((s) => s.id.toLowerCase() === clean);
  if (match) return match;

  // match shorthand '1' or '2'
  if (clean === '1' || clean === 'server 1' || clean === 'server1') {
    return config.servers[0];
  }
  if (clean === '2' || clean === 'server 2' || clean === 'server2') {
    return config.servers[1] || config.servers[0];
  }

  // match by port number
  match = config.servers.find((s) => s.port.toString() === clean);
  if (match) return match;

  // match by name contains
  match = config.servers.find((s) => s.name.toLowerCase().includes(clean));
  if (match) return match;

  return config.servers[0];
}

// @note trust proxy - set to number of proxies in front of app
app.set('trust proxy', 1);

// @note middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// @note rate limiter - 50 requests per minute
const limiter = rateLimit({
  windowMs: 60_000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
});
app.use(limiter);

// @note static files from public folder
app.use(express.static(path.join(process.cwd(), 'public')));

// @note request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    'unknown';

  console.log(
    `[REQ] ${req.method} ${req.path} → ${clientIp} | ${_res.statusCode}`,
  );
  next();
});

// @note root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.send('Hello, world!');
});

/**
 * @note api servers endpoint - returns server list in JSON
 */
app.get('/api/servers', (_req: Request, res: Response) => {
  const config = getServersConfig();
  res.json({
    status: 'success',
    default: config.default,
    servers: config.servers,
  });
});

/**
 * @note server_data endpoint - returns Growtopia server connection data
 */
const handleServerData = (req: Request, res: Response) => {
  const queryServer = (req.query.server as string) || (req.body?.server as string);
  const targetServer = findServer(queryServer);

  const serverDataResponse = [
    `server|${targetServer.host}`,
    `port|${targetServer.port}`,
    `type2|1`,
    `RTENDMARKERBS1001`,
  ].join('\n');

  console.log(
    `[SERVER_DATA] Returning ${targetServer.name} (${targetServer.host}:${targetServer.port})`,
  );
  res.setHeader('Content-Type', 'text/plain');
  res.send(serverDataResponse);
};

app.all('/growtopia/server_data.php', handleServerData);
app.all('/server_data.php', handleServerData);

/**
 * @note dashboard endpoint - serves login HTML page with client data and server list
 * @param req - express request with optional body data
 * @param res - express response
 */
app.all('/player/login/dashboard', async (req: Request, res: Response) => {
  const body = req.body;
  let clientData = '';

  // @note body comes as { "key1|val1\nkey2|val2\n...": "" }
  // @note the actual data is in the first key, pipe-delimited with \n separators
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    clientData = Object.keys(body)[0];
  }

  // @note convert clientData to base64 string without JSON quotes
  const encodedClientData = Buffer.from(clientData).toString('base64');

  // @note read dashboard template and replace placeholder
  const templatePath = path.join(process.cwd(), 'template', 'dashboard.html');
  const templateContent = fs.readFileSync(templatePath, 'utf-8');

  const serversConfig = getServersConfig();
  const selectedServerQuery = (req.query.server as string) || '';
  const selectedServer = findServer(selectedServerQuery);

  const serverOptionsHtml = serversConfig.servers
    .map(
      (s) =>
        `<option value="${s.id}" data-name="${s.name}" data-port="${s.port}" ${
          s.id === selectedServer.id ? 'selected' : ''
        }>${s.name} (Port: ${s.port})</option>`,
    )
    .join('\n');

  let htmlContent = templateContent
    .replace('{{ data }}', encodedClientData)
    .replace(/\{\{\s*serverOptions\s*\}\}/g, serverOptionsHtml)
    .replace(/\{\{\s*serversJson\s*\}\}/g, JSON.stringify(serversConfig.servers));

  res.setHeader('Content-Type', 'text/html');
  res.send(htmlContent);
});

/**
 * @note validate login endpoint - validates GrowID credentials and attaches target server
 * @param req - express request with growId, password, _token, and optional server info
 * @param res - express response with token
 */
app.all(
  '/player/growid/login/validate',
  async (req: Request, res: Response) => {
    try {
      const formData = req.body as Record<string, string>;
      const _token = formData._token;
      const growId = formData.growId;
      const password = formData.password;
      const email = formData.email;
      const serverParam = formData.server || formData.serverId || formData.serverName;

      const serverConfig = findServer(serverParam);
      const serverId = serverConfig.id;
      const serverName = formData.serverName || serverConfig.name;
      const serverPort = formData.serverPort ? parseInt(formData.serverPort, 10) : serverConfig.port;

      console.log(`[LOGIN] User: ${growId} -> Target: ${serverName} (${serverConfig.host}:${serverPort})`);

      let token = '';
      if (email) {
        token = Buffer.from(
          `_token=${_token}&growId=${growId}&password=${password}&email=${email}&server=${serverId}&serverName=${encodeURIComponent(serverName)}&port=${serverPort}&reg=1`,
        ).toString('base64');
      } else {
        token = Buffer.from(
          `_token=${_token}&growId=${growId}&password=${password}&server=${serverId}&serverName=${encodeURIComponent(serverName)}&port=${serverPort}&reg=0`,
        ).toString('base64');
      }

      res.send(
        JSON.stringify({
          status: 'success',
          message: 'Account Validated.',
          token,
          url: '',
          accountType: 'growtopia',
          server: serverName,
          port: serverPort,
        }),
      );
    } catch (error) {
      console.log(`[ERROR]: ${error}`);
      res.status(500).json({
        status: 'error',
        message: 'Internal Server Error',
      });
    }
  },
);

/**
 * @note first checktoken endpoint - redirects to validate endpoint
 * @param req - express request with refreshToken and clientData
 * @param res - express response with updated token
 */
app.all('/player/growid/checktoken', async (_req: Request, res: Response) => {
  return res.redirect(307, '/player/growid/validate/checktoken');
});

/**
 * @note second checktoken endpoint - validates token and returns updated token
 * @param req - express request with refreshToken and clientData
 * @param res - express response with updated token
 */
app.all(
  '/player/growid/validate/checktoken',
  async (req: Request, res: Response) => {
    try {
      let refreshToken: string | undefined;
      let clientData: string | undefined;
      let source = 'empty';
      const contentType = req.headers['content-type'] || '';

      if (typeof req.body === 'object' && req.body !== null) {
        const formData = req.body as Record<string, string>;

        if ('refreshToken' in formData || 'clientData' in formData) {
          refreshToken = formData.refreshToken;
          clientData = formData.clientData;
          source = contentType.includes('application/json')
            ? 'json/object'
            : 'form-urlencoded';
        } else if (Object.keys(formData).length === 1) {
          const rawPayload = Object.keys(formData)[0];
          const params = new URLSearchParams(rawPayload);
          refreshToken = params.get('refreshToken') || undefined;
          clientData = params.get('clientData') || undefined;
          if (refreshToken || clientData) {
            source = 'single-key-form-payload';
          }
        }
      } else if (typeof req.body === 'string' && req.body.length > 0) {
        const params = new URLSearchParams(req.body);
        refreshToken = params.get('refreshToken') || undefined;
        clientData = params.get('clientData') || undefined;
        source = 'string/body-parser';
      }

      if (
        (!refreshToken || !clientData) &&
        req.readable &&
        !req.readableEnded
      ) {
        const rawBody = await new Promise<string>((resolve, reject) => {
          let rawPayload = '';

          req.on('data', (chunk: Buffer | string) => {
            rawPayload += chunk.toString();
          });
          req.on('end', () => resolve(rawPayload));
          req.on('error', reject);
        });

        if (rawBody) {
          const params = new URLSearchParams(rawBody);
          refreshToken = params.get('refreshToken') || refreshToken;
          clientData = params.get('clientData') || clientData;
          if (refreshToken || clientData) {
            source = 'raw-stream';
          }
        }
      }

      console.log(`[CHECKTOKEN] Parsed as ${source}`);

      if (!refreshToken || !clientData) {
        console.log(`[ERROR]: Missing refreshToken or clientData`);
        res.status(200).json({
          status: 'error',
          message: 'Missing refreshToken or clientData',
        });
        return;
      }

      let decodedRefreshToken = Buffer.from(refreshToken, 'base64').toString(
        'utf-8',
      );

      // parse existing server info if available
      const existingParams = new URLSearchParams(decodedRefreshToken);
      const existingServer = existingParams.get('server');
      const existingServerName = existingParams.get('serverName')
        ? decodeURIComponent(existingParams.get('serverName')!)
        : undefined;
      const existingPort = existingParams.get('port');

      const serverConfig = findServer(
        existingServer ||
          existingServerName ||
          (existingPort ? existingPort : undefined),
      );
      const serverName = existingServerName || serverConfig.name;
      const serverPort = existingPort
        ? parseInt(existingPort, 10)
        : serverConfig.port;

      // @note remove &reg=0/1 from decodedRefreshToken if available
      if (decodedRefreshToken.includes('&reg=0')) {
        decodedRefreshToken = decodedRefreshToken.replace('&reg=0', '');
      } else if (decodedRefreshToken.includes('&reg=1')) {
        decodedRefreshToken = decodedRefreshToken.replace('&reg=1', '');
      }

      // If decodedRefreshToken doesn't have server info, append it
      if (!decodedRefreshToken.includes('&server=')) {
        decodedRefreshToken += `&server=${serverConfig.id}&serverName=${encodeURIComponent(serverName)}&port=${serverPort}`;
      }

      const token = Buffer.from(
        decodedRefreshToken.replace(
          /(_token=)[^&]*/,
          `$1${Buffer.from(clientData).toString('base64')}`,
        ),
      ).toString('base64');

      res.send(
        JSON.stringify({
          status: 'success',
          message: 'Account Validated.',
          token,
          url: '',
          accountType: 'growtopia',
          accountAge: 2,
          server: serverName,
          port: serverPort,
        }),
      );
    } catch (error) {
      console.log(`[ERROR]: ${error}`);
      res.status(200).json({
        status: 'error',
        message: 'Internal Server Error',
      });
    }
  },
);

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[SERVER] Running on http://localhost:${PORT}`);
  });
}

export default app;
