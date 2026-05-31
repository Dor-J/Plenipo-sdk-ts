import nacl from 'tweetnacl';
import { base58btc } from 'multiformats/bases/base58';

export interface DidCreateResult {
  did: string;
  document: Record<string, unknown>;
  privateKeys: {
    authSecretKey: string;
    encSecretKey: string;
  };
}

function multibaseEd25519(publicKey: Uint8Array): string {
  const bytes = new Uint8Array([0xed, 0x01, ...publicKey]);
  return 'z' + base58btc.encode(bytes);
}

function multibaseX25519(publicKey: Uint8Array): string {
  const bytes = new Uint8Array([0xec, 0x01, ...publicKey]);
  return 'z' + base58btc.encode(bytes);
}

/**
 * Generates a did:web document and key material for a domain.
 */
export async function createDidDocument(
  domain: string,
  relayUrl = 'ws://localhost:4000/agent/websocket',
): Promise<DidCreateResult> {
  const authPair = nacl.sign.keyPair();
  const authPublic = authPair.publicKey;
  const authSecret = authPair.secretKey;
  const encPair = nacl.box.keyPair();
  const encPublic = encPair.publicKey;
  const encSecret = encPair.secretKey;
  const did = `did:web:${domain}`;

  const document = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
      'https://w3id.org/security/suites/x25519-2020/v1',
    ],
    id: did,
    verificationMethod: [
      {
        id: `${did}#auth-key`,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase: multibaseEd25519(authPublic),
      },
      {
        id: `${did}#enc-key`,
        type: 'X25519KeyAgreementKey2020',
        controller: did,
        publicKeyMultibase: multibaseX25519(encPublic),
      },
    ],
    authentication: [`${did}#auth-key`],
    assertionMethod: [`${did}#auth-key`],
    keyAgreement: [`${did}#enc-key`],
    service: [
      {
        id: `${did}#plenipo`,
        type: 'PlenipoAgent',
        serviceEndpoint: relayUrl,
        capabilities: ['general'],
      },
    ],
  };

  return {
    did,
    document,
    privateKeys: {
      authSecretKey: Buffer.from(authSecret).toString('base64url'),
      encSecretKey: Buffer.from(encSecret).toString('base64url'),
    },
  };
}
