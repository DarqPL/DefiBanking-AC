# AGENTS.md

## Sources Of Truth
- Root `README.md` and `frontend/README.md` are still template docs; prefer `package.json`, `hardhat.config.ts`, `deploy/`, `test/`, and `docs/`.
- Assignment context lives under `docs/`; old tracked `doc/` files may be deleted in the worktree, so do not restore them unless asked.
- Product is a DeFi term-deposit system: `SavingCore` holds user principal and deposit NFTs, `VaultManager` holds bank interest liquidity, `MockUSDC` is a 6-decimal test token.
- Student variant currently documented as ID ending `71`: default tenor `180 days`, APR `225 bps`, early penalty `650 bps`, auto-renew grace `3 days`.

## Commands
- Root install uses `package-lock.json`; frontend has its own `frontend/package-lock.json` and must be run from `frontend/`.
- `npm run compile` runs Hardhat compile, ABI export to `data/abi/`, contract sizer, and TypeChain generation in `typechain/`.
- `npm test` runs all Hardhat tests; focused tests use `npx hardhat test test/SavingCore.test.ts`.
- `npx hardhat coverage` runs Solidity coverage; current docs record 39 passing and >90% coverage.
- `REPORT_GAS=1 npm test` enables gas reporter; in PowerShell use `$env:REPORT_GAS="1"; npm test`.
- If PowerShell blocks `npm.ps1`, use `npm.cmd run compile`, `npm.cmd test`, or `npx.cmd hardhat coverage`.
- `npm run size`, `npm run clean`, and `npm run node` map directly to Hardhat size/clean/node.
- Deploy scripts use `hardhat-deploy`: `npx hardhat deploy --network sepolia`; root scripts `npm run run:sepolia -- <script.ts>` and `npm run run:ethereum -- <script.ts>` run Hardhat runtime scripts. Verify intent before mainnet.
- Frontend commands from `frontend/`: `npm run dev`, `npm run build` (`tsc -b && vite build`), `npm run lint`, `npm run preview`.

## Hardhat Config
- Solidity config is compiler `0.8.28`, `evmVersion: "cancun"`, optimizer `runs: 1000`, `viaIR: true`; some contracts use compatible `^0.8.20` pragmas.
- Ethers is v6, TypeChain target is `ethers-v6`, and tests use BigInt assertions such as `0n`.
- `dotenv.config()` loads `.env`; `.env_example` defines `REPORT_GAS`, `TESTNET_PRIVATE_KEY`, `MAINNET_PRIVATE_KEY`, and `ETHERSCAN_API`. Never read or print real `.env` secrets.
- Public RPC URLs are hard-coded for `sepolia` and `ethereum`; `namedAccounts.deployer` is account index `0`; mocha timeout is `40000` ms.
- There is no root lint/typecheck script; only frontend has ESLint and a TypeScript build.

## Project Layout
- `contracts/`: `MockUSDC`, `VaultManager`, `SavingCore`; public/external Solidity additions should keep existing NatSpec/custom-error style.
- `deploy/`: numbered `hardhat-deploy` scripts; `03-deploy-saving-core.ts` wires `VaultManager.setSavingCore(...)` and creates the default plan if none exists.
- `test/`: Hardhat mocha/chai tests deploy fixtures directly, use `@nomicfoundation/hardhat-network-helpers` time helpers, and include custom revert-data helpers for custom errors.
- `frontend/`: standalone Vite React app on React 19, Ethers v6, MetaMask, Sepolia-only network switching, and hard-coded deployed addresses in `frontend/src/config.ts`.
- `frontend/src/abi/` mirrors exported contract ABIs for the app; update these from compiled/exported ABIs instead of hand-editing when contracts change.
- Generated or tool outputs include `artifacts/`, `cache/`, `typechain/`, `coverage/`, `coverage.json`, and `data/abi/`; avoid hand-editing them.
- `deployments/sepolia/` contains committed hardhat-deploy artifacts for the current Sepolia deployment.

## Contract Rules To Preserve
- `MockUSDC` uses 6 decimals and intentionally allows any account to mint for tests/demo.
- `SavingCore` treats zero `minDeposit` and zero `maxDeposit` as no limit, but still rejects zero deposit amount.
- Interest uses simple APR math: `principal * aprBps * duration / (365 days * 10_000)`; interest is paid from `VaultManager`, never from other users' principal.
- Early withdrawal pays no interest, sends penalty to `VaultManager.feeReceiver()`, and rejects after maturity.
- Mature withdrawals and renewals burn/retire the old deposit NFT status so repeated withdrawal is rejected.
- Load `blockchain-developer` for contract/deploy work and `solidity-gas-optimization` for Solidity reviews, audits, or gas-focused changes.
