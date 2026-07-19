import type { ethers } from 'ethers';

export const REGISTER_SIGNER_TYPES: Record<string, ethers.TypedDataField[]> = {
  RegisterSigner: [
    { name: 'account', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'message', type: 'string' },
    { name: 'expiration', type: 'uint32' },
    { name: 'nonceAnchor', type: 'uint48' },
    { name: 'nonceBitmap', type: 'uint8' },
  ],
};

export const VERIFY_SIGNER_TYPES: Record<string, ethers.TypedDataField[]> = {
  VerifySigner: [
    { name: 'account', type: 'address' },
    { name: 'nonceAnchor', type: 'uint48' },
    { name: 'nonceBitmap', type: 'uint8' },
  ],
};

export const REVOKE_SIGNER_TYPES: Record<string, ethers.TypedDataField[]> = {
  RevokeSigner: [
    { name: 'account', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'nonceAnchor', type: 'uint48' },
    { name: 'nonceBitmap', type: 'uint8' },
  ],
};

export const VERIFY_WITNESS_TYPES: Record<string, ethers.TypedDataField[]> = {
  VerifyWitness: [
    { name: 'account', type: 'address' },
    { name: 'target', type: 'address' },
    { name: 'hash', type: 'bytes32' },
    { name: 'nonceAnchor', type: 'uint48' },
    { name: 'nonceBitmap', type: 'uint8' },
    { name: 'deadline', type: 'uint32' },
  ],
};

export const REGISTER_SIGNER_MESSAGE = 'Registering signer for RISEx';

export const PERMIT_SINGLE_TYPES: Record<string, ethers.TypedDataField[]> = {
  PermitSingle: [
    { name: 'account', type: 'address' },
    { name: 'operator', type: 'address' },
    { name: 'budget', type: 'uint96' },
    { name: 'allowanceExpiry', type: 'uint32' },
    { name: 'nonceAnchor', type: 'uint48' },
    { name: 'nonceBitmap', type: 'uint8' },
  ],
};

export const PLACE_TPSL_TYPES: Record<string, ethers.TypedDataField[]> = {
  PlaceTpslOrder: [
    { name: 'account', type: 'address' },
    { name: 'marketId', type: 'uint64' },
    { name: 'side', type: 'uint8' },
    { name: 'size', type: 'string' },
    { name: 'stopType', type: 'uint8' },
    { name: 'stopPrice', type: 'string' },
    { name: 'limitPrice', type: 'string' },
    { name: 'orderType', type: 'uint8' },
    { name: 'stopPriceOption', type: 'uint8' },
    { name: 'tif', type: 'uint8' },
    { name: 'deadline', type: 'uint32' },
  ],
};

export const CANCEL_TPSL_TYPES: Record<string, ethers.TypedDataField[]> = {
  CancelTpslOrder: [
    { name: 'account', type: 'address' },
    { name: 'orderId', type: 'string' },
    { name: 'deadline', type: 'uint32' }
  ]
};
