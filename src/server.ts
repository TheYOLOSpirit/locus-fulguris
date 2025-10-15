import express from 'express'
import winston from 'winston';
import lightning from 'lightning'

// Lightning address environment variables
const LNADDR_DOMAINS = process.env.LNADDR_DOMAINS?.split(",")
const LNADDR_PORT = process.env.LNADDR_PORT || 3000;
const LNADDR_MIN_SENDABLE_MSATS = process.env.LNADDR_MIN_SENDABLE_MSATS || 1000;
const LNADDR_MAX_SENDABLE_MSATS = process.env.LNADDR_MAX_SENDABLE_MSATS || 250000000;

// LND environment variables
const LND_GRPC_SOCKET = process.env.LND_GRPC_SOCKET;
const LND_GRPC_MACAROON = process.env.LND_GRPC_MACAROON;
const LND_GRPC_CERT = process.env.LND_GRPC_CERT;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
  ],
});

const LND = lightning.authenticatedLndGrpc({
  socket: LND_GRPC_SOCKET,
  macaroon: LND_GRPC_MACAROON,
  cert: LND_GRPC_CERT
});

const app = express()

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (res.statusCode >= 200 && res.statusCode < 300) {
      logger.info(`✅ Success: ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    } else if (res.statusCode >= 400 && res.statusCode < 500) {
      logger.warn(`⚠️ Client Error: ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    } else if (res.statusCode >= 500) {
      logger.error(`❌ Server Error: ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    }
  });
  next();
});

app.get('/.well-known/lnurlp/:username', async (req: express.Request, res: express.Response) => {

  const username = req.params.username;
  const amount = req.query.amount

  //validate hostname
  if (!LNADDR_DOMAINS?.includes(req.hostname)){
    logger.error(`Invalid domain. "${req.hostname}" domain is not in the LNADDR_DOMAINS list.`);
    return
  }

  const identifier = `https://${req.hostname}/.well-known/lnurlp/${username}`;
  const metadata = [
    ['text/identifier', identifier],
    ['text/plain', `Sats for ${username}!`]
  ];

  logger.info(`⚡ Requesting Lightning an ${amount} msat(s) Invoice for Address: ${username}`);

  if (req.query.amount) {
    
    try {
      
      const invoice = await lightning.createInvoice({
            mtokens: `${amount}`,
            lnd: LND.lnd})

      return res.status(200).json({
        status: 'OK',
          successAction: { tag: 'message', message: 'Thank You!' },
          routes: [],
          pr: invoice.request,
          disposable: false
      })
    } catch (e) {
        logger.error(`Pay Request ERROR: ${e}`);
    }
    
  }

  // No amount present, send callback identifier
  return res.status(200).json({
    status: 'OK',
    callback: identifier,
    tag: 'payRequest',
    maxSendable: LNADDR_MIN_SENDABLE_MSATS,
    minSendable: LNADDR_MAX_SENDABLE_MSATS,
    metadata: JSON.stringify(metadata),
    commentsAllowed: 0
  });
});

app.listen(LNADDR_PORT)