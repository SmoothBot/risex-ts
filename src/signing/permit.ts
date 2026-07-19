import { ethers } from 'ethers';
import { VERIFY_WITNESS_TYPES } from './domain.js';
import { fixSignatureV } from './signer.js';
import type { PermitParams, NonceState } from '../types/auth.js';
import type { Eip712Domain } from '../types/config.js';

/**
 * Convert a hex signature string to base64.
 */
export function hexToBase64(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = Buffer.from(clean, 'hex');
  return bytes.toString('base64');
}

/** Maximum bitmap index before the anchor must advance. */
const MAX_BITMAP_INDEX = 207;

export async function createPermitParams(
  hash: string,
  signerWallet: ethers.Wallet,
  account: string,
  target: string,
  domain: Eip712Domain,
  nonceState: NonceState,
  deadlineSeconds?: number,
  isErc1271 = false,
): Promise<PermitParams> {
  const deadline = Math.floor(Date.now() / 1000) + (deadlineSeconds ?? 300);

  // When the bitmap is exhausted, advance the anchor and reset the index.
  let nonceAnchor = Number(nonceState.nonce_anchor);
  let nonceBitmapIndex = nonceState.current_bitmap_index;
  if (nonceBitmapIndex > MAX_BITMAP_INDEX) {
    nonceAnchor += 1;
    nonceBitmapIndex = 0;
  }

  const ethDomain = {
    name: domain.name,
    version: domain.version,
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract,
  };

  const rawSig = fixSignatureV(
    await signerWallet.signTypedData(ethDomain, VERIFY_WITNESS_TYPES, {
      account,
      target,
      hash,
      nonceAnchor,
      nonceBitmap: nonceBitmapIndex,
      deadline,
    }),
  );

  return {
    account,
    signer: signerWallet.address,
    nonce_anchor: nonceAnchor,
    nonce_bitmap_index: nonceBitmapIndex,
    deadline,
    signature: hexToBase64(rawSig),
    ...(isErc1271 ? { is_erc1271: true } : {}),
  };
}
