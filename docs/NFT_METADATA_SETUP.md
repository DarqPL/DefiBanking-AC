# NFT Metadata Setup

`SavingCore` deposit NFTs use dynamic on-chain ERC721 metadata. You do not create one JSON file per NFT. If there are 100 deposits, there are still zero metadata JSON files to upload.

The only IPFS asset you need is the certificate image.

## How It Works

When a wallet or NFT viewer calls:

```solidity
SavingCore.tokenURI(depositId)
```

`SavingCore` reads the deposit from contract storage and generates JSON in memory. It then returns the JSON as a Base64 data URI:

```text
data:application/json;base64,...
```

There is no physical `0.json`, `1.json`, or `99.json` file. The JSON is generated live when `tokenURI` is called.

`openDeposit()` does not create a JSON file. It stores deposit state and mints the NFT. Later, `tokenURI(depositId)` uses that stored state to build metadata.

## Metadata Fields

The generated JSON includes:

- `name`: `DeFi Saving Deposit #<depositId>`.
- `description`: explains that the NFT is a soulbound term-deposit certificate transferable only through the official marketplace.
- `image`: the shared IPFS image URI stored in `metadataImageURI`.
- `attributes`: principal, APR, maturity timestamp, deposit status, and transfer policy.

Example decoded metadata for deposit `0`:

```json
{
  "name": "DeFi Saving Deposit #0",
  "description": "Soulbound DeFi term-deposit certificate. Transferable only through the official marketplace.",
  "image": "ipfs://bafyExampleImage/deposit-certificate.png",
  "attributes": [
    { "trait_type": "Principal", "value": "1000.000000 USDC" },
    { "trait_type": "APR", "value": "2.25%" },
    { "trait_type": "Maturity Timestamp", "value": "1780000000" },
    { "trait_type": "Status", "value": "Active" },
    { "trait_type": "Transfer Policy", "value": "Marketplace only" }
  ]
}
```

## Upload The Image To IPFS

Create one certificate image, for example:

```text
deposit-certificate.png
```

Upload it using Pinata, NFT.Storage, Web3.Storage, Lighthouse, or another IPFS pinning service.

Example image URI:

```text
ipfs://bafyExampleImage/deposit-certificate.png
```

## Configure SavingCore

Only the `SavingCore` owner can set or lock the metadata image URI.

Set the image URI:

```solidity
SavingCore.setMetadataImageURI("ipfs://bafyExampleImage/deposit-certificate.png")
```

Check the stored image URI:

```solidity
SavingCore.metadataImageURI()
```

Check generated metadata:

```solidity
SavingCore.tokenURI(0)
```

The result starts with:

```text
data:application/json;base64,
```

Decode the part after the comma to inspect the JSON.

## Lock Metadata

Before locking, verify:

- `metadataImageURI()` returns the expected IPFS image URI.
- The image loads through an IPFS gateway.
- `tokenURI(0)` returns Base64 JSON with the expected name, image, and attributes.
- MetaMask or an NFT viewer displays the certificate image.
- The description clearly says direct NFT transfers are rejected and marketplace transfer is the only valid sale path.

Then permanently lock the image URI:

```solidity
SavingCore.lockMetadata()
```

After `lockMetadata()`, `setMetadataImageURI(...)` always reverts with `MetadataLocked`. There is no unlock function.

## What Updates Automatically

Because metadata is generated from contract state, the returned JSON reflects current deposit storage at the time `tokenURI` is called.

Automatic fields include:

- Principal.
- APR snapshot.
- Maturity timestamp.
- Deposit status.

Wallets and NFT marketplaces may cache metadata, so UI updates may not appear instantly even though `tokenURI` returns the latest on-chain values.

## Important Notes

- No per-token JSON files are required.
- The contract does not upload files or write JSON during `openDeposit()`.
- The image is still stored off-chain on IPFS.
- Metadata is informational only.
- Real ownership and deposit rights are controlled by `SavingCore.ownerOf(depositId)` and `SavingCore.deposits(depositId)`.
- Changing the image URI cannot change principal, APR, maturity, withdrawal rights, or ownership.
