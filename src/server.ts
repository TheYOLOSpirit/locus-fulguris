import express from 'express'
import winston from 'winston';
import lightning from 'lightning'
import { verifyEvent, NostrEvent, EventTemplate, SimplePool, finalizeEvent } from 'nostr-tools';
import crypto from 'crypto';
import { hexToBytes } from '@noble/hashes/utils';

// Lightning address environment variables
const LNADDR_DOMAINS: string[] = process.env.LNADDR_DOMAINS?.split(",")?.map(domain => domain.toLowerCase()) || [];
const LNADDR_PORT = Number(process.env.LNADDR_PORT) || 3000;
const LNADDR_MIN_SENDABLE_MSATS = Number(process.env.LNADDR_MIN_SENDABLE_MSATS) || 1000;
const LNADDR_MAX_SENDABLE_MSATS = Number(process.env.LNADDR_MAX_SENDABLE_MSATS) || 250000000;

// LND environment variables
const LND_GRPC_SOCKET = process.env.LND_GRPC_SOCKET;
const LND_GRPC_MACAROON = process.env.LND_GRPC_MACAROON;
const LND_GRPC_CERT= process.env.LND_GRPC_CERT;
const NOSTR_PUBKEY_HEX = process.env.NOSTR_PUBKEY_HEX;
const NOSTR_PRIVKEY_HEX = process.env.NOSTR_PRIVKEY_HEX;

//NOSTR stuffs
const pool  = new SimplePool();

//Other stuffs
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
  const hostname = req.hostname.toLowerCase()

  //validate hostname
  if (!LNADDR_DOMAINS?.includes(hostname)){
    logger.error(`Invalid domain. "${hostname}" domain is not in the LNADDR_DOMAINS list.`);
    return
  }

  const identifier = `https://${hostname}/.well-known/lnurlp/${username}`;
  const callback = `https://${hostname}/lnurlp/callback/${username}`;

  const metadata = [
    ['text/identifier', identifier],
    ['text/plain', `Sats for ${username}!`]
  ];

  logger.info(`⚡ Requesting Lightning an ${amount} msat(s) Invoice for Address: ${username}`);

  return res.status(200).json({
    status: 'OK',
    callback: callback,
    tag: 'payRequest',
    maxSendable: LNADDR_MIN_SENDABLE_MSATS,
    minSendable: LNADDR_MAX_SENDABLE_MSATS,
    metadata: JSON.stringify(metadata),
    commentsAllowed: 0,
    allowsNostr: true,
    nostrPubkey: NOSTR_PUBKEY_HEX
  });
});

app.get('/lnurlp/callback/:username', async (req: express.Request, res: express.Response) => {

  const { amount, nostr } = req.query;
  let descriptionHash: string;
  let zapEvent: NostrEvent | null = null;

  if (!amount) {
     return res.status(400).json({ status: 'ERROR', reason: 'No amount specified' });
  }

  if (typeof nostr === 'string') {
    try {
      zapEvent = JSON.parse(nostr) as NostrEvent;

      if (!verifyEvent(zapEvent)) {
        return res.status(400).json({ status: 'ERROR', reason: 'Invalid Nostr Signature' });
      }

      descriptionHash = crypto.createHash('sha256').update(nostr).digest('hex');

    } catch (e) {
      return res.status(400).json({ status: 'ERROR', reason: 'Invalid Nostr JSON' });
    }
  } else {
    const metadata = `[["text/plain", "Pay user"]]`;
    descriptionHash = crypto.createHash('sha256').update(metadata).digest('hex');
  }

    try {
      const invoice = await lightning.createInvoice({
            mtokens: `${amount}`,
            lnd: LND.lnd})

      if (zapEvent) {

        const sub = lightning.subscribeToInvoice({
        id: invoice.id,
        lnd: LND.lnd})


        sub.on('invoice_updated', async invoice => {

          logger.info(`Invoice updated. is_confirmed: ${invoice.is_confirmed}`)
          logger.debug(`Invoice: ${JSON.stringify(invoice)}`)
        
          if (!invoice.is_confirmed) return;
      
          try {
        
            const tags = zapEvent!.tags.filter(t => t[0] === 'p' || t[0] === 'e');
            tags.push(['bolt11', invoice.request]);
            tags.push(['description', JSON.stringify(zapEvent!)]);
            tags.push(['P', zapEvent!.pubkey]);

            const eventTemplate: EventTemplate = {
              kind: 9735,
              created_at: Math.floor(Date.now() / 1000),
              tags: tags,
              content: "", 
            };

            logger.info(`EventTemplate: ${JSON.stringify(eventTemplate)}`);

            const signedEvent = finalizeEvent(eventTemplate, hexToBytes(NOSTR_PRIVKEY_HEX!))

            const relayTag = zapEvent!.tags.find(t => t[0] === 'relays');
            const relays = relayTag && relayTag.length > 1 
              ? relayTag.slice(1) 
              : ['wss://relay.damus.io', 'wss://nos.lol'];

            logger.debug(`Publishing receipt to: ${relays.join(', ')}`);

            await Promise.any(pool.publish(relays, signedEvent));
            logger.info(`Zap Receipt Published!`);
            
          } catch (error) {
            logger.error(`Error publishing zap receipt: ${error}`);
          }
       });
      }
      
      return res.status(200).json({
        status: 'OK',
          successAction: { tag: 'message', message: 'Thank You!' },
          routes: [],
          pr: invoice.request,
          disposable: false
      })
    } catch (e) {
        logger.error(`Pay Request ERROR: ${JSON.stringify(e)}`);
    }
});

app.listen(LNADDR_PORT)