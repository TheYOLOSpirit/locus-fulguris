import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import { nsecEncode, npubEncode } from 'nostr-tools/nip19';

const secretKeyBytes = generateSecretKey();
const publicKeyHex = getPublicKey(secretKeyBytes);
const secretKeyHex = bytesToHex(secretKeyBytes);

console.log("--- COPY TO .ENV FILE ---");
console.log(`SERVER_NOSTR_PRIVKEY_HEX=${secretKeyHex}`);
console.log(`SERVER_NOSTR_PUBKEY_HEX=${publicKeyHex}`);
console.log("\n--- USE TO LOGIN TO CLIENTS ---");
console.log(`nsec: ${nsecEncode(secretKeyBytes)}`);
console.log(`npub: ${npubEncode(publicKeyHex)}`);