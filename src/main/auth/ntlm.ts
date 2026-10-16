// NTLM v2 (MS-NLMP), implémentation propre. MD4 est implémenté ici car OpenSSL 3 le désactive
// par défaut dans Node.
//
// Comportement de référence observé : la requête part d'abord sans auth ; sur un 401/403 annonçant
// NTLM, un message de type 1 est envoyé, puis le type 3 calculé à partir du défi de type 2, le
// tout sur la même connexion. Un identifiant « DOMAINE\utilisateur » ou « utilisateur@domaine »
// est découpé quand le domaine n'est pas renseigné.

import { createHmac, randomBytes } from 'node:crypto'

// --- MD4 (RFC 1320) ------------------------------------------------------------------------------

export function md4(input: Buffer): Buffer {
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))
  const len = input.length
  const padded = Buffer.alloc(((len + 8) >> 6) * 64 + 64)
  input.copy(padded)
  padded[len] = 0x80
  padded.writeUInt32LE((len * 8) >>> 0, padded.length - 8)
  padded.writeUInt32LE(Math.floor((len * 8) / 0x100000000), padded.length - 4)

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476
  const F = (x: number, y: number, z: number) => (x & y) | (~x & z)
  const G = (x: number, y: number, z: number) => (x & y) | (x & z) | (y & z)
  const H = (x: number, y: number, z: number) => x ^ y ^ z

  for (let off = 0; off < padded.length; off += 64) {
    const X = Array.from({ length: 16 }, (_, i) => padded.readUInt32LE(off + i * 4))
    const [aa, bb, cc, dd] = [a, b, c, d]
    for (const i of [0, 4, 8, 12]) {
      a = rotl((a + F(b, c, d) + X[i]!) | 0, 3)
      d = rotl((d + F(a, b, c) + X[i + 1]!) | 0, 7)
      c = rotl((c + F(d, a, b) + X[i + 2]!) | 0, 11)
      b = rotl((b + F(c, d, a) + X[i + 3]!) | 0, 19)
    }
    for (const i of [0, 1, 2, 3]) {
      a = rotl((a + G(b, c, d) + X[i]! + 0x5a827999) | 0, 3)
      d = rotl((d + G(a, b, c) + X[i + 4]! + 0x5a827999) | 0, 5)
      c = rotl((c + G(d, a, b) + X[i + 8]! + 0x5a827999) | 0, 9)
      b = rotl((b + G(c, d, a) + X[i + 12]! + 0x5a827999) | 0, 13)
    }
    for (const i of [0, 2, 1, 3]) {
      a = rotl((a + H(b, c, d) + X[i]! + 0x6ed9eba1) | 0, 3)
      d = rotl((d + H(a, b, c) + X[i + 8]! + 0x6ed9eba1) | 0, 9)
      c = rotl((c + H(d, a, b) + X[i + 4]! + 0x6ed9eba1) | 0, 11)
      b = rotl((b + H(c, d, a) + X[i + 12]! + 0x6ed9eba1) | 0, 15)
    }
    a = (a + aa) | 0
    b = (b + bb) | 0
    c = (c + cc) | 0
    d = (d + dd) | 0
  }
  const out = Buffer.alloc(16)
  out.writeInt32LE(a, 0)
  out.writeInt32LE(b, 4)
  out.writeInt32LE(c, 8)
  out.writeInt32LE(d, 12)
  return out
}

// --- Messages ------------------------------------------------------------------------------------

const SIGNATURE = Buffer.from('NTLMSSP\0', 'ascii')
const FLAGS = {
  UNICODE: 0x1,
  OEM: 0x2,
  REQUEST_TARGET: 0x4,
  NTLM: 0x200,
  ALWAYS_SIGN: 0x8000,
  EXTENDED_SESSION_SECURITY: 0x80000,
  TARGET_INFO: 0x800000,
  N128: 0x20000000,
  N56: 0x80000000
}
const TYPE1_FLAGS =
  FLAGS.UNICODE | FLAGS.OEM | FLAGS.REQUEST_TARGET | FLAGS.NTLM | FLAGS.ALWAYS_SIGN | FLAGS.EXTENDED_SESSION_SECURITY | FLAGS.N128 | FLAGS.N56

const utf16 = (s: string) => Buffer.from(s, 'utf16le')

export function createType1Message(): string {
  const msg = Buffer.alloc(32)
  SIGNATURE.copy(msg, 0)
  msg.writeUInt32LE(1, 8)
  msg.writeUInt32LE(TYPE1_FLAGS >>> 0, 12)
  // Domaine et poste vides (buffers de sécurité à zéro).
  return `NTLM ${msg.toString('base64')}`
}

export interface Type2Message {
  flags: number
  challenge: Buffer
  targetName: string
  targetInfo: Buffer
}

export function parseType2Message(header: string): Type2Message | null {
  const m = /NTLM\s+([A-Za-z0-9+/=]+)/.exec(header)
  if (!m) return null
  const buf = Buffer.from(m[1]!, 'base64')
  if (buf.length < 32 || !buf.subarray(0, 8).equals(SIGNATURE) || buf.readUInt32LE(8) !== 2) return null
  const readBuffer = (offset: number) => {
    const len = buf.readUInt16LE(offset)
    const start = buf.readUInt32LE(offset + 4)
    return buf.subarray(start, start + len)
  }
  const flags = buf.readUInt32LE(20)
  const name = readBuffer(12)
  return {
    flags,
    challenge: Buffer.from(buf.subarray(24, 32)),
    targetName: flags & FLAGS.UNICODE ? name.toString('utf16le') : name.toString('latin1'),
    targetInfo: buf.length >= 48 && flags & FLAGS.TARGET_INFO ? Buffer.from(readBuffer(40)) : Buffer.alloc(0)
  }
}

export function ntowfv2(password: string, user: string, domain: string): Buffer {
  return createHmac('md5', md4(utf16(password)))
    .update(utf16(user.toUpperCase() + domain))
    .digest()
}

/** Réponse NTLMv2 (MS-NLMP 3.3.2) : NTProofStr suivi du blob client. */
export function ntlmv2Response(key: Buffer, serverChallenge: Buffer, clientChallenge: Buffer, timestamp: Buffer, targetInfo: Buffer): Buffer {
  const temp = Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]), timestamp, clientChallenge, Buffer.alloc(4), targetInfo, Buffer.alloc(4)])
  const proof = createHmac('md5', key).update(Buffer.concat([serverChallenge, temp])).digest()
  return Buffer.concat([proof, temp])
}

/** Horodatage Windows FILETIME (100 ns depuis 1601). */
function fileTime(now = Date.now()): Buffer {
  const out = Buffer.alloc(8)
  out.writeBigUInt64LE((BigInt(now) + 11644473600000n) * 10000n)
  return out
}

/** Découpe « DOMAINE\utilisateur » ou « utilisateur@domaine » quand le domaine est vide. */
export function splitUser(username: string, domain: string): { user: string; domain: string } {
  if (domain) return { user: username, domain }
  const back = username.split('\\')
  if (back.length === 2 && back[0] && back[1]) return { user: back[1], domain: back[0] }
  const at = username.split('@')
  if (at.length === 2 && at[0] && at[1]) return { user: at[0], domain: at[1] }
  return { user: username, domain: '' }
}

export function createType3Message(
  type2: Type2Message,
  creds: { username: string; password: string; domain: string; workstation: string },
  opts: { clientChallenge?: Buffer; timestamp?: Buffer } = {}
): string {
  const { user, domain } = splitUser(creds.username, creds.domain)
  const key = ntowfv2(creds.password, user, domain)
  const clientChallenge = opts.clientChallenge ?? randomBytes(8)
  const timestamp = opts.timestamp ?? fileTime()
  const nt = ntlmv2Response(key, type2.challenge, clientChallenge, timestamp, type2.targetInfo)
  const lm = Buffer.concat([createHmac('md5', key).update(Buffer.concat([type2.challenge, clientChallenge])).digest(), clientChallenge])

  const domainBuf = utf16(domain)
  const userBuf = utf16(user)
  const wsBuf = utf16(creds.workstation)
  const payloads = [lm, nt, domainBuf, userBuf, wsBuf, Buffer.alloc(0)]
  const header = Buffer.alloc(64)
  SIGNATURE.copy(header, 0)
  header.writeUInt32LE(3, 8)
  let offset = 64
  // Ordre des buffers de sécurité : LM, NT, domaine, utilisateur, poste, clé de session.
  const fieldOffsets = [12, 20, 28, 36, 44, 52]
  payloads.forEach((p, i) => {
    const at = fieldOffsets[i]!
    header.writeUInt16LE(p.length, at)
    header.writeUInt16LE(p.length, at + 2)
    header.writeUInt32LE(offset, at + 4)
    offset += p.length
  })
  const flags = (type2.flags & ~FLAGS.OEM) | FLAGS.UNICODE
  header.writeUInt32LE(flags >>> 0, 60)
  return `NTLM ${Buffer.concat([header, ...payloads]).toString('base64')}`
}
